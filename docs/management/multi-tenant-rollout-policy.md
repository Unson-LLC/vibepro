# マルチテナント契約の段階導入方針

## 結論

導入はfixture、advisory、downstream採用の3段階で行う。段階を進める判断と、実環境で安全が確認できたという判断を分ける。

| 段階 | 責任者 | 開始条件 | 停止条件 | rollback条件 |
|---|---|---|---|---|
| Phase 1: fixture | VibePro保守担当 | Contract、validator、positive/negative fixtureが同じschemaで実行可能 | positive fixtureが`ready`でない、negative fixtureを検出できない、既存回帰が失敗 | 新しいSpec検証とPR投影を外し、非適用Storyの従来動作へ戻す |
| Phase 2: advisory | VibePro保守担当と導入担当 | Phase 1通過、集計項目と判断担当が確定 | false negative候補、critical scannerの検査不能、既存Storyへの継続的誤発火 | 必須化せずadvisoryを停止し、findingとfixtureを修正する |
| Phase 3: downstream | downstream保守担当 | Phase 2の誤検知・見逃し候補をレビュー済み、対象Storyと実行環境が特定済み | tenant identity、接続、credential、state、receiptのいずれかが未確認または越境候補を検出 | downstreamの契約採用を戻し、個別Storyをblockerとして維持する |

## advisory集計

`summarizeMultiTenantAdvisoryRun`は次を混ぜずに集計する。

- total、applicable
- pass
- needs_review
- inconclusive
- not_applicable
- false positive候補
- false negative候補

`needs_review`と`inconclusive`はpassではない。false positive/negative候補は件数を0へ丸めず、人がStoryとfindingを確認する。

## 証拠境界

- HTTP 200は到達可能性の証拠であり、tenant resolutionやstate分離の証拠ではない。
- 認証成功は呼出主体の認証証拠であり、tenant別authorizationの証拠ではない。
- secret bindingの存在は設定証拠であり、正しいtenant credentialが選択された証拠ではない。
- CI成功とfixture成功はVibePro契約の回帰証拠であり、downstream実環境の成功証拠ではない。
- downstreamはtenant identity、接続先、credential scope、state partition、receiptを同一Storyのreadbackとして個別確認する。

## rollback rehearsal

Phase 1/2のrollbackは、`multi_tenancy`を持たない非適用Specが従来どおり検証でき、PR準備へ専用ビューを要求しない回帰テストで確認する。Phase 3はdownstream固有の設定・データをこのリポジトリから変更せず、別Storyに復旧手順とoperator actionを記録する。

## 未確認の扱い

downstream実環境はこの文書とfixtureだけでは未確認である。製品固有不具合、実機readback、後続改善はVibeProの5 Storyへ混ぜず、別Story候補またはblockerとして残す。
