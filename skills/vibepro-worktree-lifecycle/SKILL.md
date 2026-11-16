---
name: vibepro-worktree-lifecycle
description: Git worktreeの作業終了時に、安全な閉鎖可否を調査し、VibePro CLIで検査・閉鎖・readbackする。branch切替が別worktreeに阻害された時や、worktreeサイクルを閉じる依頼で使う。
---

# VibePro Worktree Lifecycle

## Purpose

worktreeを「作ったまま」にせず、作業結果、dirty状態、統合状態、利用中プロセスを確認してから安全に閉じる。閉鎖可否の正本はVibePro CLIとし、このSkillで別の判定ロジックを作らない。

この運用は判断DAGから独立した決定論的なライフサイクル処理である。レビューや価値判断の合格を、worktree削除の代わりにしない。

## When to Use

- PRのmergeや作業中止後に、作業用worktreeを閉じる時。
- `fatal: '<branch>' is already used by worktree at '<path>'` が出た時。
- worktreeサイクルが閉じているか確認する時。
- `git worktree list` に古い候補があり、削除してよいか調査する時。

通常のbranch checkoutだけで作業しており、閉じる対象worktreeがない場合は使わない。

## Inputs and Preconditions

- repository root
- 閉じるworktreeの明示的なpath
- 統合判定に使う明示的なbase ref
- 対象worktreeのownerと作業目的

pathやbase refを推測で補わない。複数候補を一括処理せず、対象ごとに検査する。

## Process

1. 対象repositoryとworktree path、base refを固定する。
2. 最初は必ずread-onlyで検査する。

   ```bash
   vibepro worktree inspect <repo> --path <worktree-path> --base <base-ref> --json
   ```

3. `status: safe_to_close`以外なら閉じない。`reasons`と`checks`を読み、dirty、未統合、detached、子worktree、利用中プロセス、base解決失敗を分けて報告する。
4. `safe_to_close`で、対象が依頼範囲内と確認できた場合だけ閉じる。

   ```bash
   vibepro worktree close <repo> --path <worktree-path> --base <base-ref> --json
   ```

5. `status: closed`と`closed: true`をreadbackする。必要なら`git worktree list --porcelain`でも対象pathが消えたことを確認する。
6. branch削除はworktree閉鎖とは別操作として扱う。依頼がなければ削除しない。

## Safety Boundary

- `git worktree remove --force`を使わない。
- dirty差分、未統合commit、owner不明のworktreeを削除しない。
- `git worktree prune`を一括クリーンアップとして使わない。
- squash mergeやcherry-pick相当の統合判定を目視やcommit SHA一致だけで決めない。CLIの結果を使う。
- canonical worktreeと現在のプロセスが入っているworktreeを閉じない。

## Common Rationalizations

- 「PRがmerge済みだから消してよい」: dirty差分や別commit、利用中プロセスは残り得る。inspectを省略しない。
- 「branchを切り替えられないからforceで消す」: エラーは登録の存在を示すだけで、安全な閉鎖を証明しない。
- 「一覧のprunableを全部消せばよい」: ownerと回収対象が不明な一括処理はしない。
- 「判断DAGが通ったから閉鎖済み」: Git worktreeの登録解除と物理pathのreadbackが必要である。

## Red Flags

- `status`が`needs_attention`、`active`、`unknown`のまま削除へ進もうとしている。
- `reasons`を読まず、exit codeだけで安全と判断している。
- 対象path、base ref、ownerのどれかが未確認である。
- 複数worktreeをglobや再帰削除でまとめて扱おうとしている。
- `closed: true`またはworktree listのreadbackがない。

## Verification

完了には次の証拠をそろえる。

- 閉鎖直前の`inspect`が`safe_to_close`。
- `close`結果が`status: closed`かつ`closed: true`。
- 対象pathがworktree一覧から消えている。
- canonical worktreeはcleanで、必要なbase refと同期している。

一部だけ確認できた場合は「worktreeサイクル完了」と言わず、未確認項目をそのまま残す。
