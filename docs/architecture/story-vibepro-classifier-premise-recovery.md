---
story_id: story-vibepro-classifier-premise-recovery
title: Classifier Premise Recovery Architecture
parent_design: vibepro-classifier-premise-recovery
status: final
---

# アーキテクチャ

## 判断

`gate:judgment_dag_adjudication` の `judged_unsound` を、実装・証拠が不成立な
`implementation_unsound` と、上流classifierが作った問いの前提が不成立な
`classifier_premise_unsound` に分類する。前者は従来どおり同一HEADでは解除不能とし、後者だけを
item単位のpremise correctionとfresh independent re-adjudicationによって回復可能にする。

回復は上書きやwaiverではなく、元裁定を直接参照するappend-only event chainで表す。Gate、PR summary、
裁定依頼書は同一の `resolveCurrentJudgmentState` を使い、配列の「最新要素」や時刻だけでcurrent stateを
選ばない。free-floatingな `judged_sound` は既存のunsound chainを解除できず、correction IDへ応答する
別judgeの裁定だけが解決候補になる。

## 根因

1. `collectJudgmentItems` は問いと機械状態を作るが、premise identityや裁定系譜を持たない。
2. `recordJudgmentAdjudication` は同一itemの旧裁定をfilterして置換し、record ID、原因、補正参照、履歴を失う。
3. `buildJudgmentDagAdjudicationGate` はcurrent HEADの値をMapへ潰し、全 `judged_unsound` をterminal failureにする。
4. `prepareJudgmentAdjudication` とsummaryも同じcurrent-state resolverを持たず、補正後の依頼内容と有効件数を表現できない。

Whyを遡ると、回復不能なのはunsoundを状態値としてのみ扱うためであり、状態値に潰れるのは
1 item 1 rowのoverwrite modelだからである。そのmodelは初期実装がcurrent-HEAD completenessだけを目的にし、
classifier premiseの妥当性とimplementation validityを同じ `judged_unsound` に畳んだことに由来する。

## Artifact v2

`.vibepro/adjudication/<story-id>/judgment-adjudication.json` を以下のunified event logへ移行する。

```json
{
  "schema_version": "0.2.0",
  "model": "vibepro-judgment-dag-adjudication-v2",
  "story_id": "story-id",
  "updated_at": "ISO-8601",
  "events": [
    {
      "event_id": "UUID",
      "type": "verdict",
      "item_id": "axis:example",
      "verdict": "judged_unsound",
      "unsound_cause": "classifier_premise_unsound",
      "responds_to_correction_id": null,
      "reason": "...",
      "provenance": { "agent_system": "codex", "agent_id": "judge-a", "session_ref": "..." },
      "head_commit": "sha",
      "recorded_at": "ISO-8601"
    },
    {
      "event_id": "UUID",
      "type": "premise_correction",
      "item_id": "axis:example",
      "corrects_verdict_id": "UUID",
      "wrong_premise": "...",
      "corrected_premise": "...",
      "reason": "...",
      "replacement_evidence": [{ "artifact": "path", "sha256": "hex" }],
      "provenance": { "agent_system": "codex", "agent_id": "operator", "session_ref": "..." },
      "head_commit": "sha",
      "recorded_at": "ISO-8601"
    }
  ]
}
```

新規eventは末尾appendし、IDと明示参照で順序を確定する。旧v1 `{ verdicts: [...] }` は、schema/modelが
未宣言または `0.1.0` / `vibepro-judgment-dag-adjudication-v1` と整合する場合だけ読込互換に入れる。
内容hash由来の決定的event IDを付けて正規化し、cause欠落の旧 `judged_unsound` は安全側の
`implementation_unsound` とする。次回writeでは全legacy eventをv2へmaterializeし、一件も削除しない。
materializeしたeventには `legacy_origin` を残し、次回readでもprovenance欠落を真正v1由来としてのみ許容する。
直接読み込むv1 artifactは既存の読込互換を維持する。ただしv2へmaterializeした後の互換例外は、causeを
強制的に `implementation_unsound` としたblocking verdictだけに限定する。materialized eventの
`judged_sound`、`needs_human_judgment`、`classifier_premise_unsound` はprovenance無しでは無効で、編集可能な
`legacy_origin` を偽装してもGate通過や回復経路の開始には使えない。v2 schema/modelを宣言しながら
`events` を欠くartifactはlegacyへdowngradeせず `invalid_history` とする。recorderは既存artifactのformat errorまたは
current-HEADのinvalid historyを検出したら書き換えず、調査可能な原文を保全する。

## Resolverの不変条件

- story、item、current HEADが一致しないeventはcurrent stateに使わない。HEAD不明やbinding欠落はmissingとする。
- duplicate ID、dangling/cross-item/cross-head参照、unknown cause、分岐した重複correction、invalid evidenceは
  `invalid_history` としてfail closedする。
- schema/modelとpayload形状の矛盾はresolver、Gate、PR summary、adjudication prepareの全consumerでfail closedする。
- materialized legacy markerは旧 `implementation_unsound` blockerの保持だけを許し、Gate dischargeやpremise correctionの根拠にはしない。
- recorderは既存のformat error / invalid historyを正常化の名目で上書きせず、明示エラーで停止する。
- 通常の `judged_sound` はresolved、通常の `needs_human_judgment` は既存accepted decision record経路を維持する。
- cause欠落または `implementation_unsound` はfailedで、correctionやdecision recordでは解除できない。
- `classifier_premise_unsound` は同じstory/item/HEADの当該verdictを直接参照するvalid correctionが無ければfailed。
- correctionはwrong/corrected premise、reason、1件以上のworkspace-relative replacement artifactと記録時SHA-256を必須にする。
- correction後は `awaiting_re_adjudication` / `needs_evidence`。同じcorrection IDへ応答する裁定だけを候補にする。
- 再裁定者の `agent_system + agent_id` は元unsound judgeと異ならなければならない。同一judge、stale HEAD、
  dangling correction linkは記録時に拒否する。
