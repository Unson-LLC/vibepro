---
story_id: story-vibepro-oss-apache2-readiness
title: Apache-2.0でVibeProをOSS公開できる状態にする
status: active
source:
  type: user_request
  id: oss-apache2-readiness
architecture_docs:
  - docs/architecture/vibepro-oss-apache2-readiness.md
spec_docs:
  - docs/specs/vibepro-oss-apache2-readiness.md
---

# Story

VibeProをOSSとして公開するために、Apache-2.0ライセンス、公開用package metadata、README、CI、GitHub運用テンプレート、配布物の安全確認を揃える。

VibeProはGraphifyを任意の外部CLIとして利用できるが、Graphify本体を同梱しない。Graphifyの利用者はGraphify側のライセンスに従う。

## Acceptance Criteria

- `LICENSE` が Apache License 2.0 で追加されている。
- `package.json` に `license: Apache-2.0` と公開用metadataがある。
- README / README.ja に Apache-2.0 と Graphify optional integration が明記されている。
- npm package に `.vibepro/`、Graphify本体、社内release noteが含まれない。
- `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`CHANGELOG.md` がある。
- GitHub issue / PR template と CI がある。
- CI相当の `typecheck`、`test`、`npm pack --dry-run` が通る。
- VibeProが生成するPR本文は、内部状態の汎用title (`Story` など) ではなくStory正本のtitle / requirement titleを優先して表示する。
- Story正本に `## 背景` がない場合でも、`# Story` 直下の導入文からレビュー可能な背景を抽出し、`背景: Story文書から抽出できませんでした` を不要に出さない。
