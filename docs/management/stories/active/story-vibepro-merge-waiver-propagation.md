---
story_id: story-vibepro-merge-waiver-propagation
title: PR作成時の監査可能なGate waiverをexecute mergeへ安全に伝播する
status: active
parent_design:
  - story-vibepro-merge-waiver-propagation
reason: PR createで承認・永続化済みの非critical waiverをmerge時に再入力させる案は判断の二重化と証跡分裂を招く。current HEADに束縛されたpr-create artifactだけをauthorityとし、理由・policy・対象Gate一覧を現行Gate statusと照合してcritical unresolvedなしを再検証する。既存のready_for_review経路は互換維持し、artifactがstale・欠落・不正・現行Gateと不一致なら従来どおりfail-closedに戻せる。
---

# PR作成時の監査可能なGate waiverをexecute mergeへ安全に伝播する

## 背景

`vibepro pr create --allow-needs-verification --verification-waiver <reason>` は、非criticalな未解決Gateに対する明示判断を `pr-create.json` へ記録できる。一方、`vibepro execute merge` は `gate_dag.overall_status === ready_for_review` だけを判定しており、同じcurrent HEADに対してVibePro自身が受理したwaiverを消費できない。このため、正規PR作成後も正規mergeが `gate_not_ready` で閉路になる。

## 目的

PR作成時に受理・永続化された監査可能な非critical Gate waiverを、同一HEADの `execute merge` がauthority-firstに再利用できるようにする。

## 境界

VibeProはwaiver schema、current-HEAD binding、critical gate拒否、merge precondition記録を所有する。GitHubはPR checks、review policy、mergeability、実mergeを所有する。merge時の新規waiver入力やraw merge bypassは導入せず、PR #381のruntime lifecycle実装やPR #370のbudget policyは変更しない。

## 受入条件

- [x] AC-1 `gate_dag.overall_status=ready_for_review` は従来どおりwaiverなしでmerge-readyになる。
- [x] AC-2 current HEADの `pr-create.json` に理由・waiver policy付きの `gate_override.allowed=true` があり、critical unresolved gateが0件なら、`execute merge` はGate preconditionを満たす。
- [x] AC-3 staleな `pr-create.json`、理由またはpolicy欠落、critical unresolved gateありの場合は `gate_not_ready` でfail-closedになる。
- [x] AC-4 `pr-merge.json` はready Gateかwaiverかのauthorization sourceとwaiver監査情報を保持する。
- [x] AC-5 dry-run contract testと実merge fixtureで、正規 `execute merge` が同じ判定を用いることを証明する。
- [x] AC-6 self-dogfoodの `review close → review record` で、事前authorization済みの完了結果を回収済みとして永続化し、同じroleのreplacement再dispatch閉路を起こさない。
- [x] AC-7 waiverの対象Gate一覧とcritical一覧をcurrent `pr-prepare.gate_status` と完全照合し、対象欠落・不一致・現行critical GateありはGitHub操作前にfail-closedになる。

## シナリオ

S-001: `ready_for_review` またはcurrent HEADへ束縛された非critical waiverからmerge authorizationへ遷移し、GitHub checksを通過した場合だけmergedへ進む。stale・malformed・対象不一致・current critical Gate・parse/persistence failureのいずれかではGitHub操作前に`gate_not_ready`へ戻る。

S-002: review lifecycleが明示的に`completed`でcloseされた場合だけ同一dispatchの結果を回収してrecordedへ遷移する。timeout・replaced・manual shutdownでは結果を後付けせず、replacementを暗黙dispatchしない。

## 非目標

Gate waiverの適用範囲拡大、critical Gateの理由だけによるwaive、GitHub CLIのProjects Classic問題の修正は行わない。既定のreview budget policyやAgent Runtime dispatch契約も変更しない。ただし正規 `review close → review record` の結果回収欠落は、このStoryをVibePro自身でmergeするために必要な限定的lifecycle整合修正として含める。必須3+3役と一度のbounded repairを完遂するStory-local上限9は、2026-07-23の明示承認に基づく実行監査設定であり製品契約には含めない。
