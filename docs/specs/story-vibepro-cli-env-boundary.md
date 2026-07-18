---
story_id: story-vibepro-cli-env-boundary
status: final
code_refs:
  - bin/vibepro.js:4
test_refs:
  - test/bin-entrypoint.test.js
---

# Spec: CLI environment boundary

## CEB-S-1

`bin/vibepro.js` MUST pass `env: process.env` together with stdout and stderr to `runCli`.

## CEB-S-2

The entrypoint contract test MUST fail when any of stdout, stderr, or env is omitted from the IO context.

## CEB-S-3

The entrypoint MUST NOT enumerate, serialize, or persist environment values.
