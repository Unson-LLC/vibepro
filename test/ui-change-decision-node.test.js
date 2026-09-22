import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('UI変更Specは標準primitive探索と独自実装理由を求める', async () => {
  const template = await readRepoFile('docs/playbooks/story-engineering-playbook/features/_feature-template/03_ui_ux_spec.md');

  assert.match(template, /共通UI primitive/);
  assert.match(template, /類似画面・利用箇所/);
  assert.match(template, /標準部品や既存の類似実装がある場合は、原則としてそれを利用する/);
  assert.match(template, /独自primitiveを採用する場合は、既存部品では満たせない具体的な契約/);
});

test('視覚的不具合は対象viewportの画像と目視評価なしに完了しない', async () => {
  const [template, manualPolicy] = await Promise.all([
    readRepoFile('docs/playbooks/story-engineering-playbook/features/_feature-template/03_ui_ux_spec.md'),
    readRepoFile('docs/playbooks/story-engineering-playbook/testing/04_manual_test_policy.md')
  ]);

  assert.match(template, /ユーザー指摘を再現する対象viewport/);
  assert.match(template, /修正前スクリーンショット/);
  assert.match(template, /修正後スクリーンショット/);
  assert.match(template, /`overflow: 0`、DOM寸法、自動テスト成功だけでは視覚品質の証明にしない/);
  assert.match(template, /CSS調整を2回行っても解消しない場合/);
  assert.match(manualPolicy, /同じ条件の修正前後スクリーンショット/);
  assert.match(manualPolicy, /目視で改善したと判断した理由/);
});

test('UI判断ノードは旧Gateや証跡収集ループを復活させない', async () => {
  const template = await readRepoFile('docs/playbooks/story-engineering-playbook/features/_feature-template/03_ui_ux_spec.md');

  assert.match(template, /UI変更時だけの小さな確認/);
  assert.match(template, /旧Gate DAG、強制並列レビュー、証跡収集ループを要求しない/);
  assert.doesNotMatch(template, /ready判定.*Gate DAG/);
});
