# VibePro Repository Local Control Plane Frame

VibePro treats each target repository as the control boundary for AI-assisted delivery.

The repository-local control plane owns:

- `.vibepro/` state and artifacts.
- Story, Spec, Architecture, verification, review, and decision context.
- Optional impact context from Graphify and code topology providers.
- PR readiness state and merge audit evidence.

It does not own:

- The external portfolio dashboard.
- Agent-specific MCP configuration.
- Runtime or production deployment platforms.

This frame keeps VibePro useful as a local CLI while allowing optional integrations to improve review context.
