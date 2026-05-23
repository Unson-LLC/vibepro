---
story_id: story-vibepro-self-dogfood-final-gate
title: Self-Dogfood Final Gate Spec
---

# Spec

## Command

```bash
vibepro check self-dogfood <repo> --story-id <story-id>
```

## Findings

- `self_dogfood.final_gate_missing.<story-id>`: `verification-evidence.json` があるが `pr-prepare.json` または `gate-dag.json` がない。
- `self_dogfood.unresolved_gate_dag.<story-id>`: `gate-dag.json` があり、`overall_status` が `ready_for_review` ではない。
- `self_dogfood.invalid_gate_dag.<story-id>`: `gate-dag.json` が存在するがvalid JSONとして読めない。
- `self_dogfood.pr_create_without_gate_override.<story-id>`: unresolved Gateのまま `pr-create.json` が存在し、VibePro waiverが記録されていない。
- `self_dogfood.raw_gh_pr_create_guidance.<path>`: docs / skills / agent-instructions / CIに raw `gh pr create` を標準経路のように案内する文言がある。
- `self_dogfood.agent_review_skip_language.<path>`: Agent Review Gateの省略を許すように読める文言がある。
- `self_dogfood.subagent_permission_waiting_language.<path>`: subagent dispatchを人間の事前承認待ちにするように読める文言がある。

`--story-id` が指定された場合、PR artifact findingは対象Story配下だけを見る。instruction findingはファイルパスまたは本文に対象Story IDを含むものだけを返し、無関係なStoryの文言を混ぜない。

## Output

The check writes:

- `.vibepro/checks/self-dogfood/<run-id>/check.json`
- `.vibepro/checks/self-dogfood/<run-id>/check.md`
