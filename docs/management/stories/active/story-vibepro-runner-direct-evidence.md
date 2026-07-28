---
story_id: story-vibepro-runner-direct-evidence
title: 検証コマンドをVibePro自身が実行し、exit code・計数値・head shaを実装エージェントの入力を経由せず証跡に記録する
status: active
view: dev
period: 2026-07
category: architecture
parent_story: story-vibepro-computed-evidence-architecture
source:
  type: operator_feedback
  title: "先行Storyで『441/441で再実行した』という真の主張ですら、artifactが前回と同一内容のためgit上で検証不能になり3ラウンド連続で指摘された。head_shaを手で足す対処をしたが、根本は実行した者と記録する者が同一であること"
related_stories:
  - story-vibepro-computed-evidence-architecture
reason: "alternatives considered: (a) verify record の入力検証を強化する(--observed の形式チェック、artifact の必須化) — 既に実装済みで、それでも『artifact 自体をエージェントが書く』構造が残るため6ラウンドの実測で破られた路線。artifact の中身が作文である限り cross-check は作文同士の照合にしかならない。(b) verify record を廃止し runner 経由のみにする — 既存の import-ci 経路・手動観測が必要な kind(visual/flow)・既存 Story の記録済み証跡をすべて壊すため不可。親 Story の Non Goals『既存証跡の遡及的無効化』にも反する。(c) runner 直結の新経路 `verify run` を追加し、既存 verify record は自己申告として残したまま artifact 上で evidence_source を区別する — これを採用。計算された証跡と自己申告の証跡が同じ artifact 内で型として分かれるため、消費側は段階的に移行でき、既存記録は有効なまま残る。compatibility impact: verification-evidence.json の command entry に evidence_source / computed_observation / observation_overrides を追加するのみで、既存フィールドの意味は変えない。evidence_source を持たない既存記録は self_reported として解釈される(欠落は不明ではなく自己申告として扱う。runner 直結でない記録はすべて自己申告だからである)。verify record の挙動は変えない。rollback plan: 本ブランチのコミット群を**まとめて** revert する（当初は単一 revert を想定していたが、レビューで反証された: RUNNER_EVIDENCE_RECEIPT を src/pr-manager.js と src/ci-evidence.js が後続コミットで import しているため、feature commit だけを revert すると存在しない symbol の import が残り CLI 全体が module load に失敗する）。まとめて revert すれば記録済みの runner_direct / autopilot_run / ci_import 証跡は追加フィールドを持つ JSON として読めるまま残る（読み取り側に evidence_source の検証は無い）。boundary and scope: ローカルで実行可能な検証コマンド(unit/integration/e2e/typecheck/build)の実行結果の記録経路のみ。網羅範囲の計数(CEA-S-2)、レビュー lifecycle の head 記録(CEA-S-3)、予算 override(CEA-S-4)は別の子 Story の担当で本 Story では扱わない。人間の観測が必要な kind(visual/flow)の自動化も対象外。"
created_at: 2026-07-27
updated_at: 2026-07-27
---

# 検証コマンドをVibePro自身が実行し、実行結果を実装エージェントの入力を経由せず証跡に記録する

## Background（実測。推測ではない）

親 Story `story-vibepro-computed-evidence-architecture` の Decomposition 3 番目
（runner-direct evidence / CEA-S-1）に対応する。

現行の `vibepro verify record`（`src/verification-evidence.js`）では、証跡を構成する
入力のすべてを実装エージェントが書く。

| 記録されるフィールド | 現在の書き手 |
|---|---|
| `command`（実行したコマンド文字列） | エージェント |
| `status`（pass/fail） | エージェント |
| `observation.values`（`--observed key=value`） | エージェント |
| `artifact` が指す JSON（`{"status":"pass","exit_code":0}`） | エージェント |

`crossCheckArtifact()` は status と artifact の整合を照合するが、artifact 自身が
エージェントの作文であるため、両方を同時に書けば矛盾は生じない。cross-check は
「作文と作文の照合」であり、実行が本当に起きたことの証明にはならない。

先行 Story では、`441/441 で再実行した`という**真の**主張ですら、
生成した artifact の内容が前回と同一だったため git 上に差分が残らず、
レビュアーが「本当に再実行したのか」を判定できず3ラウンド連続で指摘された。
`head_sha` を artifact に手で足す対処をしたが、その `head_sha` もエージェントが
書いた文字列である。根本は「実行した者と記録する者が同一である」ことにある。

## User Story

**As a** AI エージェントに実装を任せるリポジトリ所有者
**I want** 検証コマンドの実行結果（exit code・テスト計数・実行時 head sha・所要時間）が
実装エージェントの入力を一切経由せず、VibePro 自身の実行の排気として証跡に記録される経路
**So that** 「本当に実行したのか」「その数字は本物か」の検証にレビュアーの労力を払わずに、
証跡をそのまま信用できる

## Acceptance Criteria

- [ ] RDE-1: `vibepro verify run <repo> --id <story-id> --kind <kind> -- <command...>` が
      コマンドを VibePro 自身のプロセスとして実行し、その exit code から導出した status を
      証跡へ記録する。エージェントは status を渡せない（`--status` を渡すと記録は拒否される）。
