# Gate evidence review

- status: needs_changes
- agent: /root/docs_gate_evidence
- head: 8fc53f0ee91aca631d1d0b7a5874e591bff533b9

現在HEADへの証跡bindingとCLI・公開境界の主要検証は良好。ただし `/assets/vibepro-header.png` が生成成果物に存在せず、HeroとOG/Twitter画像が404になる。生成物を対象にした回帰検査も不足している。

## Findings

- high `gate-evidence-social-image-output-missing`: `docs/.vitepress/dist/assets/vibepro-header.png` が存在しない。
- medium `gate-evidence-built-surface-contract-gap`: source設定だけでなくdist、sitemap、static asset、source metadataを検査する必要がある。

## Judgment delta

13/13 testsとdocs build成功からpass候補だったが、生成HTMLの画像参照先まで追跡すると404になるためneeds_changesへ変更。
