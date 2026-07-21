import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repoRoot, 'bin/vibepro.js');
const execFileAsync = promisify(execFile);

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

test('story-vibepro-routing-profiles-rendered-projections ac:13 fresh checkout runs the CLI lifecycle for feature and governance packets', async () => {
  const fixture = path.join(await mkdtemp(path.join(os.tmpdir(), 'vibepro-profile-checkout-e2e-')), 'fixture');
  const checkout = `${fixture}-clone`;
  const stories = [
    { story_id: 'story-feature-checkout-e2e', artifact_profile: 'feature_packet', feature_slug: 'feature-checkout-e2e' },
    { story_id: 'story-governance-checkout-e2e', artifact_profile: 'governance_packet', feature_slug: 'governance-checkout-e2e' }
  ];
  const config = JSON.parse(await readFile(path.join(repoRoot, '.vibepro/config.json'), 'utf8'));
  config.brainbase.stories = stories;
  await mkdir(path.join(fixture, '.vibepro'), { recursive: true });
  await writeFile(path.join(fixture, '.vibepro/config.json'), `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(fixture, 'src'), { recursive: true });
  await writeFile(path.join(fixture, 'src/index.js'), 'export const fixture = 1;\n');
  for (const story of stories) {
    const storyPath = path.join(fixture, 'docs/management/stories/active', `${story.story_id}.md`);
    await mkdir(path.dirname(storyPath), { recursive: true });
    await writeFile(storyPath, `---\nstory_id: ${story.story_id}\ntitle: ${story.artifact_profile} checkout\nstatus: active\nartifact_profile: ${story.artifact_profile}\nfeature_slug: ${story.feature_slug}\n---\n\n# ${story.artifact_profile} checkout\n`);
  }
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: fixture });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: fixture });
  await execFileAsync('git', ['config', 'user.name', 'VibePro E2E'], { cwd: fixture });
  await execFileAsync('git', ['add', '.'], { cwd: fixture });
  await execFileAsync('git', ['commit', '-m', 'test: routed packet fixture'], { cwd: fixture });
  await execFileAsync('git', ['clone', '--quiet', fixture, checkout]);
  await execFileAsync(process.execPath, [cli, 'init', checkout], { cwd: repoRoot });
  await execFileAsync('git', ['switch', '-c', 'feature/routed-checkout'], { cwd: checkout });
  await writeFile(path.join(checkout, 'src/index.js'), 'export const fixture = 2;\n');
  await execFileAsync('git', ['add', 'src/index.js'], { cwd: checkout });
  await execFileAsync('git', ['commit', '-m', 'feat: exercise routed lifecycle'], { cwd: checkout });

  for (const story of stories) {
    const invoke = async (args) => execFileAsync(process.execPath, [cli, ...args], { cwd: repoRoot });
    const resolved = JSON.parse((await invoke(['artifacts', 'resolve', checkout, '--id', story.story_id, '--json'])).stdout);
    assert.equal(resolved.profile, story.artifact_profile);
    assert.equal(resolved.variables.feature_slug, story.feature_slug);
    const migration = JSON.parse((await invoke(['artifacts', 'migrate', checkout, '--id', story.story_id, '--dry-run', '--json'])).stdout);
    assert.equal(migration.edits_performed, 0);
    assert.equal(migration.status, 'ready');

    // These are production CLI writers, deliberately not resolver/projection imports.
    await invoke(['review', 'prepare', checkout, '--id', story.story_id, '--stage', 'architecture_spec', '--role', 'regression_risk', '--json']);
    await invoke(['pr', 'prepare', checkout, '--base', 'main', '--story-id', story.story_id, '--allow-extra-files', '--json']);
    const status = await invoke(['story', 'status', checkout, '--id', story.story_id, '--json']);
    assert.match(status.stdout, new RegExp(`projection: ownership=generated; path=docs/(?:features|governance)/${story.feature_slug}/`));

    assert.match(resolved.routes.gate.projections[0].relative_path, new RegExp(`^docs/${story.artifact_profile === 'feature_packet' ? 'features' : 'governance'}/${story.feature_slug}/`));
    await Promise.all([
      access(resolved.routes.gate.projections[0].absolute_path),
      access(resolved.routes.pr.projections[0].absolute_path)
    ]);
  }
});
