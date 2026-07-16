---
story_id: story-vibepro-release-0-2-0-beta-0
title: "VibePro 0.2.0 betaを現在のmainから公開する"
status: active
architecture_docs:
  - ../../../architecture/vibepro-release-0-2-0-beta-0.md
spec_docs:
  - ../../../specs/story-vibepro-release-0-2-0-beta-0.md
parent_design: vibepro-release-0-2-0-beta-0
reason: "alternatives considered: publish another 0.1.0 beta patch, publish stable 0.2.0, or continue beta as 0.2.0-beta.0; selected 0.2.0-beta.0 because the public CLI has accumulated substantial additive behavior while the project still declares early-beta compatibility. compatibility impact: prerelease consumers must opt into the beta contract and should review the changelog. rollback plan: deprecate the npm version and restore the previous dist-tags without overwriting an immutable published version. boundary and scope: package metadata, changelog, release verification, GitHub prerelease, and npm publication only; no runtime behavior is changed by this Story."
---

# VibePro 0.2.0 betaを現在のmainから公開する

## User Story

**As a** npmからVibeProを利用するユーザー  
**I want to** 現在のmainに含まれる制御ループを明示的な新しいbeta版として取得したい  
**So that** 2026年6月公開の古い0.1.0-beta.0ではなく、現在検証されたCLIを利用できる

## Acceptance Criteria

- `package.json` と `package-lock.json` のroot package versionが `0.2.0-beta.0` で一致する。
- `vibepro --version` が `0.2.0-beta.0` を返す。
- CHANGELOGに `0.2.0-beta.0` の公開項目があり、現在のbeta範囲を説明する。
- typecheck、全テスト、npm package dry-runが公開対象HEADで成功する。
- GitHub Releaseの `published` を起点に、同じcheckoutからnpmへ公開し、`beta` / `latest`を同じversionへ揃えるworkflowが確認できる。
- 公開後にGitHub Releaseのcommit、Actionsのcheckout SHA、npm `gitHead`、`beta` / `latest` dist-tagを照合する手順と、失敗時のrollback手順がSpecに定義されている。

## Scope

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- `test/vibepro-cli.test.js`
- `.github/workflows/npm-publish.yml`
- `docs/guide/release-and-audit.md`
- `docs/ja/guide/release-and-audit.md`

## Scope boundary and review ownership

This is one reviewable release intent. The Story, Architecture, and Spec are
the control evidence for the same package metadata change, not a separate
product or agent-policy change. Splitting them would detach the release commit
from its required audit trail. The release owner reviews package metadata,
package contents, publication workflow evidence, and rollback instructions as
one bounded decision (`scope_reviewed`, `review_owner_map`, `decision_record`).

## Non-goals

- 1.0安定版の互換性保証
- 新しいCLI機能の追加
- mainへのpushだけでnpm公開する自動化への変更

## Post-release completion

このStoryのPR前Acceptance Criteriaは、merge前に証明できるrelease candidateと
publication control planeの準備状態を対象とする。merge後はGitHub prerelease
`v0.2.0-beta.0`を公開し、Actions成功、npm `gitHead`、`beta` / `latest` dist-tagを
実測してrelease completionを閉じる。公開後の実測値をPR前の証跡として扱わない。
