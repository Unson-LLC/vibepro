import './support/scratch-tmpdir.js';

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BRAINBASE_OUTBOX_DIR,
  getBrainbaseIntegrationStatus,
  reconcileBrainbaseOutbox
} from '../src/brainbase-integration.js';
import { initWorkspace } from '../src/workspace.js';

const OUTBOX_SCHEMA = 'vibepro-brainbase-outbox.v1';
const EVENT_SCHEMA = 'knowledge_event.v1';
const RECEIPT_SCHEMA = 'knowledge_cycle_receipt.v1';
const STORY_ID = 'story-receiver-ack-fixture';
const NOW = '2026-09-04T00:00:00.000Z';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function makeRepo({
  eventId = 'kev_receiver_ack_fixture',
  deliveryStatus = 'pending',
  receiverStatus = 'unknown',
  attempts = 0,
  nextRetryAt = null
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-brainbase-receiver-ack-'));
  await initWorkspace(root);
  const candidate = {
    schema_version: EVENT_SCHEMA,
    event_id: eventId,
    body_hash: 'a'.repeat(64),
    payload: {
      schema_version: 'vibepro-development-learning.v1',
      story_id: STORY_ID,
      summary: 'receiver acknowledgement fixture'
    }
  };
  const outbox = {
    schema_version: OUTBOX_SCHEMA,
    outbox_id: 'outbox_' + eventId,
    event_id: eventId,
    kind: 'learning_candidate',
    status: deliveryStatus,
    delivery_status: deliveryStatus,
    receiver_status: receiverStatus,
    attempts,
    retry_count: attempts,
    next_retry_at: nextRetryAt,
    last_error: null,
    created_at: NOW,
    updated_at: NOW,
    candidate
  };
  const filePath = path.join(root, BRAINBASE_OUTBOX_DIR, eventId + '.json');
  await writeJson(filePath, outbox);
  return { root, filePath, eventId, candidate };
}

async function readOutbox(fixture) {
  return JSON.parse(await readFile(fixture.filePath, 'utf8'));
}

function receipt(eventId, candidateId, overrides = {}) {
  return {
    schema_version: RECEIPT_SCHEMA,
    event_id: eventId,
    candidate_id: candidateId,
    processing_stage: 'retrievable',
    semantic_state: 'active',
    failure_reason: null,
    retrievable_at: NOW,
    stage_history: [{ stage: 'retrievable', occurred_at: NOW }],
    ...overrides
  };
}

test('送信元未設定のpending候補は送信せずreceiver_status=unknownを維持する', async () => {
  const fixture = await makeRepo();

  const result = await reconcileBrainbaseOutbox(fixture.root, { now: NOW, env: {} });

  assert.equal(result.status, 'pending');
  assert.equal(result.attempted, 0);
  assert.equal(result.pending, 1);
  assert.equal(result.entries[0].reason, 'sender_not_configured');
  const outbox = await readOutbox(fixture);
  assert.equal(outbox.delivery_status, 'pending');
  assert.equal(outbox.receiver_status, 'unknown');
});

test('legacy callbackがundefinedを返す成功はsentだがreceiver_status=unknownになる', async () => {
  const fixture = await makeRepo();
  let sendCalls = 0;

  const result = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    send: async () => {
      sendCalls += 1;
      return undefined;
    }
  });

  assert.equal(sendCalls, 1);
  assert.equal(result.status, 'pending');
  assert.equal(result.attempted, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.unconfirmed, 1);
  assert.equal(result.entries[0].receiver_status, 'unknown');
  const outbox = await readOutbox(fixture);
  assert.equal(outbox.delivery_status, 'sent');
  assert.equal(outbox.receiver_status, 'unknown');
});

test('sentかつ未確認の候補を再実行しても送信を二重実行しない', async () => {
  const fixture = await makeRepo();
  let sendCalls = 0;
  const send = async () => {
    sendCalls += 1;
    return undefined;
  };

  const first = await reconcileBrainbaseOutbox(fixture.root, { now: NOW, env: {}, send });
  const second = await reconcileBrainbaseOutbox(fixture.root, { now: '2026-09-04T00:00:01.000Z', env: {}, send });

  assert.equal(first.sent, 1);
  assert.equal(second.status, 'pending');
  assert.equal(second.attempted, 0);
  assert.equal(second.sent, 0);
  assert.equal(second.unconfirmed, 1);
  assert.equal(sendCalls, 1);
  assert.equal((await readOutbox(fixture)).attempts, 1);
});

