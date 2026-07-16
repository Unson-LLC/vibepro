# Public Discovery scope review decision

- Story: `story-vibepro-public-discovery-live-targets`
- Head: `be796491d0e061d818339a1ca8ba410d6929cdca`
- Decision: keep the ten changed files in one PR.
- Rationale: the change is one vertical public-discovery contract. The Story, Architecture, human and machine Specs, Design SSOT, scanner runtime, CLI/check-pack adapter, operator Skill, and regression tests must move together; splitting any layer would temporarily publish a contract that the runtime or operator guidance does not implement.
- Scope review: one Story document, three production source files, one focused test file, one operator Skill, and four contract/Design SSOT files. No unrelated repository-control or second-Story change is included.
- Review owner map: `gate_evidence` owns current-head evidence freshness plus regression/path-surface review; the AC adjudicator owns AC-1 through AC-9 outcome proof; the judgment adjudicator owns the senior spine, public-contract, scope-reviewability, and failure-mode judgments. The coordinator owns gate closure and PR preparation only.
- Blast radius: repository source fallback, explicit built-directory scanning, explicit live-URL scanning, CLI option forwarding, check.json/check.md coverage rendering, operator documentation, and Design SSOT reconciliation.
- Split assessment: splitting docs/specs from runtime creates a false public contract; splitting CLI/check-pack from scanner leaves unreachable or inconsistently rendered behavior; splitting tests removes the pre-fix regression proof. A future unrelated cleanup is not bundled.
- Rollback boundary: revert the single Story PR to restore source-only discovery semantics and prior coverage rendering as one atomic contract rollback.
