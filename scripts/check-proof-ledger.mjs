#!/usr/bin/env node
// Deterministic guard for docs/proofs/*.json proof ledgers.
// A claim may only carry a proof depth that its cited implementation and tests actually support:
//   - P1+ requires at least one cited test whose name exists verbatim in the cited test file
//   - every cited implementation / test / reference path must exist in the repository
//   - status must agree with depth (historical / superseded / refuted / design_only / current_untested
//     may not claim a current P1+ depth backed by tests that no longer exist)
//   - not_proven must be non-empty unless the claim is refuted
// Usage: node scripts/check-proof-ledger.mjs [ledger.json ...]  (defaults to docs/proofs/*.json)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPTHS = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const TESTED_STATUSES = new Set(['current_unit', 'current_integrated', 'forward_validated', 'live_validated', 'cross_system']);
const UNTESTED_STATUSES = new Set(['design_only', 'current_untested', 'historical', 'superseded', 'refuted']);
const STATUSES = new Set([...TESTED_STATUSES, ...UNTESTED_STATUSES]);
const MIN_DEPTH_FOR_STATUS = { current_unit: 1, current_integrated: 2, forward_validated: 4, live_validated: 5, cross_system: 6 };

export function validateProofLedger(ledger, { repoRoot, readText = defaultReadText, exists = defaultExists } = {}) {
  const errors = [];
  const fail = (claimId, message) => errors.push(claimId ? `${claimId}: ${message}` : message);

  if (!ledger || typeof ledger !== 'object') return ['ledger must be an object'];
  if (ledger.kind !== 'vibepro_judgment_proof_ledger') fail(null, `unsupported kind: ${ledger.kind}`);
  if (typeof ledger.system !== 'string' || !ledger.system) fail(null, 'system is required');
  if (!Array.isArray(ledger.claims) || ledger.claims.length === 0) return [...errors, 'claims must be a non-empty array'];
  if (!Array.isArray(ledger.gaps)) fail(null, 'gaps must be an array');
  if (!Array.isArray(ledger.transfer_hypotheses)) fail(null, 'transfer_hypotheses must be an array');
  for (const depth of DEPTHS) {
    if (!ledger.proof_depth_scale || typeof ledger.proof_depth_scale[depth] !== 'string') fail(null, `proof_depth_scale.${depth} is required`);
  }
  for (const status of STATUSES) {
    if (!Array.isArray(ledger.status_vocabulary) || !ledger.status_vocabulary.includes(status)) fail(null, `status_vocabulary must include ${status}`);
  }

  const seen = new Set();
  const claimIds = new Set(ledger.claims.map(claim => claim?.id));
  for (const claim of ledger.claims) {
    const id = claim?.id;
    if (typeof id !== 'string' || !/^[A-Z]+-[A-Z0-9]+-\d{3}$/.test(id)) { fail(null, `invalid claim id: ${String(id)}`); continue; }
    if (seen.has(id)) fail(id, 'duplicate claim id');
    seen.add(id);
    for (const key of ['capability', 'layer', 'claim']) {
      if (typeof claim[key] !== 'string' || !claim[key]) fail(id, `${key} is required`);
    }
    if (Array.isArray(ledger.layers) && !ledger.layers.includes(claim.layer)) fail(id, `layer ${claim.layer} is not in ledger.layers`);
    if (!DEPTHS.includes(claim.depth)) fail(id, `depth must be one of ${DEPTHS.join(',')}`);
    if (!STATUSES.has(claim.status)) fail(id, `status must be one of ${[...STATUSES].join(',')}`);
    if (!Array.isArray(claim.conditions)) fail(id, 'conditions must be an array');
    if (!Array.isArray(claim.not_proven)) fail(id, 'not_proven must be an array');
    else if (claim.not_proven.length === 0 && claim.status !== 'refuted') fail(id, 'not_proven must name at least one unproven aspect');
    if (claim.status === 'refuted' && typeof claim.refuted_by !== 'string') fail(id, 'refuted claims must cite refuted_by');
    if ((claim.status === 'historical' || claim.status === 'superseded') && typeof claim.removed_in !== 'string' && typeof claim.superseded_by !== 'string') {
      fail(id, 'historical/superseded claims must cite removed_in or superseded_by');
    }

    const source = claim.source ?? {};
    const implementation = Array.isArray(source.implementation) ? source.implementation : [];
    const tests = Array.isArray(source.tests) ? source.tests : [];
    const references = Array.isArray(source.references) ? source.references : [];
    for (const file of [...implementation, ...references]) {
      if (!exists(repoRoot, file)) fail(id, `cited path does not exist: ${file}`);
    }

    let verifiedTestNames = 0;
    for (const entry of tests) {
      if (!entry || typeof entry.file !== 'string' || !Array.isArray(entry.names) || entry.names.length === 0) {
        fail(id, 'each tests entry needs file and non-empty names');
        continue;
      }
      if (!exists(repoRoot, entry.file)) { fail(id, `cited test file does not exist: ${entry.file}`); continue; }
      const text = readText(repoRoot, entry.file);
      for (const name of entry.names) {
        if (testNameIsDeclared(text, name)) verifiedTestNames += 1;
        else fail(id, `test name not declared in ${entry.file}: ${name}`);
      }
    }

    const depthIndex = DEPTHS.indexOf(claim.depth);
    if (TESTED_STATUSES.has(claim.status)) {
      if (depthIndex < MIN_DEPTH_FOR_STATUS[claim.status]) fail(id, `status ${claim.status} requires depth >= P${MIN_DEPTH_FOR_STATUS[claim.status]}`);
      if (implementation.length === 0) fail(id, `status ${claim.status} requires cited implementation`);
      if (verifiedTestNames === 0) fail(id, `status ${claim.status} requires at least one verified test name`);
    } else if (claim.status === 'current_untested') {
      if (depthIndex !== 0) fail(id, 'current_untested claims must stay at P0');
      if (implementation.length === 0) fail(id, 'current_untested claims must cite implementation');
      if (tests.length !== 0) fail(id, 'current_untested claims must not cite tests');
    } else if (claim.status === 'design_only') {
      if (depthIndex !== 0) fail(id, 'design_only claims must stay at P0');
      if (implementation.length !== 0 || tests.length !== 0) fail(id, 'design_only claims must not cite implementation or tests');
    } else if (claim.status === 'historical' || claim.status === 'superseded' || claim.status === 'refuted') {
      if (references.length === 0) fail(id, `${claim.status} claims must cite references`);
    }
  }

  for (const gap of ledger.gaps ?? []) {
    if (typeof gap?.id !== 'string') { fail(null, 'gap without id'); continue; }
    for (const key of ['summary', 'evidence', 'consequence']) if (typeof gap[key] !== 'string' || !gap[key]) fail(gap.id, `${key} is required`);
    if (!Array.isArray(gap.related_claims) || gap.related_claims.length === 0) fail(gap.id, 'related_claims must be non-empty');
    for (const ref of gap.related_claims ?? []) if (!claimIds.has(ref)) fail(gap.id, `related claim not found: ${ref}`);
  }
  const gapIds = new Set((ledger.gaps ?? []).map(gap => gap?.id));
  for (const hypothesis of ledger.transfer_hypotheses ?? []) {
    if (typeof hypothesis?.id !== 'string') { fail(null, 'transfer hypothesis without id'); continue; }
    if (!['inbound', 'outbound'].includes(hypothesis.direction)) fail(hypothesis.id, 'direction must be inbound or outbound');
    for (const key of ['source_system', 'source_proof', 'hypothesis', 'expected_evidence', 'falsifier', 'status']) {
      if (typeof hypothesis[key] !== 'string' || !hypothesis[key]) fail(hypothesis.id, `${key} is required`);
    }
    if (!DEPTHS.includes(hypothesis.source_proof_depth)) fail(hypothesis.id, 'source_proof_depth must be a P0..P6 depth');
    if (hypothesis.direction === 'inbound' && typeof hypothesis.target_gap === 'string' && !gapIds.has(hypothesis.target_gap) && !claimIds.has(hypothesis.target_gap)) {
      fail(hypothesis.id, `target_gap not found: ${hypothesis.target_gap}`);
    }
    if (hypothesis.direction === 'outbound' && typeof hypothesis.target_system !== 'string') fail(hypothesis.id, 'outbound hypotheses need target_system');
  }
  return errors;
}

