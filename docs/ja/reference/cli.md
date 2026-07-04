# CLIリファレンス

インストール済みバージョンの完全な一覧は `vibepro help` を実行してください。

```bash
vibepro help [command] [--language ja|en]
vibepro version
vibepro doctor [repo]
vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
vibepro story list [repo]
vibepro story derive [repo] [--run-graphify] [--json]
vibepro story diagnose [repo] --id <story-id> [--run-graphify] [--phase design-input|pre-implementation] [--pre-architecture]
vibepro check pr-readiness [repo] --story-id <story-id> --base <base-branch>
vibepro architecture readiness [repo] --id <story-id> --base <base-branch>
vibepro architecture write [repo] --id <story-id> --draft|--final
vibepro pr prepare [repo] --id <story-id>
vibepro review status [repo] --id <story-id>
vibepro verify record [repo] --id <story-id> --command "<command>" --status passed
vibepro decision status [repo] --id <story-id>
```

`codebase-memory-mcp` はVibeProコマンドとしては露出しません。binaryが `PATH` 上にある場合、`pr prepare` が自動で呼びます。
