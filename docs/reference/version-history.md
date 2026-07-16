# Version and Release Channels

The authoritative package version is `package.json`; the installed binary reports it with `vibepro version`.

| Channel | Current value | Authority |
| --- | --- | --- |
| npm `latest` | `0.2.0-beta.0` | Published registry state after the release workflow completes |
| npm `beta` | `0.2.0-beta.0` | Published registry state after the release workflow completes |
| Repository `main` | `0.2.0-beta.0` release source | Git commit and `CHANGELOG.md` |
| Manual build | Footer/meta source commit | Deployed build artifact |

## Unreleased Manual-Visible Capabilities

- Risk-adaptive Gate DAG with independent review lifecycle and adjudication.
- Managed execution through PR creation and audited merge.
- CI evidence import, existing-PR refresh, canonical audit replay, and cost/ROI reports.
- Journey, UI/UX intake and map, VibePro-native Design System, visual/responsive/a11y evidence, and design modernization flows.
- Bounded summary/readiness views and explicit responsibility/authority contracts.

Install the published beta explicitly with `npm install -g vibepro@beta`. When the installed help differs from this manual, the running binary's contract wins. See [Release and Audit](/guide/release-and-audit) and the repository `CHANGELOG.md` for the boundary.

See [Release Notes](/releases/) for a reader-focused history that separates published versions from PR-derived development milestones.

`0.1.0-alpha.0` introduced the OSS-ready package shape, phase checkpoints, Story/Spec review flow, and public discovery documentation.
