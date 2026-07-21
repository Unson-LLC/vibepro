---
story_id: story-vibepro-canonical-audit-gate-dag-replay
title: Canonical Audit Gate DAG Replay Spec
related_architecture:
  - ../architecture/vibepro-canonical-audit-gate-dag-replay.md
---

# Spec

## Contracts

- `CAGR-CONTRACT-001`: summary-depth代替は`write_full_gate_dag_dump=false`または`skipped_artifacts`への`gate-dag.json`登録を必要とする。
- `CAGR-CONTRACT-002`: 代替は`generated_artifacts`に`evidence-plan.json`と`decision-index.json`があり、両ファイルが実在する場合だけ成立する。
- `CAGR-CONTRACT-003`: 成立時は`gate_dag`を`missing_artifacts`へ追加せず、そのGate DAG source referenceを`unresolved_references`へ渡さない。
- `CAGR-CONTRACT-004`: `gate-dag.json`が実在する場合は`gate_dag` artifactとしてcanonical replayへ収録する。

## Scenarios

- `CAGR-S-001`: summary depthの完全な代替artifact集合をpromotionするとhandoff replayはreadyになる。
- `CAGR-S-002`: decision indexが欠けたsummary depthをpromotionするとGate DAG参照によりhandoff replayはblockedになる。
- `CAGR-S-003`: full depthをpromotionするとreplayのartifact kindsに`gate_dag`が含まれる。

## Verification

- `test/canonical-audit-self-contained.test.js`
