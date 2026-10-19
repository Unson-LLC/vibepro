# Lesson: localized UI bug_fix evidence bloat (#615 / #612)

## Source

- brainbase-organization PR **#615** (meeting-triage `place()` / CSSOM)
- Spec **#612**
- Product code: ~13 lines
- Evidence: ~194k lines, 46 PNGs (other-screen pixel matrix + width×state grid ACs)
- Two follow-up commits were evidence-only after Maintainer sendback

## Calibration questions (future eval cycles)

1. **Mechanical profile** — Given a git diff stat payload, does the classifier
   match `LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES=2` and
   `LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC=80` with zero shared-layout glob
   hits?
2. **Primary cap warning** — Given a `bug_fix` Story and mechanical profile,
   does a Spec clause requiring “full width×state PNG grid” produce warning code
   `localized_bugfix_primary_evidence_cap_exceeded` without blocking `spec write`?
3. **Nondeterministic list** — When `nondeterministic_surfaces` omits a screen,
   does guidance state pixel diff remains pass/fail for that screen?
4. **Sendback specificity** — Does a maintainer comment that says “re-add whole
   matrix” fail the slim-sendback rubric in favor of naming the missing summary
   JSON / unit test / PNG cell?

## Thresholds (version 0.1)

| Signal | Pass | Fail |
|---|---|---|
| Evidence lines in git vs product LOC | evidence_lines ≤ 50 × product_loc | evidence_lines &gt; 200 × product_loc |
| PNG count for mechanical localized fix | ≤ 4 | &gt; 4 without `regression_matrix` tier |
| Maintainer rework commits evidence-only | 0 after primary tier adopted | ≥ 2 consecutive evidence-only |

## Non-goals

- Do not retroactively apply these caps to in-flight #615 / #612.
- Do not treat pixel diff as advisory globally; only for explicitly listed
  nondeterministic surfaces.
