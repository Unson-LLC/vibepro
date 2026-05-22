# Contributing to VibePro

Thanks for helping improve VibePro.

## Development

```bash
npm install
npm run typecheck
npm test
npm run pack:dry-run
```

## Pull Requests

- Keep changes scoped to one story or bug.
- Add or update tests for changed behavior.
- Run `npm run typecheck` and `npm test` before opening a PR.
- Do not commit `.vibepro/` workspaces, local logs, customer data, or secrets.
- For user-facing behavior, update `README.md` and `README.ja.md` when needed.

## VibePro Workflow

For non-trivial changes, create or update a Story, Architecture note, and Spec under `docs/`.
Use checkpoint gates before treating work as complete:

```bash
node bin/vibepro.js checkpoint implementation-start . --story-id <id> --base <base-ref>
node bin/vibepro.js checkpoint verification . --story-id <id> --base <base-ref>
```

## License

By contributing, you agree that your contributions are licensed under the Apache License, Version 2.0.
