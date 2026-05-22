---
story_id: story-vibepro-public-discovery-targeting
title: Public Discovery Targeting Spec
status: draft
created_at: 2026-05-22
updated_at: 2026-05-22
related_architecture:
  - ../architecture/vibepro-public-discovery-targeting.md
---

# Public Discovery Targeting Spec

## Invariants

- `INV-PD-1`: public-discovery must classify a route target before applying LLMO findings.
- `INV-PD-2`: verification HTML files must not produce metadata, structured data, E-E-A-T, image, or content findings.
- `INV-PD-3`: auth/private/internal/demo routes must not be treated as public SEO/LLMO targets by default.
- `INV-PD-4`: App Router inherited metadata can satisfy page-level title, description, social metadata, and structured data checks.
- `INV-PD-5`: documented suppressions require a reason and must be auditable in JSON evidence.
- `INV-PD-6`: suppressed findings are excluded from active review counts but retained in a `suppressed_findings` section.

## Suppression Schema

`.vibepro/public-discovery-suppressions.json`:

```json
[
  {
    "file": "public/google*.html",
    "finding_kinds": ["missing_title"],
    "reason": "Google Search Console verification file must remain exact",
    "expires_at": null
  }
]
```

## Scenarios

- `S-PD-1`: `public/google*.html` with Google site verification text is classified as `verification_file` and skipped.
- `S-PD-2`: `src/app/(auth)/**/page.tsx` is classified as `auth_flow` and skipped by default.
- `S-PD-3`: `src/app/(app)/**/page.tsx` is classified as `private_app_route` and skipped by default.
- `S-PD-4`: `src/app/(public)/articles/page.tsx` inherits title/description/social/schema from `src/app/layout.tsx` and does not receive missing metadata findings solely because the page file is local-empty.
- `S-PD-5`: A suppression with a matching file and finding kind removes the active finding and records the reason under `suppressions.suppressed_findings`.
- `S-PD-6`: Unknown finding kinds and unmatched suppressions are emitted as suppression warnings.
