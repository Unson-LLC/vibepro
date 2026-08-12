# Architecture: VibePro 0.2.0-beta.7 release

## 決定

PR #455を含む現在のmainから、version metadataだけを`0.2.0-beta.7`へ上げる。
version増加を検出した`post-merge-release.yml`が、PRのマージコミットをcheckoutして
typecheck、全テスト、npm pack dry-runを行い、その同じコミットからnpm publishと
GitHub prerelease作成を行う。

## 境界

- mainへの通常push自体はnpm公開を意味しない。version増加を含むmerged PRが公開候補になる。
- リリースPRは`src`、`bin`、依存、公開workflowを変更しない。
- npm versionは不変であり、失敗版のrollbackはdeprecateとdist-tag復元で行う。
- `npm publish`前の検証失敗は公開を停止する。publish後の失敗は部分遷移として扱い、
  `beta`と`latest`を個別に観測して復元する。
- `NPM_TOKEN`は既存のGitHub Actions環境だけで使い、新しい認証経路を追加しない。

## 互換性

リリースPRそのものはversion表示以外のruntime挙動を変更しない。パッケージ内容には
beta.6以降にmainへマージ済みの変更が含まれ、Issue #454のaccepted-spec系譜修正をbeta利用者へ届ける。

## 可観測性

公開完了はActionsの成功だけでなく、GitHub Releaseのtarget commit、npm `gitHead`、
`beta` / `latest` dist-tagをrelease merge commitと照合して確定する。
