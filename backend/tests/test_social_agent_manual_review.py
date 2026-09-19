from datetime import datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.social_agent import repository as repo, service, meta, routes


@pytest.fixture
def job(monkeypatch):
    store='manual_'+uuid4().hex
    repo.save_config(store, {'enabled':True,'live_publish':True,'max_review_attempts':1})
    product={'id':'fur-skirt','title':'Fur and plain tulle','url':'https://shop.test/product','images':[{'url':'https://shop.test/original.png'}]}
    run=repo.create_run(store,store,'rolling',1,{'products':[product],'local_date':'2026-09-10','scheduled_for':['2026-09-10T10:00:00Z']})
    post=repo.create_post(run_id=run['id'],store=store,slot='rolling',position=0,scheduled_for=datetime.utcnow()-timedelta(minutes=2),product=product,status='rejected')
    repo.update_post(post['id'],attempts=4,strategy={'caption_ar':'Caption','hashtags':['#test']},review={'decision':'reject','source_product_differences':['Tulle changed']},assets=[{'candidate':1,'selected':False,'draft_data_url':'data:image/png;base64,cGl4ZWxz','review':{'decision':'reject','source_product_differences':['Tulle changed']}}])
    fb=Mock(return_value={'id':'fb-published'});ig=Mock(return_value={'id':'ig-published'})
    upload=Mock(return_value={'url':'https://shop.test/approved.png'})
    monkeypatch.setattr(meta,'publish_facebook_image',fb);monkeypatch.setattr(meta,'publish_instagram_image',ig)
    monkeypatch.setattr(service.shopify,'upload_file_bytes',upload)
    return repo.get_post(post['id']),fb,ig,upload


def test_private_draft_retained_but_excluded_from_dashboard(job):
    post,*_=job
    assert post['assets'][0]['draft_data_url'].startswith('data:')
    listed=repo.list_posts(post['store'])[0]
    assert listed['assets'][0]['draft_available']
    assert 'draft_data_url' not in listed['assets'][0]


def test_manual_approval_records_actor_preserves_ai_findings_and_publishes(job):
    post,fb,ig,upload=job
    result=service.manually_approve_and_publish(post['id'],1,post['updated_at'],'admin@example.test','Reviewed textiles')
    assert result['status']=='published'
    assert result['review']['decision']=='reject'
    assert result['review']['source_product_differences']==['Tulle changed']
    assert result['review']['manual_approval']['by']=='admin@example.test'
    assert result['review']['manual_approval']['candidate']==1
    assert result['attempts']==4 # Generation budget is independent of publication.
    assert upload.call_count==fb.call_count==ig.call_count==1
    service.publish_post(post['id'])
    assert fb.call_count==ig.call_count==1


def test_cannot_approve_stale_or_missing_candidate(job):
    post,fb,ig,upload=job
    with pytest.raises(RuntimeError,match='not retained'):
        service.manually_approve_and_publish(post['id'],2,post['updated_at'],'admin')
    repo.update_post(post['id'],strategy={'caption_ar':'Changed'})
    with pytest.raises(RuntimeError,match='changed'):
        service.manually_approve_and_publish(post['id'],1,post['updated_at'],'admin')
    upload.assert_not_called();fb.assert_not_called();ig.assert_not_called()


def test_upload_failure_keeps_post_held_for_human_review(job):
    post,fb,ig,upload=job
    upload.side_effect=RuntimeError('Upload unavailable')
    with pytest.raises(RuntimeError,match='Upload unavailable'):
        service.manually_approve_and_publish(post['id'],1,post['updated_at'],'admin')
    saved=repo.get_post(post['id'])
    assert saved['status']=='needs_review' and not saved['review'].get('manual_approval')
    fb.assert_not_called();ig.assert_not_called()


def test_permission_failure_pauses_auto_retries_and_manual_retry_skips_instagram(job):
    post,fb,ig,_=job
    fb.side_effect=RuntimeError('Meta API error 200: (#200) pages_manage_posts are not available')
    result=service.manually_approve_and_publish(post['id'],1,post['updated_at'],'admin')
    assert result['status']=='partial' and result['error']['auto_retry_paused']
    assert meta.publishing_blocks(post['store'])['facebook']
    assert repo.claim_due_posts(post['store'],datetime.utcnow())==[]
    fb.side_effect=None
    result=service.publish_post(post['id'],retry_blocked=True)
    assert result['status']=='published' and result['error'] is None
    assert fb.call_count==2 and ig.call_count==1
    assert not meta.publishing_blocks(post['store'])


