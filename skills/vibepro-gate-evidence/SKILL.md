---
name: vibepro-gate-evidence
description: Compatibility notice for repositories that still reference VibePro's retired Gate and evidence workflow.
---

# VibePro Gate Evidence

## Purpose

旧Gate／証跡運用が廃止済みであることを示し、過去の参照から証跡収集が再開されるのを防ぐ。

## When to Use

旧Skill名が参照された場合、または利用者が旧Gate挙動の調査を明示した場合だけ使う。通常の実装・レビューでは使わない。

## Process

1. 必要なら旧Gate成果物を読み取り専用の履歴・参考情報として確認する。
2. 製品の完了は、合意済みの受け入れ条件、実際の差分、影響範囲のテスト、通常のCI／レビューで判断する。
3. 未確認は未確認のまま報告し、追加の証跡登録へ変換しない。

## Red Flags

Gateを閉じるための証跡登録、レビュー派遣、head再拘束、waiver作成、PR準備の反復を開始しない。旧Gateの未解決、stale、missingを新しい作業や通常PRの停止条件にしない。

## Common Rationalizations

「旧成果物にmissingがあるから埋める」は理由にならない。旧成果物は現在の完了契約ではない。

## Verification

新しいGate記録やレビュー派遣を作っていないことを確認し、必要な製品検証だけを通常のリポジトリ手順で行う。
