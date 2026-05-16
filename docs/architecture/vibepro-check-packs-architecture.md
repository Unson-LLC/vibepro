---
title: "VibePro Check Packs Architecture"
status: draft
created_at: 2026-05-16
updated_at: 2026-05-16
related_stories:
  - story-vibepro-check-packs
---

# VibePro Check Packs Architecture

## Intent

VibeProの診断器を、内部scanner名ではなくユーザーの目的別パッケージとして実行できるようにする。

`diagnose` は従来どおり全体診断であり、`check` は「UI」「security」「performance」「PR readiness」のような目的語に対応する軽量な編成レイヤーである。

## Boundary

| Boundary | Responsibility | Must Not Do |
|----------|----------------|-------------|
| Check Pack CLI | pack名を受け取り、必要な診断器を編成する | scannerの内部名をユーザーに前提知識として要求する |
| Scanner | 既存の静的診断・計測・PR準備を実行する | packごとの意味判断を持ちすぎる |
| Check Evidence | pack単位のJSON/Markdown証跡を保存する | 生ログや巨大な実行出力を無制限に保存する |
| Gate Aggregation | pass / needs_review / needs_setup / failへ集約する | scannerごとの細部を隠して原因不明にする |

## Pack Catalog

| Pack | Purpose | Checks |
|------|---------|--------|
| `ui` | UI体験と操作信頼性を見る | component style, flow design, terminal/file viewer contracts |
| `security` | 公開前のセキュリティ境界を見る | secrets, XSS, API boundary, authorization order |
| `performance` | 重さと運用コストを見る | DB access, local dev, duplicate query shapes, optional measurement |
| `architecture` | 境界と責務分離を見る | architecture profile, API boundary, DB access, responsibility hotspots |
| `pr-readiness` | PR可能性を見る | PR prepare, Gate DAG, split plan |
| `launch-readiness` | リリース前の主要リスクを見る | security + ui + performance static checks |
| `all` | 全体を広く見る | implemented check set |

## Evidence Layout

```text
.vibepro/checks/<pack>/<run-id>/
  check.json
  check.md
```

Manifest:

```json
{
  "latest_check_run": "<run-id>",
  "latest_check_run_by_pack": {
    "ui": "<run-id>"
  },
  "check_runs": []
}
```

## Status Policy

- `fail`: block相当のリスクがある
- `needs_setup`: pack実行に必要な入力や環境が足りない
- `needs_review`: review相当の候補がある
- `pass`: block/review候補がなく、実行対象が成立している
