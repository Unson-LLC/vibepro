---
story_id: story-vibepro-pr-route-gate-dag
title: PR routeをDAGで分類し、route別にPR本文とGateを切り替える
status: active
---

# PR routeをDAGで分類し、route別にPR本文とGateを切り替える

## 背景
VibeProで作られたPRでも、runtime変更、docs-only、mirror sync、release merge、agent policy変更が同じPR本文と同じ最終Gateで扱われると、レビューアは何を確認すべきかを読み直す必要がある。

特にmirror/release系PRでは、元PR・元commit・CI継承・waiver・`.vibepro/` artifactの扱いが本文に出ないままマージ判断へ進むと、VibeProのDAGを通した意味が薄くなる。

## 受け入れ基準
- `vibepro pr prepare` はPR routeを `gate:pr_route_classification` としてGate DAGに出す。
- `vibepro pr prepare` はroute別のPR本文契約を `gate:pr_body_contract` としてGate DAGに出す。
- mirror/release routeではsource traceabilityとCI/waiverのGateが必須になる。
- `.vibepro/` artifactが差分に含まれる場合はartifact policy Gateが必須になる。
- `needs_clean_branch` のscopeではsplit resolution Gateが必須になる。
- PR本文の判断グラフにrouteとbody templateが表示される。

## Anti-pattern
- 全PRを一律のSummary/Test Plan本文で処理する。
- mirror/release PRでsource PRやsource commitを本文に出さない。
- CI失敗やActions budgetを暗黙の例外にする。
- split推奨を出しただけで、解決または明示的な正当化を要求しない。
