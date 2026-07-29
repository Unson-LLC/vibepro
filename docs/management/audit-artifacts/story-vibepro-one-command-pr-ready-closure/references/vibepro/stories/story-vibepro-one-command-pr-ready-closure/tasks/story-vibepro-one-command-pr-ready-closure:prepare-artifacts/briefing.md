# 修正前ブリーフィング

## 前提

- Story: 1コマンド自律実装を実Runtime E2Eで閉じる (`story-vibepro-one-command-pr-ready-closure`)
- Runtime dispatch: `dispatch-76d744478e3f04bc`
- Task: `story-vibepro-one-command-pr-ready-closure:prepare-artifacts`
- Current HEAD: `a9109350819af99df22448d6ed8bd75adf611e36`
- Gate: `gate:artifact_consistency`

## 目的

Current HEAD に対して、既存の Story -> Architecture -> Spec を参照できる Task projection を追加する。対象は planning artifact のみであり、stale な review result の再記録や Gate waiver はこのタスクの範囲外。

## 対象ファイル

- `docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md`
- `docs/architecture/story-vibepro-one-command-pr-ready-closure.md`
- `docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json`
- `docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md`
- `.vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts`

## ガードレール

- PR作成、merge、Gate waiver、deploy、publish、外部副作用を実行しない。
- stale review artifact をこのタスクで再記録しない。
- product code を変更しない。
