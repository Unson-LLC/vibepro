---
story_id: story-vibepro-oss-readiness-check-pack
title: OSS Readiness Check Pack Architecture
---

# Architecture

## Intent

VibePro provides an OSS publication readiness check pack that orchestrates existing specialist tools and records reviewer-friendly artifacts.

VibePro does not replace Gitleaks, Scorecard, Syft, Grype, or REUSE. It normalizes their results into the existing check pack evidence model.

## Boundaries

| Boundary | Responsibility | Must Not Do |
|----------|----------------|-------------|
| Check Pack | Expose `vibepro check oss-readiness` and aggregate status | Auto-install external tools |
| OSS Scanner | Execute Core 5 tools and normalize outputs | Persist raw secrets or unbounded logs |
| Evidence | Store compact JSON/Markdown findings under `.vibepro/checks/oss-readiness/` | Hide setup gaps from reviewers |
| Gate Aggregation | Map tool outcomes into `pass / needs_setup / needs_review / fail` | Treat missing tools as pass |

## Data Flow

1. CLI dispatches `check oss-readiness` through the existing check pack runner.
2. `oss-readiness` invokes the OSS scanner.
3. The scanner executes external tools with explicit argv, parses supported JSON output, and redacts sensitive details.
4. Check pack aggregation writes `check.json`, `check.md`, and manifest entries.
