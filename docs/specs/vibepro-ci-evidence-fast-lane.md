---
story_id: story-vibepro-ci-evidence-fast-lane
title: CI Evidence Reuse & Risk-Tiered Fast Lane Spec
---

# 仕様

## 必須挙動: verify import-ci

- `vibepro verify import-ci <repo> --id <story-id> [--pr <number>] [--check <name>=<kind>]... [--json]` は gh 経由で対象 PR（未指定時は現在ブランチの PR）の check 結果を取得し、verification evidence として記録する。
- 受け入れ条件（すべて満たした check のみ記録する）:
  - check の head SHA が現在の git HEAD と一致する。
  - check の status が completed かつ conclusion が success。
- 拒否挙動:
  - head SHA 不一致 → 記録せず、不一致の SHA ペアを含むエラーを返す。
  - conclusion failure → pass として記録する経路を持たない（記録するなら status fail のみ）。
  - pending / queued → 記録せず「CI 未完了」を返す。
- kind マッピング: デフォルトで check 名 `test*` → kind `integration`。`--check <name>=<kind>` で上書き・追加できる。マッピングが無い check（analyze / CodeQL 等）は取り込まず `skipped` として結果に列挙する。
- 記録内容:
  - `command`: CI run への参照（run URL または run ID）を含む文字列。
  - `artifact`: 取得した check rollup JSON を保存したファイル → 既存の artifact_check 機構で verified になること。
  - `observation`: targets は対象 workflow / job 名、values に conclusion・run URL・head SHA → observation_check recorded になること。
  - `git_context`: 既存の記録時 HEAD 束縛をそのまま使用する。
- CI evidence は generic command 規律の対象とする。フルスイート相当の CI 結果は unit / integration verification gate の充足にのみ使え、judgment spine の focused 証拠（focused_test / runtime_path_evidence / artifact_replay 等）としては加点されない。

## 必須挙動: fast lane

- pr prepare は以下を満たす場合に fast lane を適用する:
  - low-risk 条件: PR route が docs_only、または（change risk profile が light かつ fileGroups.source.count === 0）。ソースを変更する light 変更は対象外。
  - 失格条件がすべて無い: changeClassification.risk_surfaces が空、secret/credential safety surface 無し、新規ネットワーク/API 呼び出し（introduced_api_client_call_count === 0）、high-risk engineering route（security_trust / release_engineering / data_pipeline / business_system / api_platform / infra_ops / agent_workflow）でない。失格理由は gate:fast_lane の evaluation.disqualifiers に記録する。
- fast lane 適用時:
  - `gate:agent_review` は typed N/A（status not_applicable、waiver とは区別、判定根拠つき）となり、review subagent の record なしで ready_for_pr_create に到達できる。
  - gate-dag に `gate:fast_lane` ノードが追加され、route / profile / surfaces の実値を判定根拠として持つ。
  - pr-prepare.json の gate_status に fast_lane フラグが出る。
  - human-review.json テンプレートは引き続き生成される。
- fast lane 不適用時は従来どおり Agent Review Gate が要求される。判定器（prRoute / changeClassification）自体はこの story で変更しない。

## 必須挙動: 可視化

- `vibepro usage report` の `value_signals` に `fast_lane_story_count` を追加し、story 別フラグを立てる。fast lane 適用は集計上 silent にならない。

## 非目標

- CI 応答の署名検証・attestations。
- review subagent の品質・内容の変更。
- ローカルフルスイート実行の禁止（併用可）。
- 監査時間計測の自動化。