test('送信失敗はpendingに戻り、期限後の再実行で送信成功する', async () => {
  const fixture = await makeRepo();
  let sendCalls = 0;

  const failed = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    retryDelayMs: 1,
    send: async () => {
      sendCalls += 1;
      throw new Error('temporary transport failure');
    }
  });

  assert.equal(failed.status, 'partial');
  assert.equal(failed.attempted, 1);
  assert.equal(failed.pending, 1);
  assert.equal(failed.failed, 1);
  assert.equal((await readOutbox(fixture)).delivery_status, 'pending');

  const retried = await reconcileBrainbaseOutbox(fixture.root, {
    now: '2026-09-04T00:00:01.000Z',
    env: {},
    retryDelayMs: 1,
    send: async () => {
      sendCalls += 1;
      return undefined;
    }
  });

  assert.equal(sendCalls, 2);
  assert.equal(retried.status, 'pending');
  assert.equal(retried.attempted, 1);
  assert.equal(retried.sent, 1);
  assert.equal(retried.unconfirmed, 1);
  const outbox = await readOutbox(fixture);
  assert.equal(outbox.delivery_status, 'sent');
  assert.equal(outbox.attempts, 2);
  assert.equal(outbox.receiver_status, 'unknown');
});

test('ackとretrievable receiptが一致すればconfirmedとして保存する', async () => {
  const fixture = await makeRepo();
  const candidateId = 'candidate_receiver_ack';
  let sendCalls = 0;
  let readbackCalls = 0;

  const result = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    send: async (candidate) => {
      sendCalls += 1;
      assert.equal(candidate.event_id, fixture.eventId);
      return { event_id: fixture.eventId, candidate_id: candidateId };
    },
    readback: async (candidate, item) => {
      readbackCalls += 1;
      assert.equal(candidate.event_id, fixture.eventId);
      assert.equal(item.receiver_ack.candidate_id, candidateId);
      return receipt(fixture.eventId, candidateId);
    }
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.sent, 1);
  assert.equal(result.confirmed, 1);
  assert.equal(result.unconfirmed, 0);
  assert.equal(result.failed, 0);
  assert.equal(sendCalls, 1);
  assert.equal(readbackCalls, 1);
  assert.equal(result.entries[0].receiver_status, 'confirmed');

  const outbox = await readOutbox(fixture);
  assert.equal(outbox.delivery_status, 'sent');
  assert.equal(outbox.receiver_status, 'confirmed');
  assert.equal(outbox.receiver_receipt.processing_stage, 'retrievable');
  const status = await getBrainbaseIntegrationStatus(fixture.root);
  assert.equal(status.outbox.confirmed, 1);
  assert.equal(status.outbox.unconfirmed, 0);
  assert.equal(status.outbox.entries[0].receiver_status, 'confirmed');
});

test('indexed receiptはactiveでもunknownのままreadback確認を継続する', async () => {
  const fixture = await makeRepo();
  const candidateId = 'candidate_indexed';
  let readbackCalls = 0;

  const result = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    send: async () => ({ event_id: fixture.eventId, candidate_id: candidateId }),
    readback: async () => {
      readbackCalls += 1;
      return receipt(fixture.eventId, candidateId, {
        processing_stage: 'indexed',
        retrievable_at: null,
        stage_history: [{ stage: 'indexed', occurred_at: NOW }]
      });
    }
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.confirmed, 0);
  assert.equal(result.unconfirmed, 1);
  assert.equal(readbackCalls, 1);
  const outbox = await readOutbox(fixture);
  assert.equal(outbox.delivery_status, 'sent');
  assert.equal(outbox.receiver_status, 'unknown');
  assert.equal(outbox.receiver_error, 'Brainbase candidate is not yet retrievable');
});

test('retrievableでも時刻または段階履歴が欠ければunknownのままにする', async () => {
  const fixture = await makeRepo();
  const candidateId = 'candidate_missing-retrievable-evidence';
  let readbackCalls = 0;

  const result = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    send: async () => ({ event_id: fixture.eventId, candidate_id: candidateId }),
    readback: async () => {
      readbackCalls += 1;
      return receipt(fixture.eventId, candidateId, {
        retrievable_at: null,
        stage_history: [{ stage: 'indexed', occurred_at: NOW }]
      });
    }
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.confirmed, 0);
  assert.equal(result.unconfirmed, 1);
  assert.equal(readbackCalls, 1);
  assert.equal((await readOutbox(fixture)).receiver_status, 'unknown');
});

