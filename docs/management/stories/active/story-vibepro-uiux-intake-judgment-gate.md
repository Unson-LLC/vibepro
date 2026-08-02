---
story_id: story-vibepro-uiux-intake-judgment-gate
title: uiux intakeのSkill発火 + 判断記録gate
view: dev
period: 2026-08
status: active
reason: |
  代替案として change-risk-classifier 等でのUI変更自動検知→intake強制も検討したが、
  検知器のfalse blockがゲート形骸化学習（旧network-contract-scannerのNext.js前提の再演）を
  招くため不採用。発火判断はSkill（エージェント）に委ね、ハーネスは「判断が記録されて
  いること」だけをfail-closedで検証する分業を採る。互換性: 既存の decision record 型
  （not_applicable系の正直な閉じ方、waiverのreason必須）と同じ体裁であり、既存storyは
  intake_not_applicable decision 1件の追記で通過できる。ロールバック: gate builderの
  呼び出し1箇所と DECISION_TYPES の1要素を外すだけで旧挙動に戻る。境界: intake coverage
  の内容品質（missing fieldsの解消）は本gateの対象外。要求するのは判断の存在のみ。
---

# uiux intakeのSkill発火 + 判断記録gate

## 背景

`src/uiux-intake.js` はStoryの前提穴埋めヒアリング機構（必須フィールドschema、
missing_required_fields列挙、vague-brief検知、needs_intake/needs_intake_detailステータス）
を持つが、発動経路は3つとも明示呼び出しのみ:

1. `vibepro uiux intake template/validate`
2. `design-modernize plan --uiux-intake <file>`
3. `vibepro uiux prepare`

決定的な問題として `src/pr-manager.js` に "intake" への参照が0件であり、標準フロー
（init → story diagnose → spec → verify → pr prepare → pr create）では一度も発動しない。
オペレーターが思い出して叩くことに依存する「気をつける」層にいる。

## 方針

「行為を強制せず、無言を禁止する」というVibePro内の確立パターン
（`not_verifiable_by_automation` のaccepted decision、`not_applicable` decisionによる
正直な閉じ方、guardのbypass理由必須）に揃え、分業を次で切る:

1. **Skill側（発火判断）**: `skills/vibepro-workflow/SKILL.md` にStory受領時のintake要否
   判断を追記する。UI/UX intentなら `vibepro uiux intake validate` を回し、不要と判断
   したら理由付きの `intake_not_applicable` decision recordを記録する。
2. **ハーネス側（判断存在の検証）**: `pr prepare` はintake coverageそのものを要求しない。
   要求するのは「intake要否の判断が記録されていること」のみ。
   - intake coverage artifact（`.vibepro/uiux/<story-id>/uiux-intake-coverage.json` または
     `.vibepro/design-modernize/<story-id>/uiux-intake-coverage.json`）が存在すれば satisfied
   - `intake_not_applicable` のaccepted decision record（理由必須）があれば satisfied
   - `gate:uiux_intake_judgment` へのwaiver decisionがあれば satisfied
   - どれも無ければ gate として block（fail-closedの対象は「intakeの実施」ではなく
     「判断の存在」）

## 受け入れ条件

- [ ] `pr prepare` のgate DAGに `gate:uiux_intake_judgment` が常に含まれ、判断記録が
      無いstoryでは needs_evidence でblockする
- [ ] `.vibepro/uiux/<story-id>/uiux-intake-coverage.json` が存在するstoryではgateが
      passedになる
- [ ] `vibepro decision record --type intake_not_applicable --reason <text>` が受理され、
      accepted状態でgateがpassedになる。reason無しはエラーで拒否される
- [ ] gate未解決時のrecovery planに、intake validate実行と intake_not_applicable decision
      記録の両方の閉じ方が案内される
