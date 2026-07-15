# バージョンとリリースチャネル

package versionの正本は `package.json` で、installed binaryは `vibepro version` で表示します。

| Channel | 現在値 | Authority |
| --- | --- | --- |
| npm `latest` | `0.1.0-beta.0` | 公開registry state |
| npm `beta` | `0.1.0-beta.0` | 公開registry state |
| Repository `main` | beta後のunreleased work | Git commitと `CHANGELOG.md` |
| Manual build | footer / metaのsource commit | deployed build artifact |

## Unreleasedのmanual-visible capability

- 独立review lifecycleとadjudicationを含むrisk-adaptive Gate DAG
- PR作成から監査済みmergeまでのmanaged execution
- CI evidence import、existing PR refresh、canonical audit replay、cost / ROI report
- Journey、UI/UX intake / map、VibePro-native Design System、visual / responsive / a11y evidence、design modernization
- bounded summary / readiness viewと明示的なresponsibility / authority contract

公開betaは `npm install -g vibepro@beta` で明示的に導入できます。installed helpとこのmanualが異なる場合は、実行中binaryのcontractが優先です。境界は[リリースと監査](/ja/guide/release-and-audit)とrepositoryの `CHANGELOG.md` を参照してください。

`0.1.0-alpha.0` ではOSS公開用package形、phase checkpoint、Story / Spec review flow、public discovery documentationを追加しました。
