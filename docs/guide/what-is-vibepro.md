# What VibePro Is

VibePro is a **repository-local control plane for evidence-backed, safe delivery by AI coding agents**. It does not write the product on the team's behalf. It makes the path from product intent to merge inspectable and fail-closed where proof or judgment is missing.

The complete loop is:

1. Story defines the product outcome and acceptance criteria.
2. Architecture and Spec define boundaries, contracts, tests, and rollback.
3. Code is implemented in a bounded branch or managed worktree.
4. Verification records observable results against the current commit.
5. Independent Agent Review inspects the diff and its evidence.
6. Adjudication evaluates whether Spec clauses and senior judgment are actually demonstrated.
7. Release Guard and `pr prepare` resolve the risk-adaptive Gate DAG.
8. `pr create` creates or refreshes the PR from the current evidence.
9. CI is imported and the PR artifact is refreshed for the current head.
10. `execute merge` merges through the audited path.
11. Canonical audit and usage/ROI reporting preserve what shipped, why, and at what evidence cost.

## Human Authority

Humans hold the entry and exit decisions. They decide the product intent, approve material trade-offs, and own the final release authority. Agents may implement, inspect, and propose; evidence may demonstrate; neither silently expands authority.

## What VibePro Does Not Do

- It is not a hosted coding agent, issue tracker, or product knowledge base.
- It does not replace tests, CI, security review, deployment observability, or engineering judgment.
- It does not treat a generated explanation, graph, screenshot, or PR body as proof by itself.
- It does not make every change equally expensive; gates expand according to detected risk.

Brainbase can be an optional upstream source of product context, organizational knowledge, and Story candidates. VibePro remains the downstream execution and PR-gate layer. A repository can use VibePro without Brainbase.

Continue with the [Control Loop](/guide/control-loop) or choose a role-specific path from the [home page](/).
