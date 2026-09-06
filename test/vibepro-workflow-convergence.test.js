import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const skillPath = path.resolve('skills/vibepro-workflow/SKILL.md');
const codexTemplatePath = path.resolve('agent-instructions/codex/AGENTS.vibepro.md');

test('workflow Skill defines the current lightweight Story-to-PR loop', async () => {
  const skill = await readFile(skillPath, 'utf8');

  assert.match(skill, /Story、最小のSpec、実装、影響範囲のテスト、通常のGitHub PR/);
  assert.match(skill, /1\. 合意済みのStoryと受け入れ条件を確認する。/);
  assert.match(skill, /2\. 振る舞いと不変条件を検証できる最小のSpecを書く。/);
  assert.match(skill, /4\. 実装し、変更の影響範囲に対応するテストだけを実行する。/);
  assert.match(skill, /5\. 必要な場合に限り一度だけレビューし、通常のGitHub PR、CI、mergeへ進む。/);
  assert.match(skill, /6\. 非阻害の指摘は現在の変更を膨らませず、後続StoryまたはIssueへ移す。/);
});

test('workflow Skill excludes the retired convergence and authority contract', async () => {
  const skill = await readFile(skillPath, 'utf8');

  assert.doesNotMatch(skill, /minimal-core-convergence-policy/);
  assert.doesNotMatch(skill, /Development Judgment loop/);
  assert.match(skill, /次を必須条件として要求・再生成しない。/);
  assert.match(skill, /Gate DAG、readiness Gate、delivery budget/);
  assert.match(skill, /`vibepro pr create`、`vibepro execute merge` の強制/);
  assert.match(skill, /未解決Gateを理由とした通常PRの停止/);
});

test('workflow and installed Codex guidance retain the normal GitHub authority boundary', async () => {
  const [skill, template] = await Promise.all([
    readFile(skillPath, 'utf8'),
    readFile(codexTemplatePath, 'utf8')
  ]);

  assert.match(skill, /通常のbranch → test → GitHub PR → review → merge/);
  assert.match(template, /Story → Spec → implement → affected tests → one review wave → GitHub PR → CI → merge/);
  assert.match(template, /`vibepro pr create` is optional convenience, not required authority/);
  assert.match(template, /Merge only through the repository's normal review and permission boundary/);
  assert.match(template, /Do not use or require retired contracts/);
});
