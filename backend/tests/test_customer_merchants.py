"""Customer adapters expose retail data and dispatch only server-priced orders."""
import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4, uuid5, NAMESPACE_URL

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import customer_merchants as adapter, db, main
from app.integrations import shopify_client


@pytest.fixture
def merchant(monkeypatch):
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    db.AppSetting.__table__.create(engine)
    monkeypatch.setattr(db,'SessionLocal',sessionmaker(engine,expire_on_commit=False))
    aid=str(uuid4())
    vendor={'id':'merchant','username':'merchant','name':'Shop','account_type':'vendor',
        'account_id':aid,'created_at':'2026-10-01T00:00:00Z','chat_id':'vendor:'+aid}
    db.set_app_setting(main.WHOLESALE_STORE,main._wholesale_vendor_key('merchant'),vendor)
    return {'kind':'vendor','account_id':aid,'vendor_id':'merchant','vendor':vendor,'account_type':'vendor'}


def product(merchant, **extra):
    return {'id':1,'title':'Apples','vendor':'Shop','status':'active',
        'tags':'merchant_account:'+merchant['account_id'],'created_at':'2026-10-02T00:00:00Z',
        'product_type':'Fruit','images':[{'src':'/apples.png'}],
        'variants':[{'id':11,'price':'12.50','inventory_quantity':3,'unit_cost':'1.00'}],**extra}


def test_lifetime_tags_and_legacy_name_never_cross_accounts(merchant):
    assert adapter._owns_wholesale(product(merchant),merchant)
    assert not adapter._owns_wholesale(product(merchant,tags='merchant_account:'+str(uuid4())),merchant)
    assert not adapter._owns_wholesale(product(merchant,tags='vendor_id:someone-else'),merchant)
    assert not adapter._owns_wholesale(product(merchant,tags='vendor_id:merchant',created_at='2025-01-01'),merchant)
    assert adapter._owns_wholesale(product(merchant,tags='vendor:Shop'),merchant)
    assert not adapter._owns_wholesale(product(merchant,tags='vendor:Shop',created_at='2025-01-01'),merchant)
    db.set_app_setting(main.WHOLESALE_STORE,main._wholesale_vendor_key('duplicate'),{'id':'duplicate','name':'Shop'})
    assert not adapter._owns_wholesale(product(merchant,tags='vendor:Shop'),merchant)


def test_legacy_vendor_id_keeps_catalog_but_conflicting_owner_denied(merchant):
    merchant['account_id']=str(uuid5(NAMESPACE_URL,'legacy'))
    assert adapter._owns_wholesale(product(merchant,tags='vendor_id:merchant',created_at='2020-01-01'),merchant)
    assert not adapter._owns_wholesale(product(merchant,tags='vendor_id:merchant, vendor_id:other'),merchant)


def test_legacy_merchant_can_be_resolved_before_next_login(merchant):
    vendor={**merchant['vendor']};vendor.pop('account_id')
    db.set_app_setting(main.WHOLESALE_STORE,main._wholesale_vendor_key('merchant'),vendor)
    expected=main._wholesale_ensure_account_identity(vendor)['account_id']
    assert adapter.resolve_merchant('vendor',expected,'merchant')['account_id']==expected


def test_wholesale_order_ownership_and_new_tags_use_account_lifetime(merchant):
    source=main.WHOLESALE_DASHBOARD_TAG
    tags=main._wholesale_tags_csv('Shop','merchant')
    assert 'ma:'+merchant['account_id'].replace('-','') in tags
    assert all(len(tag.strip())<=40 for tag in tags.split(','))
    own={'tags':tags,'created_at':'2026-10-02T00:00:00Z'}
    assert main._wholesale_order_matches_vendor(own,'Shop','merchant')
    assert not main._wholesale_order_matches_vendor({**own,'tags':source+', vendor:Shop, merchant_account:'+str(uuid4())},'Shop','merchant')
    assert not main._wholesale_order_matches_vendor({'tags':source+', vendor_id:merchant','created_at':'2025-01-01'},'Shop','merchant')
    assert main._wholesale_order_matches_vendor({'tags':source+', vendor:Shop','created_at':'2026-10-02'},'Shop','merchant')
    db.set_app_setting(main.WHOLESALE_STORE,main._wholesale_vendor_key('other'),{'id':'other','name':'Shop'})
    assert not main._wholesale_order_matches_vendor({'tags':source+', vendor:Shop','created_at':'2026-10-02'},'Shop','merchant')


def test_safe_catalog_retains_images_variants_and_hides_private_fields(merchant):
    raw=product(merchant,cost_price='1.00',password_hash='secret',profit='100')
    result=adapter._public_product(raw,store='shop')
    assert result['id']=='shop:1' and result['variants'][0]['id']=='shop:11'
    assert result['image']=='/apples.png' and result['collection_ids']==['Fruit']
    assert result['variants'][0]['price']=='12.50'
    assert all(field not in json.dumps(result) for field in ('unit_cost','password_hash','profit','cost_price'))
    raw['variants'][0]['unit_cost']='13.00'
    assert adapter._public_product(raw,store='shop') is None


