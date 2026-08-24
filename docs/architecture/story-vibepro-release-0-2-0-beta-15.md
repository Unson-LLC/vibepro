# Architecture: VibePro 0.2.0-beta.15 release

## 目的

PR #489（`877dd461695edb52e138a811078551705799d433`）を含むcurrent base
`bf2ed3f591be098d2f7c9f9180a824547fcb246e`を、既存のpost-merge release経路から
`vibepro@0.2.0-beta.15`として配布する。beta.14のrelease sourceは再利用しない。

## 境界

- release PRはpackageとlockfileのroot version、Story・Architecture・Spec・Task、版番号回帰testだけを変更する。
- `src`、`bin`、依存、workflow、公開script、`.vibepro` archiveは変更しない。
- npm publish以降は既存のpost-merge workflowを正本とし、この準備commitでは実行しない。

## 実行順序

```mermaid
flowchart LR
  A[Story] --> B[Architecture]
  B --> C[Spec]
  C --> D[Task]
  D --> E[Version metadata and test]
  E --> F[Exact HEAD validation]
  F --> G[通常のPR review]
  G --> H[Post-merge release]
```

## 完了判定

準備完了はfocused commitとexact-HEAD検証までである。公開完了は、merge後のnpm `gitHead`、
`beta` / `latest`、Git tag、GitHub prerelease、fresh install runtime、docs投影のreadbackを要する。
未確認または部分失敗を成功に含めない。

## 復旧

公開前はPRを閉じる。公開後はbeta.15を上書き・unpublishせず、必要ならdeprecateし、
dist-tagを直前の正常版へ戻して修正版を新versionとして公開する。
