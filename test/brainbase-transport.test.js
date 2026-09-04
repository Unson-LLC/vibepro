import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrainbaseTransport } from '../src/brainbase-transport.js';

const env = { BRAINBASE_KNOWLEDGE_API_URL: 'https://brainbase.example', BRAINBASE_KNOWLEDGE_API_TOKEN: 'fixture-secret', BRAINBASE_KNOWLEDGE_ORGANIZATION_ID: 'org-test' };
const candidate = { schema_version: 'knowledge_event.v1', event_id: 'kev_fixture', subject: { type: 'development_learning' }, applicability_scope: { project_code: 'test/project' }, decision_authority: { authorized: false, graph_promotion_allowed: false }, permission_snapshot: { graph_promotion: false } };

test('明示設定がなければtransportを作らず、部分設定・不正URLを拒否する', () => {
  assert.equal(createBrainbaseTransport({}), null);
  assert.throws(() => createBrainbaseTransport({ BRAINBASE_KNOWLEDGE_API_URL: 'https://brainbase.example' }));
  for (const url of ['http://remote.example', 'https://user:password@brainbase.example', 'https://brainbase.example/api', 'https://brainbase.example/../', 'https://brainbase.example?token=secret', 'https://brainbase.example#fragment']) {
    assert.throws(() => createBrainbaseTransport({ ...env, BRAINBASE_KNOWLEDGE_API_URL: url }));
  }
  assert.doesNotThrow(() => createBrainbaseTransport({ ...env, BRAINBASE_KNOWLEDGE_API_URL: 'http://127.0.0.1:1234' }));
});

test('既存POST/GET契約、認証、redirect禁止、タイムアウトを使う', async () => {
  const calls = [];
  const transport = createBrainbaseTransport(env, { fetch: async (url, options) => {
    calls.push({ url, options });
    return { status: options.method === 'POST' ? 202 : 200, json: async () => ({ event_id: candidate.event_id }) };
  } });
  await transport.send(candidate);
  await transport.readback(candidate);
  assert.equal(calls[0].url, 'https://brainbase.example/api/knowledge/events');
  assert.deepEqual(JSON.parse(calls[0].options.body), candidate);
  assert.equal(calls[1].url, 'https://brainbase.example/api/knowledge/cycles/kev_fixture?project_code=test%2Fproject');
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
    assert.equal(options.headers['x-brainbase-organization-id'], 'org-test');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(transport.target, { origin: 'https://brainbase.example', organization_id: 'org-test' });
});

test('POST200・HTTP失敗・JSON不正を成功とせず秘密情報をエラーに含めない', async () => {
  for (const fetch of [
    async () => ({ status: 200, json: async () => ({}) }),
    async () => ({ status: 401, json: async () => ({ token: 'fixture-secret' }) }),
    async () => { throw new Error('fixture-secret'); },
    async () => ({ status: 202, json: async () => { throw new Error('fixture-secret'); } })
  ]) {
    const transport = createBrainbaseTransport(env, { fetch });
    await assert.rejects(transport.send(candidate), (error) => !error.message.includes('fixture-secret'));
  }
});

test('別組織・昇格候補・不正イベントID・プロジェクト欠落を送信しない', async () => {
  const transport = createBrainbaseTransport(env, { fetch: async () => { assert.fail('unexpected network call'); } });
  for (const change of [
    { organization_id: 'other-org' },
    { subject: { type: 'decision' } },
    { decision_authority: { authorized: true, graph_promotion_allowed: true } },
    { event_id: '..' },
    { applicability_scope: {} }
  ]) {
    await assert.rejects(transport.send({ ...candidate, ...change }));
  }
});
