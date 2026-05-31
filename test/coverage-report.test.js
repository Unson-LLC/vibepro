import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadCoverage, parseIstanbulJson, parseLcov } from '../src/coverage-report.js';

test('parseLcov computes line-coverage fraction from LF/LH', () => {
  const lcov = [
    'SF:/repo/src/a.js',
    'DA:1,1',
    'LF:10',
    'LH:5',
    'end_of_record',
    'SF:/repo/src/b.js',
    'LF:4',
    'LH:4',
    'end_of_record'
  ].join('\n');
  const map = parseLcov(lcov);
  assert.equal(map.get('/repo/src/a.js'), 0.5);
  assert.equal(map.get('/repo/src/b.js'), 1);
});

test('parseIstanbulJson reads coverage-summary line counts', () => {
  const json = JSON.stringify({
    total: { lines: { total: 100, covered: 80, pct: 80 } },
    'src/a.js': { lines: { total: 10, covered: 3, pct: 30 } }
  });
  const map = parseIstanbulJson(json);
  assert.equal(map.get('src/a.js'), 0.3);
  assert.ok(!map.has('total'));
});

test('parseIstanbulJson reads coverage-final statement hits', () => {
  const json = JSON.stringify({
    'src/a.js': { s: { 0: 1, 1: 0, 2: 1, 3: 0 } }
  });
  const map = parseIstanbulJson(json);
  assert.equal(map.get('src/a.js'), 0.5);
});

test('loadCoverage returns null when no report exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-cov-'));
  assert.equal(await loadCoverage(root), null);
});

test('loadCoverage finds and normalizes an istanbul summary to repo-relative paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-cov-'));
  await mkdir(path.join(root, 'coverage'), { recursive: true });
  await writeFile(
    path.join(root, 'coverage', 'coverage-summary.json'),
    JSON.stringify({
      total: { lines: { total: 10, covered: 5, pct: 50 } },
      [path.join(root, 'src/a.js')]: { lines: { total: 10, covered: 2, pct: 20 } }
    })
  );
  const loaded = await loadCoverage(root);
  assert.equal(loaded.source, 'coverage/coverage-summary.json');
  assert.equal(loaded.coverage.get('src/a.js'), 0.2);
});
