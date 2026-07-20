---
parent_design: vibepro-autonomy-roadmap-rebaseline
---

# Review Finding Repair Loop Architecture

## Decision

`needs_changes` / `block` の内容修正は、review lifecycle 障害を扱う `src/review-repair.js` から分離し、`src/review-finding-repair-loop.js` が所有する。元の review result は更新せず、finding fingerprint、disposition、repair task、runtime dispatch、verification、再reviewを append-only attempt として保存する。

## Boundary

- Input: stage/role の current review result、明示された acceptance clause、code scope、test scope。
- Classification: concrete scopeを持つ `needs_changes` は `repairable`。architecture/security/scope splitまたは境界判断を要求する `block` は `human_decision` / `split_required`。具体的な修正行為を持たないものは `non_actionable`。
- Execution: repairable taskだけが Agent Runtime Adapter向けのtyped implementation requestを得る。公開CLIの`dispatch` / `poll`も同じcoordinator境界を使い、runtime transitionをstateへatomicに保存する。
- Evidence: implementation後はcanonical `.vibepro/pr/<story-id>/verification-evidence.json`と`pr-prepare.json`からcurrent HEADにbindした証跡を読み、implementationとは別identity/sessionの同stage・同role再reviewが揃うまで収束扱いにしない。複数repairable findingは全attemptがpassするまで収束しない。
- Stop: 同じfingerprintが再出現してHEADが進まない場合、またはmax attempts到達時は`no_progress`。Human Checkpointと停止stateは判断主体、decision question、再計画またはStory分割の次commandを公開する。

## Persistence

`.vibepro/review-finding-repair/<story-id>/<stage>/<role>/state.json` にloop stateを保存する。path segmentは検証し、hierarchy外への逸脱を拒否する。各attemptは元review artifact、verdict、finding snapshot、disposition、task、dispatch/result/evidence/re-review参照を保持し、過去attemptを書き換えない。

## Reason

Alternatives considered: lifecycle repairへ統合、free-form agent promptだけで修正、無制限retry。独立loopを選ぶことで障害回復と内容判断を混同せず、Task境界と停止条件を機械検証できる。compatibility impactは新command/artifactの追加のみ。rollbackはdispatchせず生成planを手動実行する。architecture/security/scope判断はHuman Checkpointに残す。
