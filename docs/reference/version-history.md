# Version and Release Channels

The authoritative source version is `package.json`; an installed binary reports it with `vibepro version`.

| Channel | Expected after this release | Authority |
| --- | --- | --- |
| npm `latest` | `0.2.0-beta.3` | Live npm registry dist-tag |
| npm `beta` | `0.2.0-beta.3` | Live npm registry dist-tag |
| Repository `main` | `0.2.0-beta.3` release source | Git commit and `package.json` |
| Manual build | Source commit in footer/meta | Deployed VitePress artifact |

## 0.2.0-beta.3

Publishes the rebuilt minimal core and aligns the npm README, VitePress entry pages, generated CLI reference, and CI with that contract. This is a breaking beta change: commands and automatic control-plane mechanisms removed by the rebuild are not compatibility aliases.

## 0.2.0-beta.3

The previous published beta contained the broader evidence-gate and managed workflow. Pin this version only when migration time is required; it does not represent the current minimal-core direction.

The installed binary's help output wins if documentation and a locally installed version differ.

See [Release Notes](/releases/) for the chronological publication and development record.
