---
story_id: story-vibepro-agent-skill-contract
title: Agent Skillsの作法をVibePro-native contractとして吸収する
view: dev
period: 2026-06
architecture_docs:
  - ../../../architecture/vibepro-agent-skill-contract.md
spec_docs:
  - ../../../specs/vibepro-agent-skill-contract.md
status: active
created_at: 2026-06-24
updated_at: 2026-06-24
---

# Agent Skillsの作法をVibePro-native contractとして吸収する

## 背景

VibeProはStory、Architecture、Spec、Gate DAG、Agent Review、PR evidenceを正本にしてAI実装を制御する。一方、agent-skillsは個々のSkillを「いつ使うか」「どの手順で進めるか」「どの言い訳を拒否するか」「どの赤旗で止めるか」「どう検証するか」という作法に落とし込む点が強い。

VibeProがagent-skillsをそのまま上位互換として取り込むと、VibeProの価値である証跡・Gate・PR readinessとの接続が弱くなる。必要なのはSkill文書の移植ではなく、VibeProのSkill、Agent Review、PR Gate、check packに共通する実行契約として吸収すること。

## 受け入れ基準

- [ ] bundled SkillがVibePro-native skill contractでlintできる
- [ ] Skill contractはfrontmatter、When to Use、Common Rationalizations、Red Flags、Verificationを要求する
- [ ] 既存bundled Skillがcontractに準拠し、手順だけでなく言い訳拒否、赤旗、検証を明記する
- [ ] `vibepro skills lint [repo]` がCLIとJSONで実行できる
- [ ] `vibepro check agent-harness` がbundled Skill contract lint結果を含む
- [ ] Agent Review requestとparallel dispatchに、反合理化・赤旗・証跡要件が入る
- [ ] PR Gate DAGにDefinition of Done gateが入り、source変更ではcurrent-head証跡とreview closureを要求する
- [ ] docs/README/helpから新しいcontractとCLIが発見できる
- [ ] testsでSkill lint、Agent Review prompt、Definition of Done gateを確認できる

## 非目標

- agent-skills repositoryのSkillをそのままVibeProにvendorすること
- persona agentをVibeProの内部routerとして追加すること
- manual reviewをrequired parallel subagent reviewの代替として扱うこと
- Skill文書だけでPR readinessを満たした扱いにすること
