# Gate Evidence Review — public discovery live targets

- Story: `story-vibepro-public-discovery-live-targets`
- Reviewed HEAD: `dfad9bc2758363e70022f55db3b7fb26659f74d1`
- Review scope: `origin/main...HEAD`
- Review status: **needs_changes**

## Summary

The implementation and regression outcome are supported at the reviewed HEAD: the focused public-discovery tests pass, the cross-surface integration evidence reports 19/19 scenarios, the real built-site scan exercises the bounded discovery behavior, and GitHub's Node 20, Node 22, and CodeQL checks all pass for the exact commit.

One gate-evidence integrity issue remains. The strict-head unit verification record names `node --test --test-concurrency=2`, but the JUnit output for that invocation contains 1,100 passes and two failures and therefore did not exit successfully. Its attached `unit-status.json` nevertheless declares `status: pass` and `exit_code: 0`. The two failures are environment-specific and are independently cleared by isolated reruns and by exact-head GitHub CI, so this does not indicate a product regression. It does mean the recorded unit command and its purported exit-derived status artifact do not agree.

## Finding

### [Medium] Unit status artifact is not derived from the recorded command's actual exit

- Finding id: `command-reliability-unit-artifact-not-exit-derived`
- Evidence record: `.vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json`
- Status artifact: `.vibepro/qa/public-discovery-live-targets/unit-status.json`
- Contradicting execution artifact: `.vibepro/qa/public-discovery-live-targets/full-suite-dfad9bc-junit.xml`

The unit record is bound to the current HEAD and records `node --test --test-concurrency=2`. The corresponding JUnit artifact shows two failed tests:

1. `measure records command, HTTP, startup, and Prisma log metrics` failed because the sandbox rejected a listener on `0.0.0.0` with `EPERM`.
2. `npm dry-run package excludes ...` failed because the default npm cache under `/Users/ksato/.npm-cache` was not writable.

The status JSON combines that failed invocation, two successful isolated reruns, and successful GitHub jobs into an aggregate `pass` while also asserting `exit_code: 0`. That aggregate is useful explanatory evidence, but it is not the actual exit status of the command named by the verification record. This conflicts with the gate-evidence requirement that a passing status artifact be generated from the recorded command's real exit code.

Required repair: record an exact command whose exit is captured without synthesis, or bind the unit evidence to one or both exact-head GitHub `npm test` executions and their imported CI evidence. Preserve the local sandbox failures as contextual evidence rather than claiming that the original local invocation passed.

## Independent Inspection

### Implementation and acceptance coverage

- Inspected the Story, Architecture, human-readable Spec, and machine Spec.
- Inspected the complete `origin/main...HEAD` diff across the scanner, CLI, check-pack wiring, Skill documentation, and tests.
- Confirmed the target-selection precedence is `base-url` → built `public-dir` → source scan.
- Confirmed live discovery is same-origin, bounded to 40 pages, 2 MiB per response, and 10 seconds; built/source discovery is bounded to 400 selected files.
- Confirmed omissions and failures remain explicit, a zero-page scan is inconclusive, and deterministic traversal/selection is covered.
- Confirmed `public-discovery` and `all` forward the same discovery options and surface coverage metadata.

### Focused regression execution

Executed:

```text
node --test --test-name-pattern='PDLT-AC|check all leaves optional agent harness and public discovery|check public-discovery reports LLMO|public-discovery classifies private routes|public-discovery applies documented suppressions' test/public-discovery-live-targets.test.js test/vibepro-cli.test.js
```

Result: 16 tests passed, 0 failed, at reviewed HEAD.

### Strict-head and CI evidence

- `verification-evidence.json` contains five records bound to the exact reviewed HEAD with a clean worktree.
- Cross-surface integration evidence reports 19/19 scenarios and covers live, built, source, option precedence, same-origin restrictions, bounded omissions, failure behavior, and both command surfaces.
- Real built-site scan evidence reports 483 discovered, 400 selected, 397 scanned, 83 omitted, 0 failed, and a correctly surfaced `needs_review` result.
- GitHub checks for PR 334 at the reviewed commit:
  - Node 20 test job: pass
  - Node 22 test job: pass
  - CodeQL analyze: pass
  - CodeQL workflow check: pass
- The CI workflow runs `npm test` (`node --test`) on both Node versions, in addition to typecheck, dry-run packaging, and CLI smoke/self-dogfood checks.

### CodeQL delta

The delta from the previously reviewed head changes only the test's URL-safety assertions, replacing unsafe substring matching with structured `URL` origin/path/hostname checks. CodeQL now passes and the independently rerun focused tests remain green.

## Mandatory Lens Dispositions

