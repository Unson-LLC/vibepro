# Release Boundary

VibePro separates four kinds of proof:

1. The repository version in `package.json` identifies release source.
2. A successful package workflow proves only that the workflow completed. When `release_required=false`, the publish step is skipped and the summary records `npm=skipped (package version unchanged)`. Workflow success alone does not prove that publishing ran.
3. When `release_required=true`, a completed publish step records that the publishing process ran. A readback of the npm registry version, dist-tags, and `gitHead` verifies registry reflection.
4. The deployed manual's source-commit meta tag proves which documentation build is live.

Do not treat a merged version bump or a successful package workflow as npm publication. Verify the publish-step execution and the registry readback independently. Registry reflection still does not prove installation, startup, downstream processing, or the user's outcome in a real consumer environment. Similarly, a successful VitePress build is not live deployment; verify the required consumer-side readback separately.

## Minimal-core audit boundary

VibePro keeps local evidence records, but it no longer generates a canonical audit bundle or decides whether those records are sufficient. Consumers own retention, access control, review policy, CI requirements, and final approval.

## Upgrade to 0.2.0-beta.28

This is a breaking beta cleanup. Automation calling removed commands must migrate to the command list shown by `vibepro help`. To retain the previous broad workflow temporarily, pin `vibepro@0.2.0-beta.2`.