export function testNameIsDeclared(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:test|it|describe)\\s*\\(\\s*(?:'${escaped}'|"${escaped}"|\`${escaped}\`)`).test(text);
}

function defaultExists(repoRoot, file) { return existsSync(path.join(repoRoot, file)); }
function defaultReadText(repoRoot, file) { return readFileSync(path.join(repoRoot, file), 'utf8'); }

export function checkProofLedgerFiles(files, repoRoot) {
  const results = [];
  for (const file of files) {
    let ledger;
    try { ledger = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { results.push({ file, errors: [`invalid JSON: ${error.message}`] }); continue; }
    results.push({ file, errors: validateProofLedger(ledger, { repoRoot }) });
  }
  return results;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ledgerDir = path.join(repoRoot, 'docs', 'proofs');
  const files = process.argv.slice(2).length > 0
    ? process.argv.slice(2).map(file => path.resolve(file))
    : readdirSync(ledgerDir).filter(name => name.endsWith('.json')).map(name => path.join(ledgerDir, name));
  const results = checkProofLedgerFiles(files, repoRoot);
  let failed = false;
  for (const { file, errors } of results) {
    const relative = path.relative(repoRoot, file);
    if (errors.length === 0) { console.log(`ok ${relative}`); continue; }
    failed = true;
    console.error(`FAIL ${relative}`);
    for (const error of errors) console.error(`  - ${error}`);
  }
  process.exit(failed ? 1 : 0);
}
