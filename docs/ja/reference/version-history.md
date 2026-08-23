# バージョンとリリースチャネル

source versionの正本は `package.json` で、installed binaryは `vibepro version` で表示します。

| Channel | このrelease後の期待値 | 正本 |
| --- | --- | --- |
| npm `latest` | `0.2.0-beta.13` | liveなnpm registry dist-tag |
| npm `beta` | `0.2.0-beta.13` | liveなnpm registry dist-tag |
| Repository `main` | `0.2.0-beta.13` release source | Git commitと `package.json` |
| Manual build | footer/metaのsource commit | deployed VitePress artifact |

表は現在のrelease channelを示します。以下のsectionは公開済みversionの追記専用ledgerで、PRごとの詳細な根拠は[リリースノート](/ja/releases/)に保持します。

## 0.2.0-beta.13

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.12

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.11

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.10

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.9

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.8

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.7

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.6

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.5

この公開版の変更詳細は[リリースノート](/ja/releases/)に記録します。

## 0.2.0-beta.4

Senior Engineering Judgment DAGで、問題の存在を示す証拠と解決方向の証拠を分離します。構造的過剰は `SIMPLIFY`、価値制約は `VALUE`、判断証拠が不足または不明な場合は `VALIDATE` へ分岐します。このbreaking betaでsenior judgment入力schemaは `0.2.0` から `0.3.0` へ更新されました。

## 0.2.0-beta.3

再構築した最小コアを公開し、npm README、VitePressの入口、generated CLI reference、CIをその契約に揃えます。これはbeta段階のbreaking changeで、再構築時に削除したcommandや自動control-plane機構に互換aliasはありません。

## 0.2.0-beta.2

直前の公開betaは、より広いevidence gateとmanaged workflowを含みます。移行時間が必要な場合だけpinしてください。これは現在の最小コア方針を表しません。

manualとinstalled versionが異なる場合は、installed binaryのhelp出力を優先してください。

公開と開発の時系列は[リリースノート](/ja/releases/)で確認できます。
