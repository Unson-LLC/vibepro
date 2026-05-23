---
story_id: story-vibepro-oss-apache2-readiness
title: OSS Apache-2.0 Readiness Spec
---

# Spec

## License

- `LICENSE` MUST contain Apache License 2.0.
- `package.json#license` MUST be `Apache-2.0`.
- README files MUST show Apache-2.0.

## Graphify Notice

README files MUST state:

- Graphify is optional.
- Graphify is not bundled with VibePro.
- `--run-graphify` invokes an external command.
- `--from graphify-out` imports generated artifacts.
- Graphify is used under its own license.

## Package Contents

`npm pack --dry-run` MUST NOT include:

- `.vibepro/`
- `node_modules/`
- `docs/releases/`
- local logs
- Graphify source code copied into VibePro

## OSS Operations

The repository SHOULD include:

- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md`
- GitHub issue templates
- PR template
- CI workflow