- `regression_guard`: **needs_changes for evidence reliability; product behavior passes.** Exact-head CI and focused execution support the regression outcome, but the local full-suite status artifact contradicts its recorded command's exit.
- `path_surface_coverage`: **pass.** Live, built, source, `public-discovery`, and `all` surfaces are represented, including precedence and bounded-failure paths.
- `freshness_and_head_binding`: **pass.** The inspected records and imported CI evidence are bound to `dfad9bc2758363e70022f55db3b7fb26659f74d1`; the worktree was clean.
- `codeql_and_ci`: **pass.** Node 20, Node 22, and CodeQL checks pass for the reviewed commit.
- `evidence_handling`: **needs_changes.** No prompt-injection issue was found, but the unit pass artifact is synthesized rather than exit-derived from its recorded command.

## Prior Finding Dispositions

1. Missing full-suite / Skill lint evidence: **behavioral outcome closed by exact-head Node 20 and Node 22 CI; recording integrity remains open under the new finding above.**
2. Non-replayable integration command: **closed.** The current cross-surface artifact reports 19/19 structured scenarios with replayable inputs and outputs.
3. Live CLI path unverified: **closed.** Both `public-discovery` and `all` are covered.
4. Silent sitemap exclusions: **closed.** Discovery/selection/scan/omission counts, bounded samples, and truncation metadata are exposed.

## Judgment Delta

- Relative to the prior final pass, implementation confidence did not regress; the only code delta is the CodeQL-safe URL assertion change and it passes focused tests and CI.
- This review changes the gate judgment to `needs_changes` because the current strict-head unit record newly presents a command/status contradiction. The corrective action is evidence rebinding or exact exit capture, not implementation rework.
- No blocking security, behavior, compatibility, or path-surface defect was identified.

## Verdict JSON

```json
{
  "status": "needs_changes",
  "summary": "Exact-head implementation, focused regression tests, Node 20/22 CI, and CodeQL pass, but the unit verification record claims exit_code 0 for a local command whose JUnit artifact records two failures. Repair the evidence binding or capture an exact successful command exit.",
  "inspection_summary": "Inspected the Story, Architecture, human and machine Specs, complete origin/main...HEAD diff, strict-head verification records, JUnit and status artifacts, real built-site scan, imported CI evidence, current GitHub checks, prior review findings, and independently reran the focused public-discovery regression set.",
  "inspection_evidence": "Focused tests: 16/16 pass. Integration: 19/19 pass. GitHub Node 20, Node 22, and CodeQL: pass at dfad9bc. Real built scan: 483 discovered, 400 selected, 397 scanned, 83 explicitly omitted, 0 failed. Local full-suite JUnit: 1100 pass and 2 sandbox/environment failures, contradicting unit-status.json exit_code 0 for the recorded local command.",
  "inspection_inputs": [
    "docs/management/stories/active/story-vibepro-public-discovery-live-targets.md",
    "docs/architecture/vibepro-public-discovery-live-targets.md",
    "docs/specs/vibepro-public-discovery-live-targets.md",
    "docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json",
    "origin/main...dfad9bc2758363e70022f55db3b7fb26659f74d1",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json",
    ".vibepro/qa/public-discovery-live-targets/unit-status.json",
    ".vibepro/qa/public-discovery-live-targets/full-suite-dfad9bc-junit.xml",
    ".vibepro/qa/public-discovery-live-targets/final-verification.md",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_20_.json",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_22_.json",
    ".vibepro/checks/public-discovery/public-discovery-live-targets-final-dfad9bc/check.json",
    ".vibepro/qa/public-discovery-live-targets/review-gate-evidence-v1.md",
    ".vibepro/qa/public-discovery-live-targets/review-gate-evidence-final.md"
  ],
  "judgment_delta": [
    "The product judgment remains positive: the CodeQL-safe assertion-only delta passes focused tests and exact-head CI.",
    "The gate judgment changes from pass to needs_changes because the current unit status artifact is not derived from the actual exit of its recorded command.",
    "The remaining correction is evidence repair, not implementation rework."
  ],
  "findings": [
    {
      "id": "command-reliability-unit-artifact-not-exit-derived",
      "severity": "medium",
      "title": "Unit status artifact contradicts the recorded command's actual exit",
      "detail": "The verification record names node --test --test-concurrency=2, whose JUnit output has 1100 passes and two failures, while unit-status.json asserts pass and exit_code 0. Isolated reruns and exact-head CI clear the product regression risk but do not make that local command exit successfully.",
      "required_change": "Bind unit evidence to an exact successful CI npm test execution or record a precise composite/local command whose real exit is captured; retain the failed local run only as contextual evidence."
    }
  ]
}
```
