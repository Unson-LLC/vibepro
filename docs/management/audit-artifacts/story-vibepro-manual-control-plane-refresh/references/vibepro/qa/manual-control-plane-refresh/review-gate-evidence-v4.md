# gate_evidence v4

- status: `needs_changes`
- reviewer: `/root/manual_gate_evidence_v4`
- head: `35911f3d5672205045e3134f74ecd00f6ae0904d`

## Summary

現行HEADの検証証跡、生成物、デプロイ防御は概ね十分で、従来findingの大半は解消済み。ただし、Architectureのrollback経路が公開runbookと矛盾している。

## Inspection

HEADとclean状態、strict-head verification、QA要約、生成dist、social/discovery成果物、内部corpus除外、tracked/untracked deploy guard、commit provenance、日英rollback文書、Story・Architecture・Specをread-onlyで照合した。

## Finding

- `medium:rollback-ssot-path-divergence`: `docs/architecture/vibepro-manual-control-plane-refresh.md` はfocused git revertと再deployを正規経路にしている一方、日英runbookはCloudflare PagesのDeployment rollbackを正規経路にしている。ArchitectureとStoryのrollback authorityをPages deployment rollbackへ揃え、再build・strict-head evidence更新が必要。

## Resolved findings

- `gate-evidence-social-image-output-missing`: `docs/.vitepress/dist/assets/vibepro-header.png`が生成され、日英indexのOG/Twitter参照先と一致。
- `gate-evidence-built-surface-contract-gap`: build checker/testがdist、sitemap、social asset、provenance、local path、内部routeを検査。
- `dirty-untracked-regression-evidence-gap`: tracked変更とuntracked sourceの双方をpre-fixで失敗するfixtureとして検証。
- `all-internal-corpus-regression-coverage`: 全internal corpus familyを出力pathとsitemap参照の双方で反復検証。
- `targeted-docs-evidence-freshness`: 対象テスト、docs build、full-suite closureが現HEADへstrict-head binding済み。
- `dirty-deploy-fail-closed-implementation`: build前後cleanliness、HEAD不変性、生成metadata一致を検証してからWranglerを呼ぶ。

## Judgment delta

23/23の対象テスト、162ファイルのbuild contract、全1110テストのclosure、生成画像・metadata・内部corpus除外でpass候補になったが、rollback-sensitiveな文書surface間の判断分岐が残るため`needs_changes`。
