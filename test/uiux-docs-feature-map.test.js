import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readRepoFile(repoPath) {
  return readFile(path.join(PACKAGE_ROOT, repoPath), 'utf8');
}

test('UI/UX docs feature map exposes a single modernization workflow without changing runtime contracts', async () => {
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

  assert.match(readme, /Prepare A UI\/UX Modernization PR/);
  assert.match(readme, /vibepro pr prepare/);
  assert.match(readmeJa, /UI\/UX Modernization PR/);
  assert.match(readmeJa, /vibepro pr prepare/);
  assert.match(featureMap, /UI\/UX/);
  assert.match(featureMap, /design-modernize/);
  assert.match(featureMap, /UI\/UX cockpit/);
  assert.match(featureMapJa, /UI\/UX/);
  assert.match(featureMapJa, /design-modernize/);
  assert.match(playbookTemplate, /visual hypothesis/);
  assert.match(playbookTemplate, /VibePro-native Design System/);
  assert.match(storyDoc, /parent_design: vibepro-uiux-one-command-cockpit/);
  assert.match(storyDoc, /does not remove the whole\nplaybook corpus/);
  assert.match(storyDoc, /minimal playbook link targets needed for public docs build/);
  assert.match(storyDoc, /CLI commands, public API behavior, configuration schema,\nruntime execution, and PR creation semantics are intentionally out of scope/);
  assert.doesNotMatch(vitepressConfig, /['"]playbooks\/\*\*['"]/);
  assert.match(vitepressConfig, /playbooks\/story-engineering-playbook\/features\/_feature-template\/\*\*/);
  assert.match(playbookFeatureIndex, /機能仕様/);
  assert.match(playbookInformationArchitecture, /情報設計/);
  assert.match(playbookStateGuidelines, /状態表示/);
  assert.match(playbookCopyGuidelines, /コピー・文言/);
});
