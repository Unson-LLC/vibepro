---
story_id: story-vibepro-oss-readiness-check-pack
title: OSS Readiness Check Pack Spec
---

# Spec

## CLI

`vibepro check oss-readiness <repo> [--run-id <id>] [--json] [--fail-on-findings]`

The check pack MUST use the existing check pack artifact layout:

```text
.vibepro/checks/oss-readiness/<run-id>/
  check.json
  check.md
```

## Core Tools

The v1 OSS readiness pack MUST run these external tools when available:

- Gitleaks
- OpenSSF Scorecard
- Syft
- Grype
- REUSE

VibePro MUST NOT auto-install these tools.

Missing tools, missing GitHub repository context, or unusable setup MUST be recorded as `needs_setup`.

## Risk Policy

- Gitleaks findings MUST be `fail` / `block`.
- VibePro MUST NOT store raw secret values from Gitleaks output.
- Syft successful SBOM generation MUST be `pass`.
- Grype critical/high vulnerabilities MUST be `fail`; medium vulnerabilities MUST be `needs_review`; low/info vulnerabilities MAY be informational findings.
- Scorecard score lower than 7.0 MUST be `needs_review`.
- REUSE non-compliance MUST be `needs_review`.
- `--fail-on-findings` MUST preserve the existing check pack behavior: non-`pass` status exits non-zero.

## Evidence

`check.json` MUST include normalized tool summaries and findings. Findings MUST use the existing check pack shape with `id`, `severity`, `gate_effect`, `path`, `detail`, and `required_action` where applicable.

The check pack SHOULD keep outputs compact. It MUST NOT store unbounded raw tool output.
