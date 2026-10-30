import assert from 'node:assert/strict';
import test from 'node:test';
import { detectDocsOnlyChange } from '../src/docs-only-change.js';

test('sizing excludes .vibepro, docs, and lockfiles and counts src/test as product code', () => {
  const diffStats = Object.fromEntries(['.vibepro/reviews/record.json', 'docs/guide.md', 'package-lock.json', 'nested/npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'].map((file) => [file, { additions: 1000, deletions: 1000 }]));
  assert.equal(detectDocsOnlyChange({ diffStats, diffStatsStatus: 'available' }).product_code_changed_lines, 0);
  diffStats['src/main.js'] = { additions: 10, deletions: 2 };
  diffStats['test/main.test.js'] = { additions: 5, deletions: 1 };
  assert.equal(detectDocsOnlyChange({ diffStats, diffStatsStatus: 'available' }).product_code_changed_lines, 18);
});
