# 基本概念

VibeProは、意図、コード上の現実、検証証跡、リリース判断を分けて扱います。

| 概念 | 役割 |
| --- | --- |
| Story | なぜその作業を行うのか、どの利用者・運用者の結果を変えるのか |
| Architecture | 設計境界、トレードオフ、影響面 |
| Spec | 検証可能な受け入れ条件と不変条件 |
| Gate DAG | PR作成またはマージ前に必要な確認項目 |
| Evidence | この変更に対する現在の証明artifact |
| Impact Context | どこを読むべきかを決める任意のコード構造文脈 |

Impact ContextはGraphify artifactまたは `codebase-memory-mcp` から来ます。調査範囲を狭める材料ですが、runtime correctness、security、rollback safety、UX quality、release readinessの証明にはなりません。
