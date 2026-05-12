---
story_id: story-vibepro-diagnosis-commercialization-roadmap
title: "dotenvx encrypted env secret scanner behavior"
status: active
---

# dotenvx encrypted env secret scanner behavior

## Requirements

- VibePro must scan tracked env files for plaintext secret risk unless the line is a known safe dotenvx control or encrypted value.
- `DOTENV_PUBLIC_KEY*` env entries must be treated as public dotenvx metadata.
- `KEY=encrypted:...` and `KEY="encrypted:..."` env entries must be treated as encrypted dotenvx values.
- Plain env values that are not dotenvx encrypted must continue to be reported as `env_file_value` with `gate_effect=block`.
- Non-env runtime code secret heuristics must not be weakened by the dotenvx exception.

## Verification

- `npm test`
- SalesTailor diagnosis run `post-vibepro-dotenvx-secret-detector` no longer reports `VP-STATIC-002` for dotenvx encrypted env files.
