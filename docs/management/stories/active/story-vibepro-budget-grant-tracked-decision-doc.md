---
story_id: story-vibepro-budget-grant-tracked-decision-doc
title: "budget grant を diff でレビュー可能にする: decision record --source budget:delivery_efficiency:* が tracked decision document を必ず書く"
status: active
parent_story_id: story-vibepro-owner-gated-budget-override
reason:
  finding: >
    story-vibepro-owner-gated-budget-override の最終 runtime_contract レビューが
    medium finding `budget-grant-record-not-reviewable-in-diff` を挙げ、residual
    として受理された。owner grant の正本
    `.vibepro/pr/<story-id>/decision-records.json` は `.gitignore` 行5
    (`.vibepro/*`、untracked は config.json のみ) により repository に入らない。
    `git check-ignore -v` で確認済み。結果: PR をレビューする人間は
    `.vibepro/config.json` の引き上げ後の数値と agent が書いた
    `amendment_reason` は見えるが、Story の residual 節が偽造検出の材料とする
    grantor / digest / timestamp は diff に現れない。実害の実証: 本 worktree が
    prior story の branch を fast-forward した時点で、3件の grant を含む
    decision-records.json はどこにも存在しなかった。
  alternatives: >
    (a) 手書きの tracked decision document を --decision-doc <path> で必須化する
    案は、agent が任意の既存ファイルを指せて内容と grant の対応を保証できない
    ため退けた。(b) residual 節と cli.md に gap を明記するだけの案は、既存の
    tracked channel (docs/management/decisions/*.md, type:
    budget_override_approval) が新機構に黙って置き換えられた状態を恒久化する
    ため退けた。採用: grant 記録時に system が tracked document を決定論的に
    生成し、workspace record と相互参照させる。document の内容は
    budget_approval と同じ構造化フィールドから生成されるため、両チャネルの
    乖離は diff に現れる。
  compatibility: >
    budget grant を伴わない decision record の挙動は不変。budget grant の
    CLI フラグ面も不変（新フラグなし）。追加されるのは (1) tracked document の
    生成、(2) budget_approval.decision_doc フィールド。既存の
    resolveBudgetOverrideAuthority は decision_doc を検査しないため、
    既存 grant / grandfathered override の解決結果は変わらない。
  rollback: >
    src/decision-records.js の doc 生成ブロックと decision_doc フィールドを
    落とすだけで戻る。生成済み document は docs/management/decisions/ の
    通常の markdown であり、削除しても override 解決（workspace record 由来）
    には影響しない。
  boundary: >
    in-band 偽造（実在しない人間名での grant）は親 Story の residual のまま
    本 Story の範囲外。resolveBudgetOverrideAuthority に tracked document の
    存在検査を足すこと（fs 依存の导入）も範囲外 — 強制はこれまで通り
    workspace record + digest で行い、本 Story は「レビュー可能性」チャネル
    のみを扱う。過去の grandfathered override への遡及 document 生成も範囲外。
    ただし直近の実害である story-vibepro-owner-gated-budget-override の
    3 grant は backfill document を1件書いて閉じる。
---

# Story: budget grant を diff でレビュー可能にする

## 問題

`vibepro decision record --source budget:delivery_efficiency:<story-id>` が
mint する owner grant（grantor / grantor_kind / override_digest / recorded_by /
recorded_at）は `.vibepro/pr/<story-id>/decision-records.json` にのみ書かれ、
`.gitignore` により repository に入らない。PR レビュアが diff で見えるのは
`.vibepro/config.json` の数値と agent 記述の `amendment_reason` だけであり、
親 Story の residual 節が「偽造検出は人間が構造化された記録で行う」と
述べている当の構造化記録が、人間のレビュー面に届いていない。

repository には既に tracked channel が存在する:
`docs/management/decisions/*.md`（frontmatter `type: budget_override_approval`、
例: `2026-07-27-runner-direct-evidence-budget-approval.md`）。親 Story の
3 grant はこの channel に document を残さなかったため、新機構が既存の
レビュー可能 channel を untracked・agent-writable な channel で黙って
置き換えた形になっていた。

## 受け入れ条件

- [ ] BGT-S-1: budget grant を伴う `decision record` は
      `docs/management/decisions/<date>-budget-override-<story-id>-<digest8>.md`
      を生成する。frontmatter に `type: budget_override_approval` /
      `decision_id` / `story_id` / `status` / `approver`（grantor） /
      `approver_kind` / `approved_at` / `override_digest` / `recorded_by`
      を含み、body に `--reason` の全文を含む。
- [ ] BGT-S-2: 生成された document の repo 相対パスが workspace record 側の
      `budget_approval.decision_doc` に記録され、両チャネルが相互参照可能。
- [ ] BGT-S-3: document の生成先が gitignore されている場合、`decision record`
      は grant を記録せずに fail する（untracked channel への silent fallback
      をしない）。
- [ ] BGT-S-4: budget grant を伴わない decision record は document を生成せず、
      従来と同一の出力を返す。
- [ ] BGT-S-5: 同一 story・同一 digest の再記録は同一パスへ決定論的に上書きされ、
      digest が変わる grant は別ファイルになる（数値の変更が diff 上
      新ファイルとして見える）。
- [ ] BGT-S-6: 親 Story story-vibepro-owner-gated-budget-override の 3 grant に
      対する backfill document が tracked channel に存在し、grantor
      （sato_keigo）・現行 override の digest・承認セッション参照を含む。
- [ ] BGT-S-7: `docs/reference/cli.md` / `docs/ja/reference/cli.md` が
      tracked document 生成を明記する。

## 検証

- unit: `test/decision-records.test.js` に BGT-S-1〜S-5 を追加。
- 親 Story の residual 節に本 Story への解消ポインタを追記する。
