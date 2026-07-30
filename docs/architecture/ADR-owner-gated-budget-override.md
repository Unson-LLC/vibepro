---
story_id: story-vibepro-owner-gated-budget-override
---

# ADR: Owner-Gated Budget Override

## Context

`.vibepro/config.json` の `budgets.delivery_efficiency_by_story.<story-id>` は、
そのbudgetを消費するagent自身が編集できるplain JSONである。
このgateが存在する前は、`amendment_reason` を書くだけでoverrideが有効になっていた。
つまり **budgetの受領者と承認者が同一** であり、承認を読むcodeはどこにも存在しなかった。
raiseされた上限は、それを止めるために存在するagentによって自己承認できた。

書き込み自体の禁止は選択しなかった。config fileは通常のtoolで編集できるため、
write protectionは迂回可能である。強制できるのは
**「承認のないoverrideを honour しない」** という性質だけである。

## Decision

`src/budget-override-authority.js` を単一の消費点に置き、override は
accepted decision record が承認したときにのみ有効とする。

1. **Digest binding**: 承認は特定の数値に対して行う。digest は config 上のoverride内容から
   計算し、agent入力からは計算しない。`amendment_reason` はdigestから除外するため、
   文言修正は再承認を要さず、**書き換えられた数値を prose の修正として洗浄できない**。
   `story_id` を digest に含めるため、grantは構造的に移植不能である。
2. **Grantor separation**: `grantor_kind` は `human` でなければならず、
   記録agentは自身を識別しなければならず、grantorは記録agentと異なっていなければならない。
   自己承認は `self_approved` として失格する。
3. **Fail closed, not fatal**: 未承認のoverrideは fatal error ではなく **inert** とする。
   base budget（より厳しい側）が適用され、理由が `unauthorized` として残る。
   agentは既定の上限で止まり、人間はPR時に「なぜraiseが効かなかったか」を読める。
4. **Grandfather the content, not the story**: このgate以前の16件は、その正確な内容の
   digest に pin する。pin された entry を編集すると digest が変わり `unauthorized` に落ちる。
   snapshot であって licence ではない。pin の追加は reviewer が見る code diff を要する。

## Public Contract Impact

これは **breaking change** である。

- **CLI**: `vibepro decision record --source budget:delivery_efficiency:<id>` は
  `--reason` / `--budget-grantor` / `--budget-grantor-kind` を必須とする。
- **Config semantics**: grantのない既存override（pin対象外）は、以後有効ではなくなる。
  base budget に狭まる。**silent な挙動変更ではなく**、`pr prepare` の
  `budget_override` と `efficiency_debt`、および `review authorize` の
  dispatch-stop text に status と理由が現れる。
- **Compatibility**: `resolveEfficiencyPolicy` の公開signatureは、第3引数を任意にすることで維持した。
- **Upgrade action**: CHANGELOG に記載。override を保持したい場合は、人間のgrantorによる
  budget approval decision record を記録する。

## Execution Topology

override は resolver という単一点で解決され、そこから
`src/delivery-efficiency-guardrail.js`（policy解決）、
`src/agent-review.js`（review dispatch判定）、
`src/pr-manager.js`（PR gate context）へ流れる。
`readDeliveryEfficiencyPolicy` は `readDeliveryEfficiencyPolicyDecision` に委譲するため、
decisionを読まずにpolicyを得る経路は存在しない。
decision store は `resolvePrArtifactFile` 経由で解決するため、
artifact routing の変更に追随する。

## Consequences

**得られるもの**: raiseされたbudgetは、名前のある人間の承認に紐づく。
承認は特定の数値に紐づく。承認後の編集は digest で失効する。

**代償と残存リスク**:

- grantを保持する per-Story decision store は `.vibepro/*` 配下であり gitignore される。
  したがって **grantor / digest / timestamp は PR diff に現れない**。
  fresh clone では store が無いため override は `unauthorized` に落ちる（fail closed）。
  追跡可能な channel（`docs/management/decisions` の `budget_override_approval`）への
  併記は follow-up とする。
- `budgets.delivery_efficiency` の **global default は gate しない**。
  共有defaultを広げれば同じ効果に到達する。Storyの Non Goals として明示的に範囲外とした。
- CI と fresh clone には workspace artifact が無いため、`authorized` branch の coverage は
  `test/fixtures/budget-override-authority/authorized-grant-store.json`（追跡されるfixture）
  から供給する。fixture の `override_digest` は literal で pin するため、
  digest algorithm の変更は fixture を赤にする。

## Alternatives Considered

- **Config write protection**: 却下。plain JSON file であり迂回可能。
- **Hard failure on unauthorized override**: 却下。fail closed で base budget に落とす方が、
  停止理由を人間に届けつつ作業を継続できる。
- **Story単位のgrandfather**: 却下。pin された Story の内容を後から編集できてしまう。
  内容digestへの pin を選択した。
