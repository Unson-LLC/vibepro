---
story_id: story-vibepro-graphify-path-diagnostics
title: GraphifyがPATH外にある時の診断を正確にする
status: active
source:
  type: github_issue
  id: 156
architecture_docs:
  - docs/architecture/vibepro-graphify-path-diagnostics.md
spec_docs:
  - docs/specs/vibepro-graphify-path-diagnostics.md
---

# Story

Graphify自体はインストール済みでも、CodexやCIの実行環境で `~/.local/bin` が `PATH` に入っていない場合がある。

現状のVibeProは `spawn('graphify')` が `ENOENT` を返すと「graphify is not installed」と断定するため、実際にはPATH設定だけの問題でも、利用者に不要な再インストールを促してしまう。

VibeProはGraphifyを任意の外部CLIとして扱い、未検出時には「未インストール」ではなく「現在のPATHから見つからない」と診断し、よくある候補パスに実体がある場合はPATH修正を提示する。

## Acceptance Criteria

- `spawn('graphify')` が `ENOENT` の時、VibeProは「未インストール」と断定せず、現在のPATHから見つからないことを表示する。
- `HOME/.local/bin/graphify` などの候補パスに実行可能ファイルがある場合、候補パスと `PATH="$HOME/.local/bin:$PATH"` 形式の回避策を表示する。
- 候補パスに実体がない場合だけ、従来通り `uv tool install graphifyy` のinstall案内を表示する。
- `graph --run-graphify`、`story derive --run-graphify`、`story diagnose --run-graphify` は同じGraphify adapterを通るため、既存の成功時import・cleanup・manifest記録を壊さない。

## Tasks

- [ ] Graphify adapterのENOENTメッセージをPATH診断型にする。
- [ ] PATH外候補あり/なしの回帰テストを追加する。
- [ ] VibePro PR GateでStory/Spec/Architecture/Verificationを接続する。
