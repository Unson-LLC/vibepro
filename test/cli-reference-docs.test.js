import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TOP_LEVEL_COMMANDS } from '../src/cli.js';
import { parseUsageCommands } from '../scripts/generate-cli-reference.mjs';

test('CLI reference parser fails closed on malformed or empty Usage output', () => {
  assert.throws(
    () => parseUsageCommands('VibePro help without a usage section', 'en'),
    /Usage section missing from en help/
  );
  assert.throws(
    () => parseUsageCommands('VibePro\nUsage:\n  unrelated command\n', 'en'),
    /No commands found in en help/
  );
});

test('CLI reference parser accepts only complete vibepro Usage commands', () => {
  assert.deepEqual(
    parseUsageCommands('VibePro\nUsage:\n  vibepro status [repo]  \n  npm test\n  vibepro pr prepare [repo]\n', 'en'),
    ['  vibepro status [repo]', '  vibepro pr prepare [repo]']
  );
});

test('generated CLI references match the current help contract', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-cli-reference.mjs', '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
});

test('generated CLI references cover every top-level command and current critical contracts', async () => {
  for (const file of ['docs/reference/cli.md', 'docs/ja/reference/cli.md']) {
    const content = await readFile(file, 'utf8');
    for (const command of TOP_LEVEL_COMMANDS) {
      assert.match(content, new RegExp(`vibepro ${command.replace('-', '\\-')}(?: |\\n)`));
    }
    assert.match(content, /pr prepare \[repo\].*--story-id <id>/);
    assert.match(content, /verify record \[repo\].*--kind <unit\|integration\|e2e\|typecheck\|build>.*--status <pass\|fail\|needs_setup>/);
    assert.match(content, /review record \[repo\].*--stage <stage>.*--status <pass\|needs_changes\|block>/);
    assert.match(content, /execute <run\|status\|watch\|resume\|cancel\|start\|next\|reconcile\|merge>/);
  }
});
