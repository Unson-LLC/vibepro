---
parent_design: vibepro-owner-gated-budget-override
story_id: story-vibepro-budget-grant-tracked-decision-doc
status: active
---

# Architecture: tracked decision documents for budget grants

## Contract change (old → new)

`vibepro decision record --source budget:delivery_efficiency:<story-id>`:

| Surface | Old | New |
|---|---|---|
| Write targets | workspace decision store only (`.vibepro/pr/<story-id>/decision-records.json`, gitignored) | workspace store **plus** a tracked document `docs/management/decisions/<date>-budget-override-<story-id>-<digest8>.md` (`type: budget_override_approval`) |
| `budget_approval` shape | no document reference | additive field `decision_doc` holding the tracked document's repo-relative path |
| Gitignored document path | n/a (nothing tracked was written) | fail-closed: the command errors before the workspace store is written |
| No-grant decisions | unchanged | unchanged (no document, same output shape) |
| Override resolution | `resolveBudgetOverrideAuthority` reads the workspace record | unchanged — `decision_doc` is never read by enforcement |

## Why

The parent design root made an override inert without an accepted, digest-bound
grant, but the grant itself lived only in the gitignored workspace store: a PR
reviewer saw the raised numbers and the agent-written `amendment_reason`, never
the grantor, digest, or timestamp (finding
`budget-grant-record-not-reviewable-in-diff`). The tracked mirror puts the
structured record on the diff surface the residual-forgery argument depends on.
The digest prefix in the filename turns a changed budget into a new file in the
diff rather than an edit that can be missed.

## Boundary

Enforcement semantics are untouched; this is a reviewability channel only.
In-band forgery of a human name remains the parent root's residual. The
implementation is `writeBudgetApprovalDoc` in `src/decision-records.js`; the
gitignore boundary is asserted from both sides in
`test/integration/story-vibepro-budget-grant-tracked-decision-doc.test.js`.