- [ ] RDE-2: 実行の排気（exit code・テスト計数の tests/pass/fail・所要時間・実行前後の head sha と
      working tree fingerprint・stdout の SHA-256・stdout+stderr の SHA-256・log の truncate 有無）が、
      エージェントの入力を経由せず artifact と `observation.values` に記録される。
      runner が計算する値のキーは、ひとつ残らず上書き保護の対象に含まれていなければならない。
- [ ] RDE-3: エージェントが計算対象フィールドと同じキーを `--observed` で渡した場合、
      記録された値は計算値で上書きされ、`observation_overrides` に
      `{key, agent_value, computed_value}` の差分が残る。エージェントの値が
      そのまま記録されることはない。
- [ ] RDE-4: runner 直結の記録と自己申告の記録が artifact 上で区別できる。
      `verify run` の記録は `evidence_source: "runner_direct"`、
      `pr autopilot` の記録は `"autopilot_run"`、`verify import-ci` の記録は `"ci_import"`、
      `verify record` とそれ以外の記録は `"self_reported"` を持つ。
      VibePro 自身がコマンドを実行する経路はすべて計算済みの値を持ち、自己申告として記録されない。
      この値は CLI フラグでは指定できない（記録経路が内部 receipt で決める）。
- [ ] RDE-5: 実行中にツリーが変更された場合（head が動いた場合と、head は同じで
      working tree が変わった場合の両方）、証跡に `tree_mutated_during_run: true` と
      どちらが動いたかを示す警告が残り、事後にレビュアーが「どの木に対する実行だったか」を
      判定できる。fingerprint を採取できなかった場合は「変化なし」ではなく
      「未採取」として記録される。
- [ ] RDE-6: 既存の記録形式は互換に保たれ、`evidence_source` を持たない既存の記録は
      self_reported として解釈される。`verify record` の入力検証は**意図的に狭まる**:
      runner の実行だけが生成できる provenance/integrity キー26個は `--observed` で拒否され、
      caller 提供の `--artifact` から持ち上がる場合は strip され警告として記録に残る。
      成果観測キー（tests / pass / fail / duration_ms / head_sha 等12個）は従来どおり
      受け付ける。この絞り込みが、自己申告の記録を機械生成に見せかける偽造経路を
      閉じる本 Story の中核であり、副作用ではない。

## 解決 (Solution)

`vibepro verify run <repo> --id <story-id> --kind <kind> -- <command...>` を追加し、VibePro 自身がそのコマンドを argv として（shell を介さず）実行する。status は観測した exit code から導出し、テスト計数は実際の出力から解析し、実行前後の head sha と working tree fingerprint、所要時間、stdout と stdout+stderr の SHA-256 を記録する。`--status` は拒否し、runner が計算するキーへの `--observed` は計算値で上書きして破棄した入力を `observation_overrides` として残す。証跡の出所は記録経路が決める（`runner_direct` / `autopilot_run` / `ci_import` / `self_reported`）。既存の `pr autopilot` もコマンドを自ら実行しているため `autopilot_run` として記録する。

## 互換性 (Compatibility)

記録**形式**は追加のみで、既存フィールドの意味は変えず、未知フィールドを拒否する consumer はリポジトリ内に存在しない。`evidence_source` を持たない既存記録は self_reported として解釈する。一方、`verify record` の**入力契約は非互換に狭まる**: これまで受理されていた `--observed` のうち、runner の実行だけが生成できる provenance/integrity キー26個（`run_artifact`, `stdout_sha256`, `worktree_sha256_before` 等。境界は Spec に列挙）は拒否になり、caller 提供 artifact 経由の同キーは strip + 警告記録になる。影響範囲は検証済み: リポジトリ内の全記録済み証跡にこれらのキーを非 runner 経路で持つものは存在せず、docs / skills / scripts に該当キーを渡す利用例もない（独立裁定者が実行確認）。成果観測キー12個（tests / pass / fail / duration_ms / head_sha 等）は従来どおり受理される。`verify import-ci` と `pr autopilot` は次のリリースから新フィールドを書き始める（利用者側の選択ではない）。rollback は本ブランチのコミット群を**まとめて** revert する必要がある（`RUNNER_EVIDENCE_RECEIPT` を後続コミットが import しているため、feature commit だけの revert は CLI 全体の module load を壊す）。revert 後も記録済みの値は読み取り側で検証されないため無害な JSON として残る。

## 利用者に必要な操作 (User Action)

必須の操作はない。新しい `verify run` は任意で使い始められ、移行・設定変更・データ backfill は不要。ローカルで実行可能な検証は `verify record` より `verify run` を推奨する（Skill `vibepro-gate-evidence` に記載）。なお本 Story の時点では `evidence_source` を読んで挙動を変える gate は存在しない（trust marker の記録のみ。gate 側の利用は後続 Story）。

## Non Goals

- `verify record` の廃止・非推奨化。人間の観測や外部実行の転記が必要な経路は残す。
- 網羅範囲の計数（`N`）の計算化。これは CEA-S-2 の子 Story の担当。
- 人間の観測が必要な kind（visual / flow）の自動化。
- 過去に記録済みの証跡の遡及的な再分類。
