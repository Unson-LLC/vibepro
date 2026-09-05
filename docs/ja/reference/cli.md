# CLIリファレンス

> この完全なコマンド一覧は、同じcommitの `vibepro help --language en` にある言語非依存のUsage契約から生成されています。手編集せず、`npm run docs:cli` で更新してください。

実行中のbinaryが正本です。最初に `vibepro version` でpackage版を確認し、`main` のマニュアルを読む場合は[リリースと監査](/ja/guide/release-and-audit)で公開済みpackageとの差を確認してください。

Story・Specと検証結果を確認し、必要に応じて `review prepare` → `review record` → `review status` でレビューを記録します。`pr prepare` は変更と証拠を要約します。旧レビュー段階の設定は追加の出荷条件を作りません。

合格の記録には実在する `.vibepro` 外の `--inspection-input` が必要です。確認対象の内容が変わると記録は古い状態になります。未記録や古い記録だけではPR準備を止めません。具体的な未解決指摘（`needs_changes` / `block`）は解消するまで表示し、PR準備を止めます。

## 現在のUsage

```text
  vibepro help [command]
  vibepro version
  vibepro --version | -v
  vibepro init [repo] [--story-id <id> --title <title>] [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>] [--language ja|en]
  vibepro config language [repo] --language ja|en
  vibepro runtime identity [--json]
  vibepro doctor [repo] [--fix] [--json]
  vibepro status [repo] [--json]
  vibepro workspace status [repo] [--json]
  vibepro store snapshot [repo] --story-id <id> [--json]
  vibepro store hydrate [repo] --story-id <id> [--json]
  vibepro store status [repo] --story-id <id> [--json]
  vibepro skills list [--json]
  vibepro skills install [repo] [--dry-run] [--force] [--json]
  vibepro skills verify [repo] [--json]
  vibepro skills lint [repo] [--json]
  vibepro codex install [repo] [--dry-run] [--force] [--json]
  vibepro codex verify [repo] [--json]
  vibepro harness status [repo] [--json]
  vibepro harness map [repo] [--json]
  vibepro harness learn [repo] --summary <text> [--kind <kind>] [--source <source>] [--evidence <ref>] [--pattern <text>] [--skill-candidate <text>] [--target <surface>] [--json]
  vibepro harness review-learnings [repo] [--json]
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro env graph [repo] [--json] [--no-write]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro verify run [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> [--summary <text>] [--target <path>]... [--scenario <text>]... [--observed <key=value>]... [--timeout-ms <ms>] [--no-progress-deadline-ms <ms>] [--max-output-bytes <bytes>] [--strict-head-binding] [--json] -- <command> [args...]
  vibepro verify record [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> --status <pass|fail|needs_setup> --command <cmd> [--summary <text>] [--artifact <path>] [--target <path>]... [--scenario <text>]... [--observed <key=value>]... [--strict-head-binding] [--json]
  vibepro verify import-ci [repo] --id <story-id> [--pr <number>] [--check <name>=<kind>]... [--coverage <check>=<command>::<test-fingerprint>]... [--json]
  vibepro decision record [repo] --id <story-id> --type <needs_review|noise|waiver|secret_exposure|intake_not_applicable> --summary <text> [--source <gate-or-finding-id>] [--source-status <status>] [--reason <text>] [--artifact <path>] [--reviewer <name>] [--status <open|accepted|rejected|superseded>] [--secret-location <ref> --secret-action <redacted|rotated|revoked|false_positive>] [--from-stdin] [--json]
  vibepro decision status [repo] --id <story-id> [--json]
  vibepro judgment applicability record [repo] --id <story-id> --applicable <yes|no> --reason <text> [--recorded-by <actor>] [--json]  # applicable=yes when an engineering choice is still open (2+ viable options, unverified problem/effect, or unobserved value of a structural addition = a VALUE/SIMPLIFY/VALIDATE decision remains); no only when an adopted Story/Architecture/Spec/plan already fixes the single option. Tenant/authority scope is not this criterion
  vibepro judgment prepare [repo] --id <story-id> [--run-id <id>] [--output <path>] [--json]
  vibepro judgment input adopt [repo] --id <story-id> --input <input.json> --reviewed-by <actor> --authority <source> --summary <text> [--json]
  vibepro judgment evaluate [repo] --id <story-id> --input <adopted-input.json> [--json]
  vibepro judgment status [repo] --id <story-id> [--json]
  vibepro judgment disposition record [repo] --id <story-id> --run <run-id> --human-decision <accepted|modified|rejected> --effect <changed_plan|changed_review_focus|escalated_to_human|no_effect> --summary <text> [--evidence <ref>]... [--recorded-by <actor>] [--json]
  vibepro judgment outcome record [repo] --id <story-id> --run <run-id> --status <confirmed|mixed|falsified|unknown> --summary <text> [--evidence <ref>]... [--observed-outcome <id:observation>]... [--json]
  vibepro judgment pending [repo] [--json]
  vibepro guard check [repo] [--command <cmd>] [--pre-push <remote>] [--pretooluse] [--story-id <id>] [--json]
  vibepro guard install [repo] [--claude] [--json]
  vibepro guard status [repo] [--json]
  vibepro guard uninstall [repo]
  vibepro review prepare [repo] --id <story-id> [--role <role>] [--roles <csv>] [--json]
  vibepro review record [repo] --id <story-id> [--role <role>] --status <pass|needs_changes|block|runtime_failed> [--summary <text>] [--inspection-input <ref>]... [--artifact <path>]... [--from-stdin] [--agent-system <system>] [--agent-id <id>] [--json]
  vibepro review status [repo] --id <story-id> [--json]
  vibepro story list [repo] [--all]
  vibepro story add [repo] --id <id> --title <title> [--contract-type <bug_fix|regression_fix>] [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>]
  vibepro story select [repo] --id <id>
  vibepro story archive [repo] --id <id>
  vibepro story runs [repo] [--id <id>]
  vibepro story status [repo] [--id <id>]
  vibepro story report [repo] [--id <id>]
  vibepro story diagnose [repo] --id <id> [--run-graphify] [--run-id <id>] [--phase design-input|pre-implementation] [--pre-architecture]
  vibepro bug diagnose record [repo] --id <story-id> --node <node-id> --status <passed|failed|not_applicable> [--evidence <ref>]... [--reason <text>] [--path-id <id>] [--analysis <type>]...
  vibepro verify-first [repo] --id <story-id> [--run-graphify]  # deprecated compatibility entry; routes to story diagnose
  vibepro story derive [repo] [--from-run <run-id>] [--run-graphify] [--from <graphify-out>] [--preset <id>] [--json]
  vibepro story map [repo] [--json]
  vibepro story plan [repo] [--limit <n>] [--judgment-applicable <yes|no> --judgment-reason <text> --judgment-actor <actor>] [--judgment-input <reviewed.json> --judgment-reviewed-by <actor> --judgment-authority <source> --judgment-review-summary <text>] [--judgment-human-decision <accepted|modified|rejected> --judgment-effect <effect> --judgment-disposition-summary <text>] [--judgment-outcome-status <confirmed|mixed|falsified|unknown> --judgment-outcome-summary <text> --judgment-evidence <ref> --judgment-observed-outcome <key:value>]... [--json]  # applicable=yes when an engineering choice is still open (2+ viable options, unverified problem/effect, or unobserved value of a structural addition = a VALUE/SIMPLIFY/VALIDATE decision remains); no only when an adopted Story/Architecture/Spec/plan already fixes the single option. Tenant/authority scope is not this criterion
  vibepro trace backfill [repo] [--story-id <id>] [--dry-run] [--json]
  vibepro trace declare [repo] --story-id <id> --lifecycle <declared_not_started|unknown> [--reason <text>] [--json]
  vibepro task bind [repo] --id <story-id> --input <tracked-json> [--json]
  vibepro artifacts resolve [repo] --id <story-id> [--feature-slug <slug>] [--json]
  vibepro artifacts migrate [repo] --id <story-id> --dry-run [--feature-slug <slug>] [--json]
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--language ja|en] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--push-remote <name>] [--repo <owner/name>] [--title <title>] [--dry-run] [--language ja|en] [--json]
  vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run] [--story-id <id>]
  vibepro integration brainbase bind [repo] --id <story-id> --input <handoff.json> [--json]
  vibepro integration brainbase event [repo] --id <story-id> --summary <verified-learning> [--json]
  vibepro integration brainbase status [repo] [--id <story-id>] [--json]
  vibepro integration brainbase doctor [repo] [--id <story-id>] [--json]
  vibepro integration brainbase reconcile [repo] [--json]
  vibepro spec fingerprint [repo] --id <story-id> [--include-instructions] [--json]
  vibepro spec readiness [repo] --id <story-id> [--base <ref>] [--json]
  vibepro spec write [repo] --id <story-id> [--from-stdin] [--input <file>] [--caller <name>] [--draft|--final] [--json]
  vibepro spec show [repo] --id <story-id> [--clause <clause-id>] [--json]
  vibepro spec drift [repo] --id <story-id> [--against <git-ref>] [--json]
  vibepro report fingerprint [repo] --kind <kind> --id <story-id> [--base <ref>] [--task <id>] [--group <id>] [--include-instructions]
  vibepro report write [repo] --kind <kind> --id <story-id> [--from-stdin] [--input <file>] [--caller <name>]
  vibepro report show [repo] --kind <kind> --id <story-id>
```

## ドリフト確認

```bash
npm run docs:cli:check
```
