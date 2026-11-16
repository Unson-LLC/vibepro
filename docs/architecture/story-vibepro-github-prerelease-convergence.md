---
story_id: story-vibepro-github-prerelease-convergence
title: GitHub Release分類収束アーキテクチャ
artifact_profile: feature_packet
feature_slug: github-prerelease-convergence
---

# アーキテクチャ

## 判断

GitHub Releaseの期待状態をSemVerと操作前のGitHub Latestから一度だけ導出する。workflow内のcreate/edit分岐は、その期待状態を同じhelperへ渡すだけにし、各分岐が独自の既定値を持たない。

## 入力

- `VERSION`: 公開対象の有効なSemVer
- `RELEASE_SHA`: npm `gitHead`およびGit tagが指すべき完全commit SHA
- Release notes file: VibeProが生成したGitHub Release本文

## 正規化契約

`releaseClassification(version)`はSemVer種別を返し、収束処理が操作前のLatestと組み合わせて最終値を決める。

- prerelease SemVer: `prerelease=true`, `latest=false`
- stable SemVer: `prerelease=false`。現在のLatestが存在しないか対象以下なら`latest=true`、対象より新しければ`latest=false`として既存Latestを維持する。

無効なSemVerまたは`v`接頭辞付きSemVerとして解釈できないLatest tagは分類せず失敗する。

## 収束処理

`reconcile-github-release` commandが次を直列実行する。

1. 操作前のLatest tagを取得し、対象SemVerとの比較から単調なlatest期待値を決める。
2. Release存在時は期待tag SHAを確認し、editを選ぶ。非存在時はcreateを選ぶ。
3. どちらにも`--prerelease=<bool>`と`--latest=<bool>`を明示する。
4. 操作後にtag SHAを再確認する。
5. `gh release view --json`で`tagName`、`targetCommitish`、`isPrerelease`を再取得し、`gh api .../releases/latest`でlatest tagを確認する。古い安定版では操作前のLatestが維持されたことも含め、全項目が一致しなければ失敗する。

## Fail-closed境界

- tag不在、SHA不一致、Releaseメタデータ欠落・不一致、`gh`失敗は成功へ丸めない。
- create後だけ、edit後だけの検証省略を許さない。
- 表示用ログは検証完了後にのみ出力する。

## テスト戦略

- unit: prerelease/stable/invalid SemVerの分類。
- E2E: fake `gh`と実subprocessでcreate/editの状態遷移を観測する。
- fail-closed: 操作後SHA drift、メタデータ不一致、不正なLatest tagで非0終了する。
- monotonicity: より新しい安定版がLatestの状態で古い安定版をcreate/editしてもLatestが動かないことを確認する。
- regression: workflowが両分岐を持たず、収束commandを1回だけ呼ぶことを確認する。

## 互換性とrollback

- npm dist-tag、公開順序、Release本文、tag名は変更しない。
- 外部状態の復旧を先に行う。対象tag SHAを保持したまま`gh release edit`で分類を戻し、`gh release view --json tagName,targetCommitish,isPrerelease`と`gh api repos/<owner>/<repo>/releases/latest --jq .tag_name`で再検証する。
- 誤作成Releaseはtag SHAを照合してからReleaseだけを削除し、tagは削除しない。次のworkflow再実行前に期待metadataへ手動収束させる。
- 外部状態の復旧後、helperとworkflow呼出しをrevertすれば従来動作へ戻せる。

## 境界

- GitHub Release分類・検証だけを変更する。
- npm publish、release lease、docs projection、beta.6 branchは変更しない。