- linked fresh re-adjudicationが `judged_sound` なら自動解決する。`judged_unsound` は新cause/reasonでfailedとなり、
  classifier causeならその新verdictを起点に次のcorrection chainを作れる。
- chain内の `needs_human_judgment` は既存のaccepted decision record経路へ接続し、accepted decisionが無い間は
  `needs_evidence`、受理後はresolvedとする。premise correction自体をhuman decisionで代替してはならない。
- event配列の正順・逆順をresolverへ渡しても、明示参照が同じならcurrent stateは同一でなければならない。

## 状態遷移

```text
missing
  -> judged_sound                         -> resolved
  -> needs_human_judgment                 -> awaiting_human_decision -> resolved
  -> implementation_unsound               -> failed (same HEADでは解除不能)
  -> classifier_premise_unsound           -> failed
       -> valid premise_correction         -> awaiting_re_adjudication
            -> linked different-judge sound   -> resolved
            -> linked different-judge unsound -> failed (新しいchain起点)
            -> linked needs_human             -> awaiting_human_decision -> resolved
```

## CLI契約

初回裁定の既存コマンド形は保ち、`judged_unsound` のときだけ
`--unsound-cause <implementation_unsound|classifier_premise_unsound>` を必須にする。他verdictでの指定は拒否する。

```bash
vibepro adjudicate record . --id <story> --judgment --item <item> \
  --verdict judged_unsound --unsound-cause classifier_premise_unsound \
  --reason <reason> --agent-system codex --agent-id <judge>
```

補正はgeneric decision/waiverを流用せず専用コマンドにする。

```bash
vibepro adjudicate correct . --id <story> --judgment --item <item> \
  --original-verdict-id <id> --incorrect-premise <text> --corrected-premise <text> \
  --reason <reason> --replacement-evidence <workspace-relative-path> \
  --agent-system codex --agent-id <operator>
```

再裁定は既存recordへ明示linkを追加する。

```bash
vibepro adjudicate record . --id <story> --judgment --item <item> \
  --correction-id <id> --verdict judged_sound --reason <reason> \
  --agent-system codex --agent-id <different-judge>
```

新しいconfig toggleやwaiverは追加せず、既存 `judgment_adjudication.enabled` のみ維持する。

## 入力検証と安全境界

- 全text/refはtrim後非空かつ次flagを値として受け取った形でないことをdomain層で検証する。
- correction対象はcurrent HEADの `classifier_premise_unsound` verdictのみ。同一item、未補正、直接参照を要求する。
- replacement evidenceはworkspace内のreadable regular fileのみ許可し、SHA-256を記録する。symlinkは拒否し、
  `realpath` 後もworkspace内であることを検証して中間directory経由のescapeも防ぐ。v2 consumerも
  workspace-relative path、reason、既知agent systemと非空agent idを再検証し、手書き・改ざんartifactをfail closedにする。
- verdict/correction recorderは `agent_system` を `codex|claude_code` のclosed setとして永続化前に検証し、
  consumer自身が回復不能なartifactを作らない。
- artifactのread-modify-write並行競合は既存制約として残るが、duplicate/branch chainはresolverがfail closedする。
- `needs_human_judgment` のdecision record経路とcritical gate waiver拒否は変更しない。
- clause adjudication artifact、classifier algorithm、base freshnessは変更しない。

## 変更面

- `src/adjudication.js`: v2 constants、legacy normalization、event recorder、premise correction recorder、shared resolver、
  request/gate/summary統合。
- `src/cli.js`: `correct --judgment` route、unsound cause/correction ID/replacement evidenceのparse、日英help。
- `test/judgment-adjudication.test.js`: schema、validation、state transition、legacy、order independence、summary、critical回帰、
  v1 migration provenance保持とv2 downgrade拒否。
- `test/e2e/story-vibepro-classifier-premise-recovery-main.spec.ts`: canonical story discoveryに従うreal CLIの
  unsound→correct→別judge再裁定フロー。
- `README.md` / `README.ja.md` / generated CLI reference / gate-evidence Skill: 手順と禁止事項を同期する。

## 検証

最初に新しい状態遷移とCLIをRedにし、targeted unit、targeted E2E、全suiteの順で確認する。
summaryは履歴件数ではなくitemごとのresolved current stateを数える。legacy artifact、通常all-sound、
needs-human closure、corrupt artifact、critical gate waiver拒否を回帰対象に含める。

## 代替案・互換性・rollback・境界

- 単純なlatest-wins、generic waiver、元裁定の上書きは監査性とcritical性を壊すため不採用。
- `verdicts` と `corrections` の二重正本よりunified eventsを採用し、全consumerをshared resolverへ集約する。
- 旧artifactは読込互換を持ち、旧cause欠落unsoundを安全側へ倒す。
- 問題時はv2 write/correction CLI/resolverを戻せば旧fail-closedへ戻れる。v2 event logはappend-onlyなので監査履歴は失わない。
- 明示baseの鮮度、classifier精度全面改善、並行writeのatomicityは別Storyとする。
