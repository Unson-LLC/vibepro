# CLIリファレンス

> この完全なコマンド一覧は、同じcommitの `vibepro help --language en` にある言語非依存のUsage契約から生成されています。手編集せず、`npm run docs:cli` で更新してください。

実行中のbinaryが正本です。最初に `vibepro version` でpackage版を確認し、`main` のマニュアルを読む場合は[リリースと監査](/ja/guide/release-and-audit)で公開済みpackageとの差を確認してください。

Architecture / Specを確定する前に `story diagnose --phase design-input --run-graphify`、実装またはPR readinessの前に `story diagnose --phase pre-implementation --run-graphify` を実行します。通常の出荷経路は `story diagnose` → Architecture / Spec → 実装 → `verify record` → `review prepare/start/close/record` → `guard check` → `pr prepare` → `pr create` → `verify import-ci` です。`review record --status pass` は `--inspection-summary`、実在する `.vibepro` 外の `--inspection-input`、`--judgment-delta` を必須とします。旧来のassertion-only passは互換受理せずfail-closedになるため、既存automationを移行してください。各引数の完全な契約は以下の生成済みUsageを使ってください。

`review record --strict-head-binding --strict-head-reason <text>` は無条件のCLI overrideではありません。role policyで既に `freshness_mode: strict_head` と `freshness_reason` を明示したroleか、activeなfrozen validation sequenceの `implementation:runtime_contract` `final_review` の場合だけ許可されます。それ以外のstage/roleは明示的なエラーで拒否されます。完全な由来モデルと `pr prepare` の移行警告は[Agent Review](/ja/guide/agent-review)を参照してください。

## 現在のUsage

```text
  vibepro help [command]
  vibepro version
  vibepro --version | -v
  vibepro init [repo] [--story-id <id> --title <title>] [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>] [--language ja|en]
  vibepro config language [repo] --language ja|en
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
  vibepro judgment evaluate [repo] --id <story-id> --input <input.json> [--json]
  vibepro guard check [repo] [--command <cmd>] [--pre-push <remote>] [--pretooluse] [--story-id <id>] [--json]
  vibepro guard install [repo] [--claude] [--json]
  vibepro guard status [repo] [--json]
  vibepro guard uninstall [repo]
  vibepro review prepare [repo] --id <story-id> --stage <stage> [--role <role>] [--roles <csv>] [--json]
  vibepro review violations [repo] --id <story-id> [--json]
  vibepro review record [repo] --id <story-id> --stage <stage> --role <role> --status <pass|needs_changes|block> --summary <text> [--finding <severity:id:detail>] [--finding-disposition <finding-id:accepted|rejected|duplicate|deferred|false_positive[:reason]>] [--resolved-finding <finding-id:ref>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code|human --execution-mode parallel_subagent|manual_review --agent-id <id>] [--agent-thread-id <id>] [--agent-session-id <id>] [--agent-call-id <id>] [--agent-model <name>] [--agent-reasoning-effort low|medium|high] [--agent-cost-tier low|medium|high] [--agent-input-tokens <n>] [--agent-output-tokens <n>] [--agent-total-tokens <n>] [--agent-cost-usd <n>] [--agent-transcript <path>] [--agent-closed] [--agent-close-evidence <ref>] [--reviewer-identity same_session|separate_session|unknown] [--implementation-session-id <id>] [--inspection-summary <text>] [--inspection-evidence <ref>] [--inspection-input <ref>] [--judgment-delta <text>] [--strict-head-binding --strict-head-reason <text>] [--json]
  vibepro review status [repo] --id <story-id> [--stage <stage>] [--all] [--history] [--json]
  vibepro story list [repo] [--all]
  vibepro story add [repo] --id <id> --title <title> [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>]
  vibepro story select [repo] --id <id>
  vibepro story archive [repo] --id <id>
  vibepro story runs [repo] [--id <id>]
  vibepro story status [repo] [--id <id>]
  vibepro story report [repo] [--id <id>]
  vibepro story diagnose [repo] --id <id> [--run-graphify] [--run-id <id>] [--phase design-input|pre-implementation] [--pre-architecture]
  vibepro story derive [repo] [--from-run <run-id>] [--run-graphify] [--from <graphify-out>] [--preset <id>] [--json]
  vibepro story map [repo] [--json]
  vibepro story plan [repo] [--limit <n>] [--json]
  vibepro trace backfill [repo] [--story-id <id>] [--dry-run] [--json]
  vibepro trace declare [repo] --story-id <id> --lifecycle <declared_not_started|unknown> [--reason <text>] [--json]
  vibepro artifacts resolve [repo] --id <story-id> [--feature-slug <slug>] [--json]
  vibepro artifacts migrate [repo] --id <story-id> --dry-run [--feature-slug <slug>] [--json]
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--language ja|en] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--title <title>] [--dry-run] [--language ja|en] [--json]
  vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run] [--story-id <id>]
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
