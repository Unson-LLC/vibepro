# 実装計画

## 前提

- Story: `story-vibepro-one-command-pr-ready-closure`
- Task: `story-vibepro-one-command-pr-ready-closure:prepare-artifacts`
- Runtime dispatch: `dispatch-76d744478e3f04bc`
- Current HEAD: `a9109350819af99df22448d6ed8bd75adf611e36`
- Gate source: `.vibepro/pr/story-vibepro-one-command-pr-ready-closure/pr-prepare.json`

## 方針

Story、Architecture、Spec はすでに存在する。今回の不足は runtime dispatch の `prepare-artifacts` を current HEAD で追跡する Task projection なので、`.vibepro/stories/.../tasks/` 配下に planning artifact のみを追加する。

## 手順

1. `docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md` を Story 正本として確認する。
2. `docs/architecture/story-vibepro-one-command-pr-ready-closure.md` を Architecture 正本として確認する。
3. `docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json` と test plan を Spec 正本として確認する。
4. `story-vibepro-one-command-pr-ready-closure:prepare-artifacts` の Task package を追加し、task index へ登録する。
5. JSON parse、task package listing、`pr prepare --summary-json` で artifact と Gate view を検証する。

## 完了条件

- Task package が存在する。
- Task package が current HEAD `a9109350819af99df22448d6ed8bd75adf611e36` に束縛されている。
- 参照元が Story -> Architecture -> Spec -> Task の順に追える。
- product code、review result、waiver、PR/merge/deploy artifact を変更しない。
