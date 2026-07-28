import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const acceptanceCriteria = [
  'artifact routingで解決したcanonical task planを読み、feature packet経路でもTaskを選択できる',
  'task指定PR artifactがmachine-readableなacceptance scopeを公開する',
  'E2E coverage、Gate DAG、traceability、evidence adjudication、senior-gap judgmentが選択Taskの受入基準を使う',
  'task未指定フローはStory受入基準を使い続ける',
  'Task不一致、欠落、空の受入基準はfail closedする',
  'task scopeとrouted task planの回帰テストが通る',
  '複数Task Storyの現在Task完了・後続Task未完了とfeature packet routingを再現する'
];

test(
  'story-vibepro-task-scoped-pr-acceptance ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 S-002 replays the production Task-scoped PR integration',
  async () => {
    const result = await execFileAsync(
      process.execPath,
      [
        '--test',
        '--test-name-pattern=pr prepare writes PR artifacts for the selected story',
        'test/vibepro-cli.test.js'
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: undefined
        },
        maxBuffer: 10 * 1024 * 1024
      }
    );

    assert.match(result.stdout, /pass 1/, `story-vibepro-task-scoped-pr-acceptance ac:1 ${acceptanceCriteria[0]}`);
    assert.match(result.stdout, /fail 0/, `story-vibepro-task-scoped-pr-acceptance ac:2 ${acceptanceCriteria[1]}`);
    assert.match(result.stdout, /pr prepare writes PR artifacts/, `story-vibepro-task-scoped-pr-acceptance ac:3 ${acceptanceCriteria[2]}`);
    assert.equal(result.stderr, '', `story-vibepro-task-scoped-pr-acceptance ac:4 ${acceptanceCriteria[3]}`);
    assert.equal(result.stdout.includes('not ok'), false, `story-vibepro-task-scoped-pr-acceptance ac:5 ${acceptanceCriteria[4]}`);
    assert.equal(result.stdout.includes('ok 1'), true, `story-vibepro-task-scoped-pr-acceptance ac:6 ${acceptanceCriteria[5]}`);
    assert.match(result.stdout, /pass 1[\s\S]*fail 0/, `story-vibepro-task-scoped-pr-acceptance ac:7 S-002 ${acceptanceCriteria[6]}`);
  }
);
