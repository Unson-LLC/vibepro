import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('binary entrypoint injects stdout, stderr, and process environment into runCli', async () => {
  const source = await readFile(new URL('../bin/vibepro.js', import.meta.url), 'utf8');

  assert.match(source, /stdout:\s*process\.stdout/);
  assert.match(source, /stderr:\s*process\.stderr/);
  assert.match(source, /env:\s*process\.env/);
  assert.doesNotMatch(source, /JSON\.stringify\(process\.env\)/);
});
