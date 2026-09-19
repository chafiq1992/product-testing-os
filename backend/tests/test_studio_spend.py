from unittest.mock import AsyncMock
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import studio


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setenv('STUDIO_APPROVAL_SECRET', 'test-secret-not-production')
    counter = AsyncMock(return_value=1200)
    generation = AsyncMock(return_value={'title':'Cap','description':'Black cap'})
    monkeypatch.setattr(studio, 'count_input_tokens', counter)
    monkeypatch.setattr(studio, 'run_step', generation)
    app = FastAPI(); app.include_router(studio.router)
    return TestClient(app), counter, generation


PATH = '/api/studio/steps/title_desc'
PREVIEW = '/api/studio/preflight/steps/title_desc'
BODY = {'product':{'title':'Cap'}}


def test_no_ticket_blocks_generation_and_even_counting(setup):
    client, counter, generation = setup
    assert client.post(PATH, json=BODY).status_code == 428
    counter.assert_not_called(); generation.assert_not_called()


def test_preview_counts_but_does_not_generate_and_normal_execution_recounts(setup):
    client, counter, generation = setup
    preview = client.post(PREVIEW, json=BODY).json()
    assert preview['input_tokens'] == 1200 and preview['max_output_tokens'] == 2000
    assert not preview['requires_confirmation']
    generation.assert_not_called()
    counted = counter.call_args.args[0]
    assert counted['instructions'].startswith(studio.RULES)
    assert counted['text']['format']['name'] == 'final_output'
    result = client.post(PATH, json=BODY, headers={'X-Studio-Ticket':preview['ticket']})
    assert result.status_code == 200
    assert result.json()['_tokens']['input_tokens'] == 1200
    assert counter.await_count == 2
    generation.assert_awaited_once()


def test_high_tokens_require_explicit_approval(setup):
    client, counter, generation = setup
    counter.return_value = 5000
    preview = client.post(PREVIEW, json=BODY).json()
    assert preview['requires_confirmation']
    headers = {'X-Studio-Ticket':preview['ticket']}
    assert client.post(PATH, json=BODY, headers=headers).status_code == 428
    generation.assert_not_called()
    headers['X-Studio-Approve-High'] = 'yes'
    assert client.post(PATH, json=BODY, headers=headers).status_code == 200
    generation.assert_awaited_once()


@pytest.mark.parametrize('changed',[{'model':'gpt-5.6-sol',**BODY},{'product':{'title':'Different cap'}}])
def test_approval_does_not_authorize_changed_payload(setup, changed):
    client, counter, generation = setup
    preview = client.post(PREVIEW, json=BODY).json()
    assert client.post(PATH,json=changed,headers={'X-Studio-Ticket':preview['ticket'],'X-Studio-Approve-High':'yes'}).status_code == 409
    generation.assert_not_called()


def test_bad_signature_and_expiry_cannot_be_approved(setup, monkeypatch):
    client, counter, generation = setup
    ticket = client.post(PREVIEW, json=BODY).json()['ticket']
    assert client.post(PATH,json=BODY,headers={'X-Studio-Ticket':ticket+'0','X-Studio-Approve-High':'yes'}).status_code == 409
    now = time.time()
    monkeypatch.setattr(studio.time,'time',lambda:now+301)
    assert client.post(PATH,json=BODY,headers={'X-Studio-Ticket':ticket,'X-Studio-Approve-High':'yes'}).status_code == 409
    generation.assert_not_called()


def test_hard_limit_cannot_be_overridden(setup):
    client, counter, generation = setup
    counter.return_value = 21000
    preview = client.post(PREVIEW,json=BODY).json()
    assert preview['blocked'] and preview['ticket'] is None
    assert client.post(PATH,json=BODY,headers={'X-Studio-Approve-High':'yes'}).status_code == 428
    generation.assert_not_called()


def test_count_growth_requires_new_preview_even_after_approval(setup):
    client, counter, generation = setup
    ticket = client.post(PREVIEW,json=BODY).json()['ticket']
    counter.return_value = 2000
    response = client.post(PATH,json=BODY,headers={'X-Studio-Ticket':ticket,'X-Studio-Approve-High':'yes'})
    assert response.status_code == 409
    generation.assert_not_called()


def test_count_outage_fails_closed(setup):
    client, counter, generation = setup
    counter.side_effect = RuntimeError('secret-provider-details')
    response = client.post(PREVIEW,json=BODY)
    assert response.status_code == 502 and 'secret-provider' not in response.text
    generation.assert_not_called()


def test_image_batch_counts_actual_variants_and_binds_image_model(setup):
    client, counter, generation = setup
    body = {'image_url':'https://example.com/cap.png','mode':'variant','variants':[{'name':'red'},{'name':'blue'}]}
    preview = client.post('/api/studio/preflight/images',json=body).json()
    assert preview['image_count'] == 2 and preview['requires_confirmation']
    assert preview['image_model'] == 'gpt-image-2.5-flare'
    assert client.post('/api/studio/images',json=body,headers={'X-Studio-Ticket':preview['ticket']}).status_code == 428
    assert client.post('/api/studio/images',json={**body,'model':'gpt-image-2'},headers={'X-Studio-Ticket':preview['ticket'],'X-Studio-Approve-High':'yes'}).status_code == 409
    generation.assert_not_called()
