# Release risk review

- status: needs_changes
- agent: /root/docs_release_risk
- head: 8fc53f0ee91aca631d1d0b7a5874e591bff533b9

CLI参照生成とcurrent-head検証は妥当。ただし公開distに内部運用レポート2ページが残り、Hero/OG画像が欠落し、dirty deploy時はsource commitを誤表示できる。

## Findings

- high `release-risk-public-output-leak`: `/reference/gate-tuning/2026-07` と `/reference/vibepro-ui-journey-e2e-dogfood` を公開対象から除外する。
- high `release-risk-missing-social-hero-asset`: `/assets/vibepro-header.png` を生成distへ含める。
- high `release-risk-dirty-source-provenance`: dirty buildをfail-closedにするかdirty状態を明示する。
- medium `path-surface-built-artifact-coverage`: dist/sitemap/meta/static assetのnegative/positive assertionを追加する。

## Judgment delta

docs-onlyかつテスト成功から低リスクと見込んだが、実配布物の列挙で3つの出荷欠陥が判明したためneeds_changesへ変更。
