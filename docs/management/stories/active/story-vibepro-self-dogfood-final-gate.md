---
story_id: story-vibepro-self-dogfood-final-gate
title: VibePro自身の変更を最終Gate DAGで完了判定する
status: active
source:
  type: local_log_audit
  id: codex-claude-vibepro-gate-audit-2026-05-23
architecture_docs:
  - docs/architecture/vibepro-self-dogfood-final-gate.md
spec_docs:
  - docs/specs/vibepro-self-dogfood-final-gate.md
---

# Story

VibePro自身の開発では、`verify record` の証跡だけを残して `pr prepare` / `gate-dag` の最終判定を通さないケースがあった。

VibeProは、自分自身の変更についても「テストを実行した」ではなく「Storyに紐づく最終Gate DAGでPR作成可能か判定した」ことを完了条件にする必要がある。

## Acceptance Criteria

- verification evidence があるのに `pr-prepare.json` / `gate-dag.json` がないStoryを検出できる。
- `gate-dag.overall_status != ready_for_review` のまま完了扱いしない。
- malformed `gate-dag.json` をvalidな最終Gate証跡として扱わず、block findingとして表示できる。
- unresolved Gateのまま `pr-create.json` がある場合、VibePro waiverなしのPR作成経路をblock findingとして表示できる。
- docs / skills / agent-instructions / CI上の raw `gh pr create` 誘導やAgent Review skip / permission-wait文言を検出できる。
- 検出結果は `.vibepro/checks/self-dogfood/<run-id>/check.json` と `check.md` に残る。
- Story IDで対象を絞り込める。対象Storyに無関係なinstruction findingは混ぜない。

## Tasks

- [x] self-dogfood check packを追加する。
- [x] verification evidenceのみで止まっているStoryを検出する。
- [x] unresolved Gate DAGをfinding化する。
- [x] malformed Gate DAGをfinding化する。
- [x] PR create bypassとinstruction bypassをfinding化する。
- [x] Story ID filterをPR artifactとinstruction artifactの両方に適用する。
- [x] unit testを追加する。
