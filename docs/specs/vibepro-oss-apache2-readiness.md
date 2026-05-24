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

The npm package SHOULD stay focused on runtime CLI contents. Public design docs may live in the GitHub repository without being bundled into the npm tarball.

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

## Reviewable PR Evidence

VibePro-generated PR bodies MUST use canonical story source fields for reviewer-facing context:

- Story labels MUST prefer `story_source.requirement_title` or `story_source.title` over stale local config titles such as `Story`.
- Requirement titles MUST use the same canonical source title fallback.
- When no explicit `## Background` / `## 背景` section exists, VibePro SHOULD extract a concise background from the prose directly under `# Story`.
- VibePro MUST NOT emit `背景: Story文書から抽出できませんでした` when the story document contains usable introductory prose.

## Phase-Gated Agent Review

VibePro MUST NOT require all development-phase subagent reviews at PR time.

- `planning_spec` and `architecture_spec` reviews MUST be enforced by the `implementation-start` checkpoint.
- `test_plan` reviews MUST be enforced by the `test-plan` checkpoint.
- `implementation` reviews MUST be enforced by the `implementation-complete` checkpoint.
- `gate` reviews MUST be enforced before PR readiness when source changes exist.
- `preview` reviews MUST be enforced before PR readiness when UI or network runtime risk exists.
- `pr prepare` MUST surface only PR-final required review stages in its Agent Review Gate.
