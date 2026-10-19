import test from 'node:test';
import assert from 'node:assert/strict';

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES,
  LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC,
  PRIMARY_EVIDENCE_MAX_PNG,
  PRIMARY_EVIDENCE_MAX_VIEWPORT_STATE_CELLS,
  assessLocalizedBugFixEvidenceWarnings,
  assessMechanicalLocalizedBugFixProfile,
  assessUiEvidenceDemands,
  collectPrRangeChangePaths,
  isProductSourcePath,
  touchesSharedLayoutCssPath
} from '../src/localized-bugfix-evidence.js';
import { validateSpec } from '../src/spec-validator.js';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('mechanical localized_bug_fix accepts small single-file product diff', () => {
  const profile = assessMechanicalLocalizedBugFixProfile([
    { path: 'src/meeting-triage/place.js', changed_lines: 13 }
  ]);
  assert.equal(profile.meets_mechanical_localized_bug_fix, true);
  assert.equal(profile.product_source_file_count, 1);
});

test('#615-style diff: apps/web/public meeting-triage counts one product file and primary tier applies', () => {
  const paths = [
    { path: 'apps/web/public/meeting-triage.js', changed_lines: 13 },
    { path: 'test/meeting-triage.place.test.js', changed_lines: 40 },
    { path: 'scripts/measure-meeting-triage.js', changed_lines: 90 },
    { path: 'docs/design/meeting-triage-evidence.md', changed_lines: 12 },
    { path: 'evidence/meeting-triage-summary.json', changed_lines: 30 }
  ];
  const profile = assessMechanicalLocalizedBugFixProfile(paths);
  assert.equal(profile.product_source_file_count, 1);
  assert.deepEqual(profile.product_source_paths, ['apps/web/public/meeting-triage.js']);
  assert.equal(profile.meets_mechanical_localized_bug_fix, true);
  assert.equal(isProductSourcePath('apps/web/public/meeting-triage.js'), true);
  assert.equal(isProductSourcePath('scripts/measure-meeting-triage.js'), false);

  const warnings = assessLocalizedBugFixEvidenceWarnings({
    ui_verification: { evidence_tier: 'primary' },
    clauses: [{ statement: 'Fix place() alignment at bug viewport with summary JSON and unit test' }]
  }, {
    storyContractType: 'bug_fix',
    mechanicalProfile: profile
  });
  assert.equal(warnings.length, 0);
});

test('root tailwind.config.js, globals.css, and styles/ block mechanical primary profile', () => {
  for (const hit of ['tailwind.config.js', 'globals.css', 'styles/tokens.css']) {
    assert.equal(touchesSharedLayoutCssPath(hit), true, hit);
  }
  const profile = assessMechanicalLocalizedBugFixProfile([
    { path: 'apps/web/public/meeting-triage.js', changed_lines: 10 },
    { path: 'tailwind.config.js', changed_lines: 2 }
  ]);
  assert.equal(profile.meets_mechanical_localized_bug_fix, false);
  assert.ok(profile.shared_layout_css_hits.includes('tailwind.config.js'));
});

test('collectPrRangeChangePaths reads base...head and ignores unstaged-only files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-range-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'agent'], { cwd: root });
  await mkdir(path.join(root, 'apps/web/public'), { recursive: true });
  await writeFile(path.join(root, 'apps/web/public/base.js'), 'base\n');
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(path.join(root, 'apps/web/public/meeting-triage.js'), 'fix\n');
  await writeFile(path.join(root, 'UNSTAGED_ONLY.txt'), 'noise\n');
  await execFileAsync('git', ['add', 'apps/web/public/meeting-triage.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'fix'], { cwd: root });

  const observation = await collectPrRangeChangePaths(root, { baseRef: 'HEAD~1', headRef: 'HEAD' });
  assert.equal(observation.source, 'pr_range_diff');
  assert.match(observation.range, /HEAD~1\.\.\.HEAD/);
  const paths = observation.paths.map((entry) => entry.path);
  assert.ok(paths.includes('apps/web/public/meeting-triage.js'));
  assert.equal(paths.includes('UNSTAGED_ONLY.txt'), false);
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
