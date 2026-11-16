import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readRepoFile(repoPath) {
  return readFile(path.join(PACKAGE_ROOT, repoPath), 'utf8');
}

test('the public feature map describes the minimal core while legacy UI/UX playbooks stay internal', async () => {
  const [
    readme,
    readmeJa,
    featureMap,
    featureMapJa,
    playbookTemplate,
    storyDoc,
    vitepressConfig,
    playbookFeatureIndex,
    playbookInformationArchitecture,
    playbookStateGuidelines,
    playbookCopyGuidelines
  ] = await Promise.all([
    readRepoFile('README.md'),
    readRepoFile('README.ja.md'),
    readRepoFile('docs/guide/feature-map.md'),
    readRepoFile('docs/ja/guide/feature-map.md'),
    readRepoFile('docs/playbooks/story-engineering-playbook/features/_feature-template/03_ui_ux_spec.md'),
    readRepoFile('docs/management/stories/active/story-vibepro-uiux-docs-feature-map.md'),
    readRepoFile('docs/.vitepress/config.mjs'),
    readRepoFile('docs/playbooks/story-engineering-playbook/features/index.md'),
    readRepoFile('docs/playbooks/story-engineering-playbook/design/02_information_architecture.md'),
    readRepoFile('docs/playbooks/story-engineering-playbook/design/07_state_guidelines.md'),
    readRepoFile('docs/playbooks/story-engineering-playbook/design/08_copy_guidelines.md')
  ]);

  assert.match(readme, /The current minimal core is intentionally small\./);
  assert.match(readme, /former broad Gate DAG.*removed during the minimal-core rebuild/);
  assert.match(readme, /vibepro pr prepare/);
  assert.match(readmeJa, /現行の最小コアは意図的に小さく保っています。/);
  assert.match(readmeJa, /広範なGate DAG.*最小コア再構築.*削除/);
  assert.match(readmeJa, /vibepro pr prepare/);
  assert.match(featureMap, /Preserve product intent/);
  assert.match(featureMap, /design-modernization pipelines/);
  assert.match(featureMap, /not current features/);
  assert.match(featureMapJa, /プロダクト意図の保存/);
  assert.match(featureMapJa, /design modernization pipeline/);
  assert.match(playbookTemplate, /visual hypothesis/);
  assert.match(playbookTemplate, /VibePro-native Design System/);
  assert.match(storyDoc, /parent_design: vibepro-uiux-one-command-cockpit/);
  assert.match(storyDoc, /does not remove the whole\nplaybook corpus/);
  assert.match(storyDoc, /minimal playbook link targets needed for public docs build/);
  assert.match(storyDoc, /CLI commands, public API behavior, configuration schema,\nruntime execution, and PR creation semantics are intentionally out of scope/);
  assert.match(vitepressConfig, /['"]playbooks\/\*\*['"]/);
  assert.doesNotMatch(vitepressConfig, /playbooks\/story-engineering-playbook\/features\/_feature-template\/\*\*/);
  assert.match(playbookFeatureIndex, /機能仕様/);
  assert.match(playbookInformationArchitecture, /情報設計/);
  assert.match(playbookStateGuidelines, /状態表示/);
  assert.match(playbookCopyGuidelines, /コピー・文言/);
});
