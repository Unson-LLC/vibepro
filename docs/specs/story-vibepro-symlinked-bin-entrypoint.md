---
story_id: story-vibepro-symlinked-bin-entrypoint
status: active
parent_design: vibepro-symlinked-bin-entrypoint
code_refs:
  - bin/vibepro.js
test_refs:
  - test/bin-entrypoint.test.js
---

# Spec: symlinked binary entrypoint

## SBE-INV-001

The entrypoint MUST treat the module file and a file symlink resolving to that
same file as direct execution.

## SBE-INV-002

Importing the entrypoint as a module MUST NOT invoke the CLI automatically.

## SBE-INV-003

Missing or unresolvable entrypoint input MUST return a non-direct-execution
verdict without throwing during module import.

## Verification

- Execute `version` through the real file and through a temporary file symlink;
  both processes must exit with code 0 and print the same version.
- Import the module in a child process and assert that import alone produces no
  CLI output.
- Exercise missing and unresolvable entrypoint inputs against the exported
  direct-execution predicate.
