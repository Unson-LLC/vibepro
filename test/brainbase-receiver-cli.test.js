import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';

test('CLIは実HTTP送信後の受信記録を保存し、再実行でPOSTを重複しない', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-receiver-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const event = {
    schema_version: 'knowledge_event.v1', event_id: 'ke_cli', body_hash: 'a'.repeat(64),
    subject: { type: 'development_learning', id: 'story-cli' },
    applicability_scope: { scope: 'project', project_code: 'project/test' },
    decision_authority: { authorized: false, graph_promotion_allowed: false },
    permission_snapshot: { graph_promotion: false }
  };
  const file = path.join(root, '.vibepro/integrations/brainbase/outbox/ke_cli.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ schema_version: 'vibepro-brainbase-outbox.v1', event_id: event.event_id, candidate: event, status: 'pending', delivery_status: 'pending' }));
  const calls = [];
  const server = createServer(async (req, res) => {
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, organization: req.headers['x-brainbase-organization-id'] });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      calls.at(-1).body = JSON.parse(body);
      res.writeHead(202);
      res.end(JSON.stringify({ event_id: event.event_id, candidate_id: 'candidate-cli', processing_stage: 'retrievable', semantic_state: 'active', graph_entity_id: null }));
    } else {
      res.end(JSON.stringify({ schema_version: 'knowledge_cycle_receipt.v1', event_id: event.event_id, candidate_id: 'candidate-cli', processing_stage: 'retrievable', semantic_state: 'active', failure_reason: null, retrievable_at: '2026-09-04T00:00:00Z', stage_history: [{ stage: 'retrievable', occurred_at: '2026-09-04T00:00:00Z' }] }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const env = { BRAINBASE_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.address().port}`, BRAINBASE_KNOWLEDGE_API_TOKEN: 'fixture-token', BRAINBASE_KNOWLEDGE_ORGANIZATION_ID: 'org-fixture' };
  const run = async (environment) => {
    let output = '';
    const result = await runCli(['integration', 'brainbase', 'reconcile', root, '--json'], { env: environment, stdout: { write: (chunk) => { output += chunk; } }, stderr: { write() {} } });
    return { result, body: JSON.parse(output) };
  };
  const missing = await run({});
  assert.equal(missing.result.exitCode, 2);
  assert.equal(missing.body.status, 'pending');
  assert.equal(calls.length, 0);
  const delivered = await run(env);
  assert.equal(delivered.result.exitCode, 0);
  assert.equal(delivered.body.confirmed, 1);
  assert.deepEqual(calls.map(({ method, url }) => ({ method, url })), [
    { method: 'POST', url: '/api/knowledge/events' },
    { method: 'GET', url: '/api/knowledge/cycles/ke_cli?project_code=project%2Ftest' }
  ]);
  assert.deepEqual(calls[0].body, { ...event, organization_id: 'org-fixture' });
  assert.ok(calls.every((call) => call.authorization === 'Bearer fixture-token' && call.organization === 'org-fixture'));
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(persisted.receiver_status, 'confirmed');
  assert.equal(persisted.receiver_ack.candidate_id, 'candidate-cli');
  assert.equal(persisted.receiver_receipt.event_id, event.event_id);
  assert.ok(!JSON.stringify(persisted).includes('fixture-token'));
  const repeated = await run(env);
  assert.equal(repeated.result.exitCode, 0);
  assert.equal(calls.length, 2);
  const changedOrganization = await run({ ...env, BRAINBASE_KNOWLEDGE_ORGANIZATION_ID: 'different-org' });
  assert.equal(changedOrganization.result.exitCode, 1);
  assert.equal(changedOrganization.body.confirmed, 0);
  assert.equal(changedOrganization.body.entries[0].reason, 'receiver_target_mismatch');
  assert.equal(calls.length, 2);
});
