---
story_id: story-vibepro-oss-readiness-check-pack
title: OSS Readiness Check Packで公開前リスクをartifact化する
status: active
view: dev
horizon: month
period: 2026-05
category: product
created_at: 2026-05-26
architecture_docs:
  - docs/architecture/vibepro-oss-readiness-check-pack.md
spec_docs:
  - docs/specs/vibepro-oss-readiness-check-pack.md
---

# Story: OSS Readiness Check Packで公開前リスクをartifact化する

## User Story

**As a** OSS公開を準備するmaintainer
**I want to** VibeProでlicense / secret / SBOM / vulnerability / repo security postureをまとめて確認できる
**So that** 公開判断、waiver、noise判定、secret混入判断を会話ではなくVibePro artifactでレビューできる

## Background

VibePro自身をOSS公開するには、ライセンス、依存関係、secret混入、脆弱性、GitHub repository postureを公開前に確認する必要がある。

既存の専門OSSツールを置き換えるのではなく、VibeProがそれらの実行結果をcheck packとして束ね、`.vibepro/checks/oss-readiness/<run-id>/` にレビュー可能な証跡として残す。

## Acceptance Criteria

- [ ] `vibepro check list` に `oss-readiness` が表示される。
- [ ] `vibepro check oss-readiness <repo> --json` が `.vibepro/checks/oss-readiness/<run-id>/check.json` と `check.md` を生成する。
- [ ] v1対象ツールは Gitleaks、OpenSSF Scorecard、Syft、Grype、REUSE とする。
- [ ] 未インストール・認証不足・ネットワーク不足は `needs_setup` としてartifactに残す。
- [ ] Gitleaks findings は `fail` / `block` 扱いにし、raw secretはartifactに保存しない。
- [ ] SyftはSBOM生成結果を記録し、Grypeはcritical/highを `fail`、mediumを `needs_review`、low/infoを `info` として集約する。
- [ ] Scorecardは総合scoreと主要checkを記録し、score < 7.0 は `needs_review` とする。
- [ ] REUSE non-complianceは `needs_review` とし、修正対象をartifactに残す。
- [ ] `--fail-on-findings` は既存check pack方針どおり、statusが `pass` 以外ならnon-zero exitにする。

## Implementation Notes

- 対象: `src/check-packs.js`, `src/oss-readiness-scanner.js`, `src/cli.js`
- 外部ツールの自動installはしない。
- 外部ツールの生stdout/stderrは保存せず、正規化したsummary/findingsだけを保存する。
