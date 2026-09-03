---
story_id: story-vibepro-pr-destination-integrity
title: 複数remote環境のPR送信先を明示して誤送信を防ぐ
status: active
artifact_profile: feature_packet
feature_slug: pr-destination-integrity
source:
  type: github_issue
  id: "518"
spec_docs:
  - docs/specs/story-vibepro-pr-destination-integrity-spec.md
reason: 複数remoteでoriginを暗黙選択する現状は別repositoryへのpushとPR作成を起こし得る。remoteの自動書換えや警告継続ではなく、送信先を明示または一意に解決し、各外部変更の直前に再検証してfail closedにする。単一remoteでは既存操作を維持し、問題時は追加した解決・検証処理とCLI optionを戻せる境界に限定する。
---

# Story

複数のGit remoteを使う開発者として、`vibepro pr create` のpush先とPR作成先を明示・確認でき、別repositoryへの誤送信を外部変更前に止めたい。

## Acceptance Criteria

- PDI-AC-001: 複数の異なるrepositoryを指すremoteがあり、送信先を一意に決められない場合はpush前に失敗する。
- PDI-AC-002: `--push-remote` または `--repo` で送信先を明示でき、remote URLとPR repositoryが一致しない場合は失敗する。
- PDI-AC-003: dry-run JSONは `push_remote`, `push_url`, `pr_repository`, `base_repository`, `base_ref`, `head_ref`, `head_sha` と検証結果を返す。
- PDI-AC-004: 実行時はpush直前とPR作成直前にremote URLを再取得し、計画時から変化していれば後続の外部変更を止める。
- PDI-AC-005: 単一remote環境は従来どおり明示optionなしで動作する。
- PDI-AC-006: `pr-create.json` に最終的なremote、repository、ref、SHA、検証結果を保存する。

## Boundary

- Git remote URLの追加・削除・書換えは行わない。
- fork間PRなどpush先repositoryとPR作成先repositoryが異なる運用は、本Storyでは暗黙許可しない。
- GitHubへのpush、PR作成、mergeは実装検証の対象外とし、fixtureとdry-runで確認する。