test('receiverのGET失敗後は期限後にreadbackだけ再試行しPOSTを重複実行しない', async () => {
  const fixture = await makeRepo();
  const candidateId = 'candidate_get-retry';
  let sendCalls = 0;
  let readbackCalls = 0;

  const first = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    retryDelayMs: 1,
    send: async () => {
      sendCalls += 1;
      return { event_id: fixture.eventId, candidate_id: candidateId };
    },
    readback: async () => {
      readbackCalls += 1;
      throw new Error('receiver GET unavailable');
    }
  });

  assert.equal(first.status, 'partial');
  assert.equal(first.sent, 1);
  assert.equal(first.confirmed, 0);
  assert.equal(first.unconfirmed, 1);
  assert.equal(first.failed, 1);
  assert.equal(sendCalls, 1);
  assert.equal(readbackCalls, 1);

  const second = await reconcileBrainbaseOutbox(fixture.root, {
    now: '2026-09-04T00:00:01.000Z',
    env: {},
    retryDelayMs: 1,
    send: async () => {
      sendCalls += 1;
      throw new Error('duplicate POST');
    },
    readback: async (candidate, item) => {
      readbackCalls += 1;
      return receipt(candidate.event_id, item.receiver_ack.candidate_id);
    }
  });

  assert.equal(second.status, 'ok');
  assert.equal(second.attempted, 0);
  assert.equal(second.sent, 0);
  assert.equal(second.confirmed, 1);
  assert.equal(second.failed, 0);
  assert.equal(sendCalls, 1);
  assert.equal(readbackCalls, 2);
  const outbox = await readOutbox(fixture);
  assert.equal(outbox.attempts, 1);
  assert.equal(outbox.receiver_attempts, 2);
  assert.equal(outbox.receiver_status, 'confirmed');
});

test('quarantined receiptはfailedとして記録する', async () => {
  const fixture = await makeRepo();
  const candidateId = 'candidate_quarantined';

  const result = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    send: async () => ({ event_id: fixture.eventId, candidate_id: candidateId }),
    readback: async () => receipt(fixture.eventId, candidateId, {
      semantic_state: 'quarantined',
      failure_reason: 'candidate rejected by receiver'
    })
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.sent, 1);
  assert.equal(result.unconfirmed, 1);
  assert.equal(result.failed, 1);
  const outbox = await readOutbox(fixture);
  assert.equal(outbox.receiver_status, 'failed');
  assert.equal(outbox.receiver_receipt.semantic_state, 'quarantined');
  assert.equal(outbox.receiver_error, 'Brainbase receiver reports an inactive or failed candidate');
});

test('ackのevent_id不一致はfailedとして記録しreadbackを呼ばない', async () => {
  const fixture = await makeRepo();
  let readbackCalls = 0;

  const result = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    send: async () => ({ event_id: fixture.eventId + '_other', candidate_id: 'candidate_mismatch' }),
    readback: async () => {
      readbackCalls += 1;
      return null;
    }
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.sent, 1);
  assert.equal(result.unconfirmed, 1);
  assert.equal(result.failed, 1);
  assert.equal(readbackCalls, 0);
  const outbox = await readOutbox(fixture);
  assert.equal(outbox.delivery_status, 'sent');
  assert.equal(outbox.receiver_status, 'failed');
  assert.match(outbox.receiver_error, /acknowledgement identity does not match/u);
});

test('readbackのcandidate_id不一致はfailedとして記録する', async () => {
  const fixture = await makeRepo();
  const candidateId = 'candidate_readback_mismatch';

  const result = await reconcileBrainbaseOutbox(fixture.root, {
    now: NOW,
    env: {},
    send: async () => ({ event_id: fixture.eventId, candidate_id: candidateId }),
    readback: async () => receipt(fixture.eventId, candidateId + '_other')
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.sent, 1);
  assert.equal(result.unconfirmed, 1);
  assert.equal(result.failed, 1);
  const outbox = await readOutbox(fixture);
  assert.equal(outbox.delivery_status, 'sent');
  assert.equal(outbox.receiver_status, 'failed');
  assert.match(outbox.receiver_error, /readback does not match the acknowledged candidate/u);
});
