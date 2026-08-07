# バージョンとリリースチャネル

source versionの正本は `package.json` で、installed binaryは `vibepro version` で表示します。

| Channel | このrelease後の期待値 | 正本 |
| --- | --- | --- |
| npm `latest` | `0.2.0-beta.3` | liveなnpm registry dist-tag |
| npm `beta` | `0.2.0-beta.3` | liveなnpm registry dist-tag |
| Repository `main` | `0.2.0-beta.3` release source | Git commitと `package.json` |
| Manual build | footer/metaのsource commit | deployed VitePress artifact |

## 0.2.0-beta.3

再構築した最小コアを公開し、npm README、VitePressの入口、generated CLI reference、CIをその契約に揃えます。これはbeta段階のbreaking changeで、再構築時に削除したcommandや自動control-plane機構に互換aliasはありません。

## 0.2.0-beta.3

直前の公開betaは、より広いevidence gateとmanaged workflowを含みます。移行時間が必要な場合だけpinしてください。これは現在の最小コア方針を表しません。

manualとinstalled versionが異なる場合は、installed binaryのhelp出力を優先してください。

公開と開発の時系列は[リリースノート](/ja/releases/)で確認できます。
