---
story_id: story-vibepro-codebase-memory-skill
title: codebase-memory-mcpをVibePro同梱skillとして運用に接続する
status: active
parent_design: vibepro-codebase-memory-skill
source:
  type: user_feedback
  id: codebase-memory-skill
architecture_docs:
  - docs/architecture/vibepro-codebase-memory-skill.md
spec_docs:
  - docs/specs/vibepro-codebase-memory-skill.md
---

# codebase-memory-mcpをVibePro同梱skillとして運用に接続する

VibeProは `codebase-memory-mcp` を任意のcode topology providerとして `pr prepare` に接続している。
しかし、エージェントがいつ `list_projects`、`index_repository`、`detect_changes`、`search_graph`、`trace_path` を使い、結果をVibeProのGate evidenceへどう戻すかは、VibePro同梱skillsに明示されていない。

CLIだけが入っていても、エージェントが毎回impact contextを使うとは限らない。
VibeProは、上流 `codebase-memory-mcp` skillをコピーするのではなく、VibeProのStory / Gate DAG / PR evidenceへ接続する薄い統合skillを配布する。

## Acceptance Criteria

- `vibepro skills list` に `vibepro-codebase-memory` が表示される。
- `vibepro skills install <repo>` は `.claude/skills/vibepro-codebase-memory/SKILL.md` を導入できる。
- `vibepro skills lint <repo>` は新skillをVibePro Agent Skill Contractに照らして検査し、passする。
- `vibepro-workflow` はimpact-sensitive workでGraphifyだけでなく `codebase-memory-mcp` を使う順序を示す。
- READMEとCloudflare manualは、codebase-memory contextを一貫して使うにはVibePro同梱skillを入れることを説明する。
- 新skillは `code_topology_impact_scope` を正しさの証明として扱わない境界を明示する。
