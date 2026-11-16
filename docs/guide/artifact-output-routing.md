# Artifact output routing

VibePro uses `.vibepro/config.json` as the tracked repository contract for canonical artifact locations. `vibepro init` ignores generated workspace files while leaving this config trackable.

Without `artifact_routing`, all paths remain backward-compatible. To place a feature packet under one project-native directory:

```json
{
  "artifact_routing": {
    "schema_version": "0.1.0",
    "artifacts": {
      "story": { "canonical": "docs/features/{feature_slug}/01_behavior_spec.md" },
      "architecture": { "canonical": "docs/features/{feature_slug}/04_technical_delta.md" },
      "accepted_spec": { "canonical": "docs/features/{feature_slug}/02_functional_spec.json" },
      "task_plan": { "canonical": "docs/features/{feature_slug}/06_tasks.md" }
    }
  }
}
```

Supported stable variables are `{story_id}` and `{feature_slug}`. Both are lowercase kebab-case; `feature_slug` removes a leading `story-`. Paths must be repository-relative. Absolute paths, traversal, unresolved variables, and destinations shared by two artifact kinds fail before a write.

Each kind has exactly one writable `canonical`. A projection is allowed only when explicitly machine-managed:

```json
{
  "path": "docs/generated/{story_id}/architecture.md",
  "generated": true
}
```

Projections are rebuildable views, not editable sources of truth.

Inspect the contract and plan a migration without editing files:

```bash
vibepro artifacts resolve . --id story-example --json
vibepro artifacts migrate . --id story-example --dry-run --json
```

The migration plan reports the old default, resolved destination, existence, required moves, and collisions. Move tracked artifacts only after reviewing that plan.

Rollback is not a config-only operation. The migration plan compares the default source with the destination resolved from the current config. If you remove `artifact_routing` first, VibePro cannot infer the custom destination that was in use. Before removing the setting, save the dry-run `source`/`destination` mapping and review collisions and ownership. Move the custom artifacts back to the legacy defaults from that saved mapping, verify the result without overwriting existing files, and only then remove `artifact_routing`. If the setting was already removed, recover the mapping from the pre-change config or Git history; a fresh dry-run after removal cannot reconstruct the old custom layout.
