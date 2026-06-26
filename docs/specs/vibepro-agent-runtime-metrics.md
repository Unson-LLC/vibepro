# Spec: VibePro Agent Runtime Metrics

## Contracts

- `ARM-CONTRACT-001`: `usage report --subagent-roi --json` MUST expose `subagent_roi.time_efficiency.wall_clock_elapsed_ms` as merged lifecycle intervals where parallel subagents count once.
- `ARM-CONTRACT-002`: `usage report --subagent-roi --json` MUST expose `subagent_roi.time_efficiency.agent_consumption_elapsed_ms` as summed per-review elapsed time where parallel subagents are intentionally counted separately.
- `ARM-CONTRACT-003`: `usage report --subagent-roi --json` MUST expose `subagent_roi.time_efficiency.parallelism_factor` only when wall-clock intervals are observed.
- `ARM-CONTRACT-004`: `usage report --subagent-roi --json` MUST expose `by_agent_system[]` so Codex and Claude Code telemetry gaps are visible separately.
- `ARM-CONTRACT-005`: Missing lifecycle interval or token data MUST remain explicit as missing counts rather than being interpreted as observed zero cost.

## Scenarios

- `ARM-S-001`: Given two Codex review agents overlap for two wall-clock minutes and consume three summed agent minutes, when usage report runs, then `wall_clock_minutes=2`, `agent_consumption_minutes=3`, and `parallelism_factor=1.5`.
- `ARM-S-002`: Given a Claude Code review has no observed token usage or lifecycle interval, when usage report runs, then the Claude Code row reports missing token and interval counts instead of zero observed cost.
