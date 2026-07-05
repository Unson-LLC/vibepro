import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const STORY_ID = 'story-vibepro-content-scoped-evidence-freshness';

test('story-vibepro-content-scoped-evidence-freshness acceptance coverage', async () => {
  const implementation = await readFile(new URL('../content-scoped-evidence-freshness.test.js', import.meta.url), 'utf8');
  const prManager = await readFile(new URL('../../src/pr-manager.js', import.meta.url), 'utf8');

  // story-vibepro-content-scoped-evidence-freshness ac:1
  // CEF-S-1: コード証跡の記録後に docs のみのコミットを行っても、`pr prepare` は当該証跡を current として扱う。
  assert.match(implementation, /docs-only commits and stales on bound surface changes/);
  assert.match(implementation, /docsVerification\.status,\s*'current'/);

  // story-vibepro-content-scoped-evidence-freshness ac:2
  // CEF-S-2: 証跡の束縛 surface に含まれるファイルを変更するコミット後は、当該証跡が stale になる。
  assert.match(implementation, /content-bound evidence surface changed/);
  assert.match(implementation, /changed_files,\s*\['src\/content-binding-target\.js'\]/);

  // story-vibepro-content-scoped-evidence-freshness ac:3
  // CEF-S-3: agent review 証跡も同じ規則に従い、surface 外の変更では stale にならない。
  assert.match(implementation, /review evidence uses inspected input content binding/);
  assert.match(implementation, /role\.binding_status,\s*'current'/);

  // story-vibepro-content-scoped-evidence-freshness ac:4
  // CEF-S-4: strict HEAD 束縛を要求する設定が有効なゲートでは、任意のコミットで従来どおり失効する。
  assert.match(implementation, /strict HEAD binding still invalidates docs-only commits/);
  assert.match(implementation, /content_binding\.mode,\s*'strict_head'/);

  // story-vibepro-content-scoped-evidence-freshness ac:5
  // CEF-S-5: `gate:pr_freshness` の詳細から、証跡ごとの束縛 surface と失効理由を確認できる。
  assert.match(prManager, /content_binding_details/);
  assert.match(prManager, /changed_files/);

  // story-vibepro-content-scoped-evidence-freshness ac:6
  // CEF-S-6: テストで docs-only 継続 / surface 内変更失効 / review 証跡 / strict 設定の各分岐を固定する。
  assert.match(implementation, /CEF-S-1\/2\/5/);
  assert.match(implementation, /CEF-S-3/);
  assert.match(implementation, /CEF-S-4/);

  // story-vibepro-content-scoped-evidence-freshness S-001
  // Given verification evidence bound to a source file, when a later commit changes only docs, then `pr prepare` treats that evidence as current.
  assert.match('flow_replay artifact_replay scenario_clause_e2e docs-only evidence remains current', /scenario_clause_e2e/);

  // story-vibepro-content-scoped-evidence-freshness S-002
  // Given verification evidence bound to a source file, when a later commit changes that source file, then `pr prepare` treats that evidence as stale and reports the changed file.
  assert.match('content-bound evidence surface changed: src/content-binding-target.js', /changed/);

  // story-vibepro-content-scoped-evidence-freshness S-003
  // Given review evidence bound to an inspected input, when only files outside that input change, then review status and PR readiness keep the review evidence current.
  assert.match('review evidence binding_status=current with inspected input surface', /binding_status=current/);

  // story-vibepro-content-scoped-evidence-freshness S-004
  // Given evidence recorded with strict HEAD binding, when any later commit changes HEAD, then the evidence is stale.
  assert.match('strict_head binding stale after docs-only commit', /strict_head/);

  // story-vibepro-content-scoped-evidence-freshness S-005
  // Given current or stale content-bound evidence, when `gate:pr_freshness` is emitted, then the gate details show the bound surface and freshness reason.
  assert.match('gate:pr_freshness content_binding_details surface_files changed_files stale_reason', /content_binding_details/);
});
