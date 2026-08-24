# Architecture: VibePro 0.2.0-beta.16 release

## 目的

PR #491（`e9385b9846932a37456d62cf85f5ed6092eeec91`）、PR #492
（`495b7fbc2724bd13c3f9d82c80b916dd4dd782e8`）、PR #494
（`feb4426600ddb48ec91fdd0bbbb47eca18915601`）および3件のdocs projectionを含む
current base `3db04f430fe017aef42a456ef6c18434ad8b4407`を、既存のpost-merge release経路から
`vibepro@0.2.0-beta.16`として配布する。beta.15のrelease sourceは再利用しない。

## 境界

- release PRはpackageとlockfileのroot version、Story・Architecture・Spec・Task、版番号回帰testだけを変更する。
- `src`、`bin`、依存、workflow、公開script、既存Story、`.vibepro` runtime artifactは変更しない。
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

公開前は候補commitまたはPRを破棄する。公開後はbeta.16を上書き・unpublishせず、必要ならdeprecateし、
dist-tagを直前の正常版へ戻して修正版を新versionとして公開する。
