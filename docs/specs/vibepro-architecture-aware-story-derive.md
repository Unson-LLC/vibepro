---
story_id: story-vibepro-architecture-aware-story-derive
title: Architecture-Aware Story Derive Spec
status: draft
created_at: 2026-05-21
updated_at: 2026-05-21
related_architecture:
  - ../architecture/vibepro-architecture-aware-story-derive.md
---

# Architecture-Aware Story Derive Spec

## Invariants

- `INV-ASD-1`: `story derive` must compute a repo profile before promoting preset product surface Stories.
- `INV-ASD-2`: When no preset is explicit and the repo profile is not `next-app` or `web`, Next.js/Web/SaaS product surface Stories must not be promoted from code token matches alone.
- `INV-ASD-3`: Explicit `--preset <id>` and repo-local `story_catalog.preset` must remain authoritative operator input and preserve backwards-compatible preset behavior.
- `INV-ASD-4`: Suppressed template Stories must be represented as warnings or candidates, never as validated `story_cluster` Stories.
- `INV-ASD-5`: `story-catalog.json` must include selected preset, preset resolution mode, repo profile, and suppression warnings.
- `INV-ASD-6`: `story-map.md` must expose repo profile and warning codes so a human can understand why Stories were omitted.
- `INV-ASD-7`: Source recovery implementation hints must not satisfy design-first Story source consistency unless explicit Story, Architecture, and Spec sources are linked.

## Contracts

### Repo Profile Contract

The profile object must include:

```json
{
  "id": "next-app|web|api-service|python-cli|data-pipeline|library|unknown",
  "confidence": "high|medium|low",
  "product_surface_applicable": true,
  "languages": [],
  "language_counts": {},
  "evidence": []
}
```

`product_surface_applicable=false` means Web/SaaS template product Stories require explicit preset selection or matching document evidence.

### Preset Resolution Contract

`source.preset_resolution.mode` must be:

- `explicit`: CLI `--preset` or repo config selected the preset
- `auto`: VibePro selected a preset internally and must apply repo-profile gates before promotion

### Warning Contract

Suppressed template Stories use warning code `needs_domain_confirmation` and include:

- `repo_profile`
- `preset`
- `suppressed_story_ids`
- `suppressed[].story_id`
- `suppressed[].reason`
- `suppressed[].evidence_paths`

## Scenarios

- `S-ASD-1`: A Python CLI / algorithmic trading repo includes files such as `src/backtest_engine.py`, `scripts/run_*.py`, and `src/session_learning.py`. Without `--preset`, VibePro emits no `story-product-auth-account-access`, `story-product-content-cms`, or `story-product-notification` Stories from token matches.
- `S-ASD-2`: The same non-Web repo run with `--preset next-app` may emit Next.js product surface Stories because the operator explicitly opted in.
- `S-ASD-3`: A Web/Next.js repo with `src/components/auth/LoginForm.tsx` and auto preset selection continues to classify relevant files and may emit Web product Stories.
- `S-ASD-4`: A non-Web repo with suppressed template matches emits `needs_domain_confirmation` in JSON and Markdown outputs.
- `S-ASD-5`: Source briefing without a signature helper still keeps middleware files as fallback evidence for older or lightweight source recovery flows. Design-first Stories remain incomplete until their Architecture and Spec sources are explicitly linked.

## Anti-patterns

- Do not infer account/auth product capability from a generic file named `session_learning.py` or `session-learning.js`.
- Do not infer notification product capability from algorithmic scoring, logging, or alert-like internal filenames without product notification evidence.
- Do not hide template suppression; silence is indistinguishable from a complete Story map.
