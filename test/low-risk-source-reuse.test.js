import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyChangeRisk } from '../src/change-risk-classifier.js';

const fileGroups = (sourceFiles, extra = {}) => ({ source: { files: sourceFiles }, ...extra });
const stats = (entries) => Object.fromEntries(
  Object.entries(entries).map(([file, [additions, deletions]]) => [file, { additions, deletions }])
);

test('risk surface非該当の1ファイル小差分は_low_risk_evidence_changeに分類される', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js']),
    diffStats: stats({ 'src/language.js': [8, 4] })
  });
  assert.equal(result.profile, 'light');
  assert.equal(result.change_type, 'low_risk_evidence_change');
  assert.equal(result.evidence_reuse_policy.allowed, true);
  assert.equal(result.evidence_reuse_policy.mode, 'small_source_low_risk_reuse');
});

test('2ファイル合計30行ちょうどの小差分は_reuse対象になる', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js', 'src/html-report.js']),
    diffStats: stats({
      'src/language.js': [10, 5],
      'src/html-report.js': [10, 5]
    })
  });
  assert.equal(result.change_type, 'low_risk_evidence_change');
  assert.equal(result.evidence_reuse_policy.allowed, true);
});

test('合計31行の差分は_reuse対象にならない', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js']),
    diffStats: stats({ 'src/language.js': [21, 10] })
  });
  assert.equal(result.change_type, 'simple_code_change');
  assert.equal(result.evidence_reuse_policy.allowed, false);
  assert.equal(result.evidence_reuse_policy.mode, 'strict_current_git_binding');
});

test('sourceファイルが3つの場合は_行数が少なくてもreuse対象にならない', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js', 'src/html-report.js', 'src/doctor.js']),
    diffStats: stats({
      'src/language.js': [2, 1],
      'src/html-report.js': [2, 1],
      'src/doctor.js': [2, 1]
    })
  });
  assert.equal(result.change_type, 'simple_code_change');
  assert.equal(result.evidence_reuse_policy.allowed, false);
});

test('risk surfaceに該当するsource変更は_小差分でもreuse対象にならない', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/api/routes.js']),
    diffStats: stats({ 'src/api/routes.js': [3, 1] })
  });
  assert.equal(result.profile, 'api_contract');
  assert.notEqual(result.change_type, 'low_risk_evidence_change');
  assert.equal(result.evidence_reuse_policy.allowed, false);
});

test('行数不明のsourceファイルが含まれる場合は_reuse対象にならない', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js', 'src/html-report.js']),
    diffStats: stats({ 'src/language.js': [3, 1] })
  });
  assert.equal(result.change_type, 'simple_code_change');
  assert.equal(result.evidence_reuse_policy.allowed, false);
});

test('diffStats未提供の場合は_従来どおりsimple_code_changeのまま', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js'])
  });
  assert.equal(result.change_type, 'simple_code_change');
  assert.equal(result.evidence_reuse_policy.allowed, false);
});

test('regression hotspotに該当する小差分は_reuse対象にならない', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js']),
    diffStats: stats({ 'src/language.js': [3, 1] }),
    regressionRisk: {
      hotspots: [{ file: 'src/language.js', fan_in: 18, coverage_pct: 95, risk_tier: 'high', priority: 'high' }]
    }
  });
  assert.notEqual(result.change_type, 'low_risk_evidence_change');
  assert.equal(result.evidence_reuse_policy.allowed, false);
});

test('小差分sourceとStory_Spec_test変更の混在は_reuse対象になる', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js'], {
      story_docs: { files: ['docs/management/stories/active/story-x.md'] },
      specifications: { files: ['docs/specs/x.md'] },
      tests: { files: ['test/language.test.js'] }
    }),
    diffStats: stats({ 'src/language.js': [5, 2] })
  });
  assert.equal(result.change_type, 'low_risk_evidence_change');
  assert.equal(result.evidence_reuse_policy.allowed, true);
  assert.equal(result.evidence_reuse_policy.mode, 'small_source_low_risk_reuse');
});

test('repo_controlファイルが混在する小差分は_reuse対象にならない', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js'], {
      repo_control: { files: ['package.json'] }
    }),
    diffStats: stats({ 'src/language.js': [5, 2], 'package.json': [1, 1] })
  });
  assert.equal(result.change_type, 'simple_code_change');
  assert.equal(result.evidence_reuse_policy.allowed, false);
});

test('docs_specs_testsのみの変更は_従来のpath_scoped_low_risk_reuseのまま', () => {
  const result = classifyChangeRisk({
    fileGroups: {
      story_docs: { files: ['docs/management/stories/active/story-x.md'] },
      tests: { files: ['test/language.test.js'] }
    }
  });
  assert.equal(result.change_type, 'low_risk_evidence_change');
  assert.equal(result.evidence_reuse_policy.allowed, true);
  assert.equal(result.evidence_reuse_policy.mode, 'path_scoped_low_risk_reuse');
  assert.deepEqual(result.changed_surfaces.sort(), ['story_docs', 'tests']);
  assert.deepEqual(result.evidence_reuse_policy.scoped_invalidation.changed_surface_files.tests, ['test/language.test.js']);
});
