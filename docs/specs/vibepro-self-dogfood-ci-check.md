---
story_id: story-vibepro-self-dogfood-ci-check
title: Self-Dogfood CI Check Spec
---

# Spec

- `.github/workflows/ci.yml` includes `node bin/vibepro.js check self-dogfood . --run-id ci-self-dogfood --json`.
- `vibepro check <pack> --fail-on-findings` exits non-zero when the check pack status is not `pass`.
- `vibepro check <pack>` without `--fail-on-findings` keeps exit code 0 so diagnosis-sharing workflows can inspect JSON/Markdown results without shell failure.
- CI self-dogfood is a source/instruction regression visibility check because `.vibepro/pr` gate artifacts are local and gitignored.
- Story-specific final Gate enforcement is performed by `vibepro pr prepare` / `vibepro pr create`, or explicitly by `vibepro check self-dogfood --story-id <story-id> --fail-on-findings` in a workspace that has the relevant `.vibepro/pr/<story-id>` artifacts.
- `vibepro help` lists `self-dogfood` in the check pack options.
- `vibepro check list` lists `self-dogfood`.
