# Runtime Contract Review

- Agent: `019f84bd-7a30-71b0-ae96-9a8d97061217`
- Model: `gpt-5.6-luna`
- Reasoning: `high`
- HEAD: `ff234a2b76a712d47d3127ba78eb86f4fa223b5d`
- Status: `needs_changes`

The main runtime contracts pass, but attribution uses `session.cwd` while canonical observed-worktree resolution prefers process-manager cwd. If session metadata is stale and process-manager cwd is the correct structural worktree, cue-less events are misclassified as unclassified, undercounting the associated upper bound and distorting the strict/associated ratio. Pass the process-manager-preferred cwd into the attribution detector and cover it with a fixture.
