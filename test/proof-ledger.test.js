import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { checkProofLedgerFiles, testNameIsDeclared, validateProofLedger } from '../scripts/check-proof-ledger.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(repoRoot, 'docs', 'proofs', 'vibepro-judgment-proof-ledger.json');

function loadLedger() {
  return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

function fixtureFs(files) {
  return {
    repoRoot: '/fixture',
    exists: (_root, file) => Object.hasOwn(files, file),
    readText: (_root, file) => files[file]
  };
}

function minimalLedger(claim) {
  const base = loadLedger();
  return { ...base, claims: [claim], gaps: [], transfer_hypotheses: [] };
}

test('the committed VibePro judgment proof ledger cites only implementation, references and test names that exist at this HEAD', () => {
  const [result] = checkProofLedgerFiles([ledgerPath], repoRoot);
  assert.deepEqual(result.errors, []);
  const ledger = loadLedger();
  assert.ok(ledger.claims.some(claim => claim.status === 'refuted'), 'ledger keeps the refuted blocking Gate DAG claim on record');
  assert.ok(ledger.claims.some(claim => claim.status === 'historical'), 'ledger keeps removed adjudication as historical, not current');
  assert.ok(ledger.transfer_hypotheses.some(item => item.direction === 'inbound') && ledger.transfer_hypotheses.some(item => item.direction === 'outbound'));
});

test('a current claim cannot cite a test name that is not declared in the cited file', () => {
  const files = { 'src/x.js': '', 'test/x.test.js': "test('real behaviour', () => {});" };
  const claim = {
    id: 'VPJ-FIX-001', capability: 'c', layer: 'judgment', claim: 'x', depth: 'P1', status: 'current_unit',
    source: { implementation: ['src/x.js'], tests: [{ file: 'test/x.test.js', names: ['claimed but missing'] }] },
    conditions: [], not_proven: ['y']
  };
  const errors = validateProofLedger(minimalLedger(claim), fixtureFs(files));
  assert.ok(errors.some(error => error.includes('test name not declared')), errors.join('\n'));
  assert.ok(errors.some(error => error.includes('requires at least one verified test name')), errors.join('\n'));

  claim.source.tests[0].names = ['real behaviour'];
  assert.deepEqual(validateProofLedger(minimalLedger(claim), fixtureFs(files)), []);
});

test('proof depth cannot exceed what the status vocabulary allows and untested statuses cannot borrow test evidence', () => {
  const files = { 'src/x.js': '', 'test/x.test.js': "test('real behaviour', () => {});", 'docs/a.md': '' };
  const tested = { file: 'test/x.test.js', names: ['real behaviour'] };
  const cases = [
    [{ depth: 'P1', status: 'current_integrated', source: { implementation: ['src/x.js'], tests: [tested] } }, 'requires depth >= P2'],
    [{ depth: 'P1', status: 'current_untested', source: { implementation: ['src/x.js'], tests: [] } }, 'must stay at P0'],
    [{ depth: 'P0', status: 'current_untested', source: { implementation: ['src/x.js'], tests: [tested] } }, 'must not cite tests'],
    [{ depth: 'P0', status: 'design_only', source: { implementation: ['src/x.js'], tests: [] } }, 'must not cite implementation'],
    [{ depth: 'P2', status: 'historical', source: { implementation: [], tests: [], references: ['docs/a.md'] } }, 'removed_in or superseded_by'],
    [{ depth: 'P5', status: 'refuted', source: { implementation: [], tests: [], references: [] }, refuted_by: 'docs/a.md' }, 'must cite references'],
    [{ depth: 'P1', status: 'current_unit', source: { implementation: ['src/missing.js'], tests: [tested] } }, 'cited path does not exist']
  ];
  for (const [overrides, expected] of cases) {
    const claim = { id: 'VPJ-FIX-002', capability: 'c', layer: 'judgment', claim: 'x', conditions: [], not_proven: ['y'], ...overrides };
    const errors = validateProofLedger(minimalLedger(claim), fixtureFs(files));
    assert.ok(errors.some(error => error.includes(expected)), `expected "${expected}" in:\n${errors.join('\n')}`);
  }
});

test('gaps and transfer hypotheses must point at claims or gaps that exist', () => {
  const ledger = loadLedger();
  ledger.gaps.push({ id: 'VPJ-GAP-999', summary: 's', evidence: 'e', consequence: 'c', related_claims: ['VPJ-NOPE-000'] });
  ledger.transfer_hypotheses.push({
    id: 'VPJ-TH-IN-999', direction: 'inbound', source_system: 'fx', source_proof: 'p', source_proof_depth: 'P5',
    target_gap: 'VPJ-GAP-404', hypothesis: 'h', expected_evidence: 'e', falsifier: 'f', status: 'proposed'
  });
  const errors = validateProofLedger(ledger, { repoRoot });
  assert.ok(errors.some(error => error.includes('related claim not found: VPJ-NOPE-000')));
  assert.ok(errors.some(error => error.includes('target_gap not found: VPJ-GAP-404')));
});

test('test name matching is exact and quote-agnostic', () => {
  assert.equal(testNameIsDeclared("test('a (b) c', () => {})", 'a (b) c'), true);
  assert.equal(testNameIsDeclared('test(`a (b) c`, () => {})', 'a (b) c'), true);
  assert.equal(testNameIsDeclared("test('a (b) c more', () => {})", 'a (b) c'), false);
});
