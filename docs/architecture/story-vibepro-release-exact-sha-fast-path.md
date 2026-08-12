# Architecture: exact-SHA CI証拠を使う公開高速経路

## 決定

`pull_request_target.closed`のread-only validation jobが、PR eventのimmutableなpre-merge base SHAを
checkoutし、その信頼済みscriptでPR event、Git graph、GitHub Checks/Actions APIを照合する。
write権限とsecretを持つrelease jobは判定後に分離し、次の全条件が成立した時だけfast pathを選ぶ。

1. merge commitの第1親がeventのbase SHA、第2親がreviewed head SHAである。
2. baseとreviewed headから再計算したmerge treeが、公開対象merge commitのtreeと一致する。
3. reviewed head SHA上の`test (20)`、`test (22)`、`analyze`がGitHub Actionsにより成功し、
   期待workflow path、`pull_request` event、現在のPR番号・base SHA・head SHAを記録したrun name、
   merge時刻に対する鮮度条件をすべて満たす。

一つでも証明できなければ、理由を記録して従来の`npm test`を実行する。検証エラーを
fast pathへ倒さない。

## セキュリティ境界

- 分岐判定はreviewed headのコードを実行する前に、immutableなpre-merge base SHA上のscriptを
  `actions/checks/contents/pull-requests: read`だけで実行する。selector未導入のbaseではfullへ戻す。
- Check Runは要求したexact SHA、成功状態、完了状態、GitHub Actions appに加え、Actions runの
  repository、event、workflow path、現在のPR・base・head署名を照合する。
- write権限・npm/Cloudflare secretsは公開対象merge SHAをcheckoutする別jobにだけ置く。
- package sourceの結び付きは、PR番号やbranch名ではなくGitの親とtree objectで証明する。
- evidenceの欠落、API失敗、未知の応答、古い完了時刻は全てfull pathへ戻す。

## fast pathの検証面

全テストの再実行だけを省き、次を公開対象merge commitで実行する。

- `package.json` versionと計画versionの一致
- `npm ci`
- `npm run typecheck`
- post-merge releaseのunit/E2E
- `npm run pack:dry-run`

npm publish後の`gitHead`・dist-tag、GitHub Releaseのtarget・prerelease/latest、git tagの
照合は既存処理をそのまま維持する。

## 時間計測

PRの`merged_at`、publish command開始時刻、npm registryのversion別`publishedAt`、
workflow最終step時刻を使い、公開前、npm可視化まで、公開後ドキュメント同期、
mergeからnpm公開、workflow全体をミリ秒で記録する。時刻が欠ける失敗経路では
利用可能な状態だけをsummaryへ残し、未計測を成功値に置き換えない。

## 互換性とrollback

既存CLI commandと公開条件はadditiveに保つ。fast path判定stepまたは分岐を戻せば、
公開workflowは常時full validationへ復元できる。公開済みversionは変更しない。
