# Feature Map

| Area | Commands | Output |
| --- | --- | --- |
| Story and Spec | `story list`, `story derive`, `story diagnose` | Story catalog, diagnosis reports, traceability context |
| Graph artifacts | `graph` | `.vibepro/graphify/` |
| PR readiness | `pr prepare`, `check pr-readiness` | `.vibepro/pr/<story-id>/` |
| Verification | `verify record`, `verify status` | `.vibepro/verification-artifacts/` |
| Review | `review prepare`, `review record`, `review status` | `.vibepro/reviews/` |
| Decisions | `decision record`, `decision status` | Risk acceptance and waiver records |
| Doctor | `doctor` | Workspace health and repair candidates |

`codebase-memory-mcp` has no separate VibePro command. When available, `pr prepare` reads it automatically as an optional topology provider.
