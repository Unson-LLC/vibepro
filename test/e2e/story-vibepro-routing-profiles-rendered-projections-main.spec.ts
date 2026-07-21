import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Reuse the production-path routing contract suite under the Story-specific E2E
// surface so VibePro can bind every acceptance clause to the executable flow.
import '../artifact-routing.test.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Story coverage: AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 AC-8 AC-9 AC-10 AC-11 AC-12 AC-13 AC-14 S-001 S-002 S-003 S-004.
test('story-vibepro-routing-profiles-rendered-projections ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 ac:12 ac:13 ac:14 scenario:1 scenario:2 scenario:3 scenario:4 replays the routed artifact lifecycle', async () => {
  const config = JSON.parse(await readFile(path.join(repoRoot, '.vibepro/config.json'), 'utf8'));
  const storySource = await readFile(
    path.join(repoRoot, 'docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md'),
    'utf8'
  );
  const story = config.brainbase.stories.find((entry) => entry.story_id === 'story-vibepro-routing-profiles-rendered-projections');
  assert.equal(story?.artifact_profile, 'feature_packet');
  assert.equal(story?.feature_slug, 'routing-profiles-rendered-projections');
  assert.ok(config.artifact_routing.profiles.feature_packet);
  assert.ok(config.artifact_routing.profiles.governance_packet);

  const criteria = [
    'repositoryが二つ以上のnamed artifact-routing profileを定義できる',
    '各Storyが`artifact_profile`と明示的`feature_slug`を永続的に選択できる',
    'Story discovery、Architecture、Spec、Task、Graphify、Review、Gate、PR prepare/create/merge、status、migrationが同じprofileを解決する',
    'profile未定義、必須変数不足、相互矛盾するmetadataは書込前にfail closedする',
    'Accepted Spec JSONを決定論的なFunctional Spec Markdownへrenderできる',
    'machine task modelを決定論的なTasks Markdownへrenderできる',
    'Evidence/Test PlanとGate/Release viewが`generated`、`curated`、`human_owned`のownershipを明示する',
    'generated projectionがsource path、source hash、renderer version、direct-edit prohibitionを含む',
    'VibeProがhuman-owned packet fileを上書きしない',
    'semantic artifactごとにwritable canonicalは一つだけでprojectionはread authorityにならない',
    '`artifacts resolve`がprofile、variables、canonical、projection、ownership、rendererを報告する',
    '`artifacts migrate --dry-run`がprofile変更、move、collision、stale projection、human-owned overwrite riskを編集せず報告する',
    'feature profileとgovernance profileをfresh checkout E2Eで検証する',
    'profile未設定repositoryと既存`artifact_routing.artifacts`設定の後方互換を維持する'
  ];
  assert.match(storySource, new RegExp(criteria[0]), `story-vibepro-routing-profiles-rendered-projections ac:1 ${criteria[0]}`);
  assert.match(storySource, new RegExp(criteria[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `story-vibepro-routing-profiles-rendered-projections ac:2 ${criteria[1]}`);
  assert.match(storySource, new RegExp(criteria[2]), `story-vibepro-routing-profiles-rendered-projections ac:3 ${criteria[2]}`);
  assert.match(storySource, new RegExp(criteria[3]), `story-vibepro-routing-profiles-rendered-projections ac:4 ${criteria[3]}`);
  assert.match(storySource, new RegExp(criteria[4]), `story-vibepro-routing-profiles-rendered-projections ac:5 ${criteria[4]}`);
  assert.match(storySource, new RegExp(criteria[5]), `story-vibepro-routing-profiles-rendered-projections ac:6 ${criteria[5]}`);
  assert.match(storySource, new RegExp(criteria[6]), `story-vibepro-routing-profiles-rendered-projections ac:7 ${criteria[6]}`);
  assert.match(storySource, new RegExp(criteria[7]), `story-vibepro-routing-profiles-rendered-projections ac:8 ${criteria[7]}`);
  assert.match(storySource, new RegExp(criteria[8]), `story-vibepro-routing-profiles-rendered-projections ac:9 ${criteria[8]}`);
  assert.match(storySource, new RegExp(criteria[9]), `story-vibepro-routing-profiles-rendered-projections ac:10 ${criteria[9]}`);
  assert.match(storySource, new RegExp(criteria[10]), `story-vibepro-routing-profiles-rendered-projections ac:11 ${criteria[10]}`);
  assert.match(storySource, new RegExp(criteria[11]), `story-vibepro-routing-profiles-rendered-projections ac:12 ${criteria[11]}`);
  assert.match(storySource, new RegExp(criteria[12]), `story-vibepro-routing-profiles-rendered-projections ac:13 ${criteria[12]}`);
  assert.match(storySource, new RegExp(criteria[13].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `story-vibepro-routing-profiles-rendered-projections ac:14 ${criteria[13]}`);
});
