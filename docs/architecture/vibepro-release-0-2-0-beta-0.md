# Architecture: VibePro 0.2.0 beta release

## Decision

The release remains an explicit, immutable promotion rather than an automatic
side effect of pushing `main`. A focused version commit is merged through the
normal VibePro PR gates. The resulting main commit is tagged by the GitHub
prerelease, and `npm-publish.yml` publishes the same checkout after typecheck,
tests, and package dry-run succeed, then promotes and verifies the `beta` and
`latest` dist-tags.

## Boundaries

- `main` is the integration state, not the npm publication event.
- GitHub Release `published` is the normal npm publication event.
- `workflow_dispatch` remains an operator-controlled dry-run or recovery path.
- npm versions are immutable; rollback changes dist-tags or deprecates a bad
  version instead of attempting to replace it.
- Failure after publication is a partial registry transition: `latest` and
  `beta` must be inspected and independently restored before fixing forward.
- npm publication must leave both documented install channels, `beta` and
  `latest`, pointing at the exact release version or fail visibly.

## Compatibility

`0.2.0-beta.0` communicates an additive minor-version step while preserving the
project's early-beta compatibility warning. No runtime source is changed in the
release commit.
