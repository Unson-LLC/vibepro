---
story_id: story-vibepro-merge-waiver-propagation
title: PR作成時の監査可能なGate waiverをexecute mergeへ安全に伝播する
status: active
reason: PR createで承認・永続化済みの非critical waiverをmerge時に再入力させる案は判断の二重化と証跡分裂を招く。current HEADに束縛されたpr-create artifactだけをauthorityとし、理由・policy・critical unresolvedなしを再検証する。既存のready_for_review経路は互換維持し、artifactがstale・欠落・不正なら従来どおりfail-closedに戻せる。
---

# PR作成時の監査可能なGate waiverをexecute mergeへ安全に伝播する

## 背景

`vibepro pr create --allow-needs-verification --verification-waiver <reason>` は、非criticalな未解決Gateに対する明示判断を `pr-create.json` へ記録できる。一方、`vibepro execute merge` は `gate_dag.overall_status === ready_for_review` だけを判定しており、同じcurrent HEADに対してVibePro自身が受理したwaiverを消費できない。このため、正規PR作成後も正規mergeが `gate_not_ready` で閉路になる。

## 目的

PR作成時に受理・永続化された監査可能な非critical Gate waiverを、同一HEADの `execute merge` がauthority-firstに再利用できるようにする。

## 境界

- VibeProはwaiver schema、current-HEAD binding、critical gate拒否、merge precondition記録を所有する。
- GitHubはPR checks、review policy、mergeability、実mergeを所有する。
- merge時の新規waiver入力やraw merge bypassは導入しない。
- PR #381のruntime lifecycle実装やPR #370のbudget policyは変更しない。

## 受入条件

- [ ] AC-1 `gate_dag.overall_status=ready_for_review` は従来どおりwaiverなしでmerge-readyになる。
- [ ] AC-2 current HEADの `pr-create.json` に理由・waiver policy付きの `gate_override.allowed=true` があり、critical unresolved gateが0件なら、`execute merge` はGate preconditionを満たす。
- [ ] AC-3 staleな `pr-create.json`、理由またはpolicy欠落、critical unresolved gateありの場合は `gate_not_ready` でfail-closedになる。
- [ ] AC-4 `pr-merge.json` はready Gateかwaiverかのauthorization sourceとwaiver監査情報を保持する。
- [ ] AC-5 dry-run contract testと実merge fixtureで、正規 `execute merge` が同じ判定を用いることを証明する。

## 非目標

- Gate waiverの適用範囲拡大
- critical Gateの理由だけによるwaive
- 既定のreview budget policyやAgent Runtime lifecycleの製品変更（必須3+3役と一度のbounded repairを完遂するStory-local上限9は、2026-07-23の明示承認に基づく実行監査設定であり製品契約には含めない）
- GitHub CLIのProjects Classic問題の修正
