import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES,
  LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC,
  PRIMARY_EVIDENCE_MAX_PNG,
  PRIMARY_EVIDENCE_MAX_VIEWPORT_STATE_CELLS,
  assessLocalizedBugFixEvidenceWarnings,
  assessMechanicalLocalizedBugFixProfile,
  assessUiEvidenceDemands,
  isProductSourcePath,
  touchesSharedLayoutCssPath
} from '../src/localized-bugfix-evidence.js';
import { validateSpec } from '../src/spec-validator.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('mechanical localized_bug_fix accepts small single-file product diff', () => {
  const profile = assessMechanicalLocalizedBugFixProfile([
    { path: 'src/meeting-triage/place.js', changed_lines: 13 }
  ]);
  assert.equal(profile.meets_mechanical_localized_bug_fix, true);
  assert.equal(profile.product_source_file_count, 1);
});

test('shared layout glob disqualifies mechanical localized_bug_fix', () => {
  const profile = assessMechanicalLocalizedBugFixProfile([
    { path: 'src/feature/fix.ts', changed_lines: 5 },
    { path: 'src/app/layout.tsx', changed_lines: 2 }
  ]);
  assert.equal(profile.meets_mechanical_localized_bug_fix, false);
  assert.ok(touchesSharedLayoutCssPath('src/app/layout.tsx'));
});

test('product source file cap uses LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES', () => {
  const profile = assessMechanicalLocalizedBugFixProfile([
    { path: 'src/a.ts', changed_lines: 1 },
    { path: 'src/b.ts', changed_lines: 1 },
    { path: 'src/c.ts', changed_lines: 1 }
  ]);
  assert.equal(profile.product_source_file_count, 3);
  assert.equal(profile.meets_mechanical_localized_bug_fix, false);
  assert.ok(profile.disqualifiers.some((r) => r.startsWith('product_source_files:3>')));
  assert.equal(LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES, 2);
});

test('product LOC cap uses LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC', () => {
  const profile = assessMechanicalLocalizedBugFixProfile([
    { path: 'src/only.ts', changed_lines: LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC + 1 }
  ]);
  assert.equal(profile.meets_mechanical_localized_bug_fix, false);
});

test('tests paths are not product source', () => {
  assert.equal(isProductSourcePath('test/foo.test.js'), false);
  assert.equal(isProductSourcePath('src/foo.test.js'), false);
});

test('assessUiEvidenceDemands detects regression matrix language', () => {
  const demands = assessUiEvidenceDemands({
    clauses: [{
      statement: 'Capture full pixel matrix on every other screen at all widths × state'
    }]
  });
  assert.equal(demands.regression_matrix_demanded, true);
});

test('localized bug_fix cap warning is non-blocking on validateSpec', async () => {
  const spec = {
    schema_version: '0.1.0',
    story_id: 'story-fixture',
    clauses: [{
      id: 'S-1',
      type: 'scenario',
      statement: 'Attach 10 before.png files and full width × state grid on all screens',
      origin: {
        story_refs: [{ kind: 'acceptance_criteria', index: 0 }],
        architecture_refs: [],
        code_refs: [{ file: 'package.json', anchor: 'name' }],
        test_refs: []
      }
    }]
  };
  const validation = await validateSpec(repoRoot, spec, {
    expectedStoryId: 'story-fixture',
    mode: 'final',
    storyContractType: 'bug_fix',
    changePaths: [{ path: 'src/widget.ts', changed_lines: 10 }]
  });
  assert.equal(validation.ok, true);
  assert.ok(validation.warnings.some((w) => w.code === 'localized_bugfix_primary_evidence_cap_exceeded'));
});

test('primary PNG cap constant matches authoring guidance', () => {
  assert.equal(PRIMARY_EVIDENCE_MAX_PNG, 4);
  assert.equal(PRIMARY_EVIDENCE_MAX_VIEWPORT_STATE_CELLS, 6);
  const warnings = assessLocalizedBugFixEvidenceWarnings({
    clauses: [{ statement: 'Provide before.png after.png extra1.png extra2.png extra3.png extra4.png extra5.png' }]
  }, {
    storyContractType: 'bug_fix',
    mechanicalProfile: assessMechanicalLocalizedBugFixProfile([
      { path: 'src/x.ts', changed_lines: 4 }
    ])
  });
  assert.ok(warnings.length > 0);
});
