# Release Boundary

VibePro separates four kinds of proof:

1. The repository version in `package.json` identifies release source.
2. A successful package workflow proves an npm publish attempt completed.
3. The npm registry version, dist-tags, and `gitHead` prove what consumers install.
4. The deployed manual's source-commit meta tag proves which documentation build is live.

Do not treat a merged version bump as npm publication, or a successful VitePress build as live deployment. Verify each surface independently.

## Minimal-core audit boundary

VibePro keeps local evidence records, but it no longer generates a canonical audit bundle or decides whether those records are sufficient. Consumers own retention, access control, review policy, CI requirements, and final approval.

## Upgrade to 0.2.0-beta.8

This is a breaking beta cleanup. Automation calling removed commands must migrate to the command list shown by `vibepro help`. To retain the previous broad workflow temporarily, pin `vibepro@0.2.0-beta.2`.