def test_wholesale_catalog_pages_are_store_scoped(monkeypatch,merchant):
    calls=[]
    def get(store,path,timeout):
        calls.append((store,path,timeout))
        return SimpleNamespace(json=lambda:{'products':[product(merchant,id=len(calls))]},
            headers={'Link':'<https://untrusted.invalid/products.json?page_info=cursor%2Bnext>; rel="next"'} if len(calls)==1 else {})
    monkeypatch.setattr(shopify_client,'_rest_get_store_raw_once',get)
    result=adapter._wholesale_products(merchant)
    assert len(result)==2
    assert calls[0][0]==main.WHOLESALE_STORE and 'vendor=Shop' in calls[0][1]
    assert calls[1][1]=='/products.json?limit=250&page_info=cursor%2Bnext'
    assert all('untrusted' not in path for _,path,_ in calls)


def test_wholesale_catalog_filters_other_lifetimes(monkeypatch,merchant):
    monkeypatch.setattr(adapter,'_wholesale_products',lambda m:[product(m),product(m,id=2,tags='merchant_account:'+str(uuid4()))])
    monkeypatch.setattr(main,'_wholesale_enrich_products_inventory',lambda rows:rows)
    assert [p['id'] for p in adapter.catalog(merchant)['products']]==['1']


def test_lines_reject_opaque_cross_store_and_total_stock(monkeypatch,merchant):
    p=adapter._public_product(product(merchant),store='shop')
    monkeypatch.setattr(adapter,'catalog',lambda m:{'products':[p]})
    with pytest.raises(HTTPException):adapter._lines(merchant,{'line_items':[{'product_id':'other:1','variant_id':'shop:11','quantity':1}]})
    with pytest.raises(HTTPException):adapter._lines(merchant,{'line_items':[{'variant_id':'other:11','quantity':1}]})
    with pytest.raises(HTTPException) as error:
        adapter._lines(merchant,{'line_items':[{'variant_id':'shop:11','quantity':2}]*2})
    assert error.value.status_code==422


def test_customer_wholesale_prices_are_private_and_phone_does_not_attach_history(monkeypatch,merchant):
    captured=[]
    monkeypatch.setattr(main,'_wholesale_variant_availability',lambda ids:{11:{'available':5}})
    monkeypatch.setattr(main,'_wholesale_find_existing_customer_by_phone',lambda *args:pytest.fail('portal must not inherit a historical customer by phone'))
    monkeypatch.setattr(shopify_client,'_get_store_config',lambda store:{'BASE':'https://fixture.invalid','HEADERS':{},'TOKEN':'test'})
    def post(url,**kwargs):
        captured.append(kwargs['json']['order'])
        return SimpleNamespace(status_code=200,content=True,json=lambda:{'order':{'id':99,'total_price':'12.50'}})
    import requests
    monkeypatch.setattr(requests,'post',post)
    body=main.WholesaleOrderCreate(customer_name='Customer Name',customer_phone='+212612345678',
        line_items=[{'variant_id':11,'quantity':1}],_portal_prices={11:'0.01'})
    assert body._portal_prices is None  # A JSON client cannot supply trusted prices.
    body._portal_prices={11:'12.50'}
    result=asyncio.run(main.api_wholesale_create_order('merchant',body))
    assert result['data']['id']==99
    assert captured[0]['line_items']==[{'variant_id':11,'quantity':1,'price':'12.50'}]
    assert captured[0]['financial_status']=='pending'
    assert captured[0]['inventory_behaviour']=='decrement_obeying_policy'
    assert 'id' not in captured[0]['customer']


def test_adapter_uses_current_prices_and_rejects_changed_total(monkeypatch,merchant):
    snapshot={'products':[adapter._public_product(product(merchant))],'currency':'MAD'}
    monkeypatch.setattr(adapter,'catalog',lambda m:snapshot)
    requests=[]
    async def create(vid,body):
        requests.append(body)
        return {'data':{'id':99,'total_price':'12.50'}}
    monkeypatch.setattr(main,'api_wholesale_create_order',create)
    payload={'request_id':str(uuid4()),'line_items':[{'product_id':'1','variant_id':'11','quantity':1,'price':'0.01'}]}
    customer={'id':str(uuid4()),'name':'Customer Name','phone':'+212612345678'}
    result=adapter.place_order(merchant,payload,customer)
    assert requests[0]._portal_prices=={11:'12.50'}
    assert result['data']['total_price']=='12.50' and result['data']['line_items'][0]['image']=='/apples.png'
    with pytest.raises(HTTPException) as error:
        adapter.place_order(merchant,{**payload,'expected_total':'12.00'},customer)
    assert error.value.status_code==422 and error.value.detail['error']=='price_changed'
    assert len(requests)==1  # Reject a stale displayed price before external dispatch.
    async def mismatch(*args):return {'data':{'id':99,'total_price':'13.50'}}
    monkeypatch.setattr(main,'api_wholesale_create_order',mismatch)
    with pytest.raises(HTTPException) as error:adapter.place_order(merchant,payload,customer)
    assert error.value.status_code==409


def test_wholesale_history_refresh_is_shared_only_within_account_lifetime(monkeypatch,merchant):
    calls=[]
    async def history(vid):
        calls.append(vid)
        return {'data':{'all_orders':[{'id':99,'order_status':'fulfilled'}]}}
    monkeypatch.setattr(adapter,'main_orders',history)
    adapter._ORDER_CACHE.clear()
    assert adapter.refresh_order(merchant,'99')['order_status']=='fulfilled'
    assert adapter.refresh_order(merchant,'missing') is None
    assert len(calls)==1
    assert adapter.refresh_order({**merchant,'account_id':str(uuid4())},'99')
    assert len(calls)==2
