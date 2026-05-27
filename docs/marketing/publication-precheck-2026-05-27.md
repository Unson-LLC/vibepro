# VibePro Publication Precheck - 2026-05-27

## Recommendation

GitHub OSS publication is ready for internal explanation and controlled public release.

npm publication should follow after the small metadata/tarball fix in this branch is merged, the GitHub repository is made public, and npm account protection is confirmed.

## Current Positioning

- Tagline: Stop babysitting AI. Ship what you meant to build.
- Japanese tagline: AIを見張り続けるのをやめる。作りたかったものを出荷する。
- Core claim: VibePro keeps product intent, required gates, role-based agent reviews, waivers, and PR evidence bound to the current git state.

## Checks Run

| Area | Result | Notes |
| --- | --- | --- |
| Unit / CLI tests | Pass | `npm test` passed 240/240. |
| Syntax/type check | Pass | `npm run typecheck` passed. |
| npm package dry run | Pass | Package contains CLI, source, skills, READMEs, license, notice, and README header image. Internal `.vibepro/`, `node_modules/`, release docs, and broad docs tree remain excluded. |
| Local npm install smoke test | Pass | Packed tarball installed in a temp project and `vibepro --help` ran. |
| npm package name | Available | `npm view vibepro` returned 404, so the name was not present in the public registry at check time. |
| Gitleaks | Pass | 1106 commits and about 103 MB scanned; no leaks found. |
| REUSE | Pass | 212/212 files have license and copyright metadata; Apache-2.0 only. |
| Syft SBOM | Pass | SBOM generated with 10 components. |
| Grype | Pass | 0 vulnerability matches. |
| VibePro OSS readiness | Needs review | No blocking findings. Scorecard review items remain. |
| GitHub repo state | Not public yet | `Unson-LLC/vibepro` is still private. |
| GitHub Actions on main | Mixed | Dependabot workflows passed. CodeQL skipped while private. CI failed before steps on runner/budget style jobs, not from test assertions. |

## Remaining Review Items

OpenSSF Scorecard currently reports score 5.7, below the internal threshold of 7. The current review findings are:

- Packaging: Scorecard returns -1.
- Signed-Releases: Scorecard returns -1.
- Overall score: needs review, not a release blocker for alpha OSS publication if explicitly waived.

Recommended waiver for alpha:

> VibePro is being published as an alpha CLI before a signed GitHub release cadence exists. Packaging and signed-release Scorecard findings are accepted for the initial OSS announcement. We will revisit after the first public release tag and npm provenance setup.

## npm-Specific Notes

Before `npm publish`, confirm:

- Repository is public, so README links and support URLs resolve.
- npm account has 2FA or trusted publishing enabled.
- First public version is intentionally chosen. `0.1.0-alpha.0` is acceptable if never published, but `0.1.0-alpha.1` is cleaner after the publication-readiness metadata fix.
- Publish from a clean tag/commit.

## Go / No-Go

Go for tomorrow's internal explanation:

- The product message is coherent.
- README and GitHub About are aligned.
- License, security, contribution, issue templates, and code of conduct exist.
- Secret, license, SBOM, vulnerability, packaging dry-run, and install smoke checks have been run.

No-go only if the intended action is immediate npm publication without first merging the metadata/tarball fix and confirming npm account protection.