def test_transient_failure_remains_retryable_after_four_generation_attempts(job):
    post,fb,ig,_=job
    fb.side_effect=RuntimeError('Temporary network outage')
    result=service.manually_approve_and_publish(post['id'],1,post['updated_at'],'admin')
    assert result['error']['publish_attempts']==1 and not result['error']['auto_retry_paused']
    assert len(repo.claim_due_posts(post['store'],datetime.utcnow()))==1
    with pytest.raises(RuntimeError,match='processing'):
        service.publish_post(post['id'],retry_blocked=True)
    fb.side_effect=None
    result=service.publish_post(post['id'],claimed=True)
    assert result['status']=='published' and ig.call_count==1


def test_manual_replacement_uses_same_product_one_image_and_never_auto_publishes(job,monkeypatch):
    post,fb,ig,upload=job
    create=Mock(return_value={'caption_ar':'New caption','visual_directions':['Preserve textiles'],'image_copy':{'headline_ar':'Title'}})
    generate=Mock(return_value='data:image/png;base64,bmV3')
    monkeypatch.setattr(service,'create_strategy',create)
    monkeypatch.setattr(service,'generate_candidate',generate)
    monkeypatch.setattr(service,'review_candidate',Mock(return_value={'decision':'approve','score':98}))
    monkeypatch.setattr(service,'repair_candidate',Mock(side_effect=AssertionError('No extra image allowed')))
    repo.save_config(post['store'],{'enabled':False}) # Manual action works while automation is paused.
    result=service.regenerate_for_manual_review(post['id'])['post']
    assert result['status']=='needs_review' and result['review']['decision']=='approve'
    assert generate.call_count==1 and generate.call_args.args[0]['id']==post['product_id']
    assert repo.get_post(post['id'])['assets'][0]['draft_data_url'].endswith('bmV3')
    upload.assert_not_called();fb.assert_not_called();ig.assert_not_called()


def test_routes_require_auth_store_scope_and_explicit_confirmation(job,monkeypatch):
    post,fb,ig,upload=job
    app=FastAPI();app.include_router(routes.router);client=TestClient(app)
    monkeypatch.setattr(routes,'_get_admin',lambda _:None)
    prefix='/api/social-agent/posts/'+post['id']
    assert client.get(prefix+'/review',params={'store':post['store']}).status_code==401
    monkeypatch.setattr(routes,'_get_admin',lambda _:{'sub':'admin@example.test'})
    assert client.get(prefix+'/review',params={'store':'other-store'}).status_code==404
    body={'store':post['store'],'candidate':1,'expected_updated_at':post['updated_at']}
    assert client.post(prefix+'/approve-publish',json=body).status_code==400
    body['confirm']=True;body['store']='other-store'
    assert client.post(prefix+'/approve-publish',json=body).status_code==404
    upload.assert_not_called();fb.assert_not_called();ig.assert_not_called()


def test_blocked_old_posts_do_not_starve_new_approved_posts(job):
    post,*_=job
    repo.update_post(post['id'],status='partial',error={'auto_retry_paused':True})
    run=repo.create_run(post['store'],uuid4().hex,'rolling',1,{})
    newer=repo.create_post(run_id=run['id'],store=post['store'],slot='rolling',position=0,scheduled_for=datetime.utcnow(),product=post['product'],status='approved')
    assert [p['id'] for p in repo.claim_due_posts(post['store'],datetime.utcnow(),1)]==[newer['id']]


def test_missing_scope_preflight_blocks_facebook_but_allows_instagram(monkeypatch):
    meta._permission_cache.clear()
    monkeypatch.setattr(meta,'_credentials',lambda _: {'token':'test-token','page_id':'test-page'})
    call=Mock(return_value={'data':[{'permission':p,'status':'granted'} for p in ('pages_read_engagement','instagram_basic','instagram_content_publish')]})
    monkeypatch.setattr(meta,'_call',call)
    store='permissions_'+uuid4().hex
    with pytest.raises(RuntimeError,match='missing pages_manage_posts'):
        meta.require_publishing_available(store,'facebook')
    meta.require_publishing_available(store,'instagram')
    assert call.call_count==1


def test_rejected_post_cannot_use_regular_force_publish(job):
    post,fb,ig,upload=job
    with pytest.raises(RuntimeError,match='not approved'):
        service.publish_post(post['id'],force=True)
    upload.assert_not_called();fb.assert_not_called();ig.assert_not_called()


def test_new_retry_counter_does_not_revive_exhausted_historical_posts(job):
    post,*_=job
    repo.update_post(post['id'],status='publish_failed',attempts=5,error={'platform_errors':{'facebook':'old failure'}})
    assert repo.claim_due_posts(post['store'],datetime.utcnow())==[]
