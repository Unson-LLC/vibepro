import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRequiredDiagrams } from '../src/diagram-requirement-resolver.js';

function input(overrides = {}) {
  return {
    story: { ac_count: 0, ac_keywords: [], ...overrides.story },
    code_diff: { files: [], deps_added: [], ...overrides.code_diff }
  };
}

test('R0: empty diff yields no required diagrams', () => {
  const result = resolveRequiredDiagrams(input());
  assert.deepEqual(result.required_diagrams, []);
  assert.deepEqual(result.reasons, []);
});

test('R1: prisma schema change requires ER diagram', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'prisma/schema.prisma', status: 'modified' }] }
  }));
  assert.ok(result.required_diagrams.includes('er'));
  assert.ok(result.reasons.some((r) => r.kind === 'er'));
});

test('R1: SQL migration file requires ER', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'db/migrations/0042_add_user.sql', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('er'));
});

test('R1: SQL file with CREATE TABLE content requires ER', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: {
      files: [{ path: 'src/sql/setup.sql', status: 'added', content: 'CREATE TABLE foo (id int);' }]
    }
  }));
  assert.ok(result.required_diagrams.includes('er'));
});

test('R2: status enum file requires state diagram', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: {
      files: [{ path: 'src/types/order.ts', status: 'modified', content: 'export enum OrderStatus { PENDING, SHIPPED }' }]
    }
  }));
  assert.ok(result.required_diagrams.includes('state'));
});

test('R2: xstate file path requires state', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'src/machines/order-xstate.ts', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('state'));
});

test('R3: webhook route requires sequence', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'src/api/stripe/webhook.ts', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('sequence'));
});

test('R3: queue dep requires sequence', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [], deps_added: ['bullmq'] }
  }));
  assert.ok(result.required_diagrams.includes('sequence'));
});

test('R3: 3rd party SDK dep requires sequence', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [], deps_added: ['stripe'] }
  }));
  assert.ok(result.required_diagrams.includes('sequence'));
});

test('R4: multi-step AC with checkout keyword requires flow', () => {
  const result = resolveRequiredDiagrams(input({
    story: { ac_count: 4, ac_keywords: ['checkout'] }
  }));
  assert.ok(result.required_diagrams.includes('flow'));
});

test('R4: AC count below threshold does not require flow', () => {
  const result = resolveRequiredDiagrams(input({
    story: { ac_count: 2, ac_keywords: ['checkout'] }
  }));
  assert.ok(!result.required_diagrams.includes('flow'));
});

test('R4: checkout path file requires flow', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'src/pages/checkout/index.tsx', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('flow'));
});

test('R5: new package boundary requires c4_context', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'packages/billing/package.json', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('c4_context'));
  const reason = result.reasons.find((r) => r.kind === 'c4_context');
  assert.ok(reason);
  assert.ok(reason.signal.includes('packages/billing'));
});

test('R5: new service directory requires c4_context', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'services/notify/index.ts', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('c4_context'));
});

test('R5: modified package.json does NOT trigger c4_context', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'packages/billing/package.json', status: 'modified' }] }
  }));
  assert.ok(!result.required_diagrams.includes('c4_context'));
});

test('R6: terraform file requires deployment', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'infra/main.tf', status: 'modified' }] }
  }));
  assert.ok(result.required_diagrams.includes('deployment'));
});

test('R6: fly.toml requires deployment', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'fly.toml', status: 'modified' }] }
  }));
  assert.ok(result.required_diagrams.includes('deployment'));
});

test('R7: auth file path requires threat_model', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'src/auth/login.ts', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('threat_model'));
});

test('R7 DDP-INV-003 DDP-CONTRACT-001: responsibility authority artifact requires threat_model with path signal', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'docs/responsibility-authority/story-269.json', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('threat_model'));
  assert.ok(result.reasons.some((reason) => (
    reason.kind === 'threat_model'
    && reason.signal.includes('responsibility authority artifact')
    && reason.signal.includes('docs/responsibility-authority/story-269.json')
  )));
});

test('R7 DDP-CONTRACT-002: security-sensitive contract artifact content requires threat_model with path signal', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: {
      files: [{
        path: 'docs/contracts/generation-state.json',
        status: 'added',
        content: '{"authority":"approve generation","policy":"operator signoff"}'
      }]
    }
  }));
  assert.ok(result.required_diagrams.includes('threat_model'));
  assert.ok(result.reasons.some((reason) => (
    reason.kind === 'threat_model'
    && reason.signal.includes('security-sensitive contract artifact')
    && reason.signal.includes('docs/contracts/generation-state.json')
  )));
});

test('R7 DDP-CONTRACT-002: hyphenated security contract terms require threat_model', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: {
      files: [{
        path: 'docs/contracts/data-sharing.json',
        status: 'added',
        content: '{"access-control":"strict","personal-data":"customer-name"}'
      }]
    }
  }));
  assert.ok(result.required_diagrams.includes('threat_model'));
  assert.ok(result.reasons.some((reason) => (
    reason.kind === 'threat_model'
    && reason.signal.includes('security-sensitive contract artifact')
    && reason.signal.includes('docs/contracts/data-sharing.json')
  )));
});

test('R7: bcrypt dep requires threat_model', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [], deps_added: ['bcrypt'] }
  }));
  assert.ok(result.required_diagrams.includes('threat_model'));
});

test('R7: PII column hint requires threat_model', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: {
      files: [{ path: 'prisma/schema.prisma', status: 'modified', content: 'model User { email String }' }]
    }
  }));
  assert.ok(result.required_diagrams.includes('threat_model'));
});

test('R8: cron file path requires dfd', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'src/cron/daily-summary.ts', status: 'added' }] }
  }));
  assert.ok(result.required_diagrams.includes('dfd'));
});

test('R8: kafkajs dep requires dfd', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [], deps_added: ['kafkajs'] }
  }));
  assert.ok(result.required_diagrams.includes('dfd'));
});

test('Multiple triggers compose without duplicates', () => {
  const result = resolveRequiredDiagrams(input({
    story: { ac_count: 5, ac_keywords: ['checkout'] },
    code_diff: {
      files: [
        { path: 'prisma/schema.prisma', status: 'modified', content: 'model User { email String }' },
        { path: 'src/api/stripe/webhook.ts', status: 'added' }
      ],
      deps_added: ['stripe']
    }
  }));
  assert.ok(result.required_diagrams.includes('er'));
  assert.ok(result.required_diagrams.includes('sequence'));
  assert.ok(result.required_diagrams.includes('threat_model'));
  assert.ok(result.required_diagrams.includes('flow'));
  const unique = new Set(result.required_diagrams);
  assert.equal(unique.size, result.required_diagrams.length);
});

test('Reasons include detection signal for each required kind', () => {
  const result = resolveRequiredDiagrams(input({
    code_diff: { files: [{ path: 'prisma/schema.prisma', status: 'modified' }] }
  }));
  const erReason = result.reasons.find((r) => r.kind === 'er');
  assert.ok(erReason);
  assert.ok(erReason.signal.includes('prisma/schema.prisma'));
});
