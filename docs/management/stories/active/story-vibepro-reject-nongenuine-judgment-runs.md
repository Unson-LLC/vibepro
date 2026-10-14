---
story_id: story-vibepro-reject-nongenuine-judgment-runs
title: 手作りの判断runを採択できないようにする
status: active
contract_type: bug_fix
view: dev
period: 2026-10
---

# 手作りの判断runを採択できないようにする

## 背景

vibepro 0.2.0-beta.29 の `adoptJudgmentInput` と `evaluateOperationalJudgmentWorkflow` は、入力JSONの `run_id` を `drafts/<runId>.json`、run ID形式、入力の所在を確認せずに受け取る。`judgment prepare` の `--run-id` は `buildRunId()` を上書きできる。そのため `judgment-20261014080730-operator` のような手作りrunが、`.vibepro/` の外（`../tmp/...`）から brainbase-organization #477、#478、#480、#483 で採択された。

## Story

開発者として、`judgment prepare` が作った判断入力だけを採択・評価したい。

それにより、形式の違うrun ID、receiptのない入力、`.vibepro/` の外の `source_input`、receiptのhashまたはartifactと一致しない入力は拒否され、消費者リポジトリのCIは `vibepro judgment audit` で同じ条件を検出できる。

## Acceptance Criteria

- NGJ-AC-001: `judgment input adopt` と `judgment evaluate` は、`drafts/<runId>.json` が無い、またはその input hash / artifact が採択入力と一致しないとき拒否する。
- NGJ-AC-002: run IDが `^judgment-\d{14}-[0-9a-f]{8}$` に一致しない入力を拒否する。
- NGJ-AC-003: `source_input` が `.vibepro/` の外、またはその外へ解決されるsymlinkのとき拒否する。
- NGJ-AC-004: 公開CLIの `--run-id` は拒否する。`VIBEPRO_ALLOW_JUDGMENT_RUN_ID=1` のテストだけが、形式を満たす `--run-id` を渡せる。
- NGJ-AC-005: `vibepro judgment audit` は `.vibepro/reviews/**/adoptions/current.json` を走査し、上記のどれかに該当すれば終了コード1、該当がなければ0で終わる。採択の `drafts/<runId>.json`、`runs/<runId>.json`、`source_input` がコミット済みツリーに無いときも1で終わり、欠けているファイルのパスを出す。
- NGJ-AC-007: `vibepro init` と `vibepro doctor --fix` が書く `.gitignore` は `.vibepro/*` の後に `!.vibepro/reviews/` を置き、`.vibepro/reviews/**` の drafts、runs、inputs、adoptions、evaluations を追跡できる。`.vibepro/*` と `!.vibepro/config.json` だけの既存リポジトリ（brainbase-organization の形）では doctor が移行文を出し、`--fix` で例外を追記する。その `.gitignore` 変更は各リポジトリの別PRで行う。
- NGJ-AC-006: 拒否理由は、欠落receipt、署名不一致、hash不一致、artifact不一致、run ID形式、`.vibepro/` 外、別 PR、別 head、鍵なし、を区別できる文面で返す。正当な `prepare` の artifact を byte 列のまま `adopt` → `evaluate` することは成功する。prepare 後に byte 列を変えた入力は拒否し、receipt の `input_sha256` は上書きしない。
- NGJ-AC-008: 受領証は `judgment prepare` だけが `VIBEPRO_JUDGMENT_RECEIPT_HMAC_KEY` で HMAC する。鍵は Infisical（https://infisical.unson.jp）に置き、このリポジトリには保存しない。鍵が無い、署名が違う、`VIBEPRO_JUDGMENT_PR_NUMBER`（または `GITHUB_REF` の pull 番号）が違う、`source_head_sha` が違う場合は拒否する。
- NGJ-AC-009: `judgment input adopt` の `--reviewed-by` は `human:<id>` または `agent:<id>` だけを受け、`reviewed_by.kind` を機械的に判定できる。
- NGJ-AC-010: `judgment audit` が終了コード 1 のとき `advisory` は false、`blocking` は true で、表示と JSON が一致する。成功時は `advisory` true、`blocking` false。

## Boundary

- 過去のdraftファイルは削除しない。新しいprepareは直前のcurrent draftを `superseded_at` / `superseded_by` で印づける。
- 問題設定、制約、選択肢は Story に書いてから prepare する。prepare 後に artifact の byte 列を変えて採択することはできない。receipt の `input_sha256` は prepare の値のままにする。
- このStoryの判断入力はDevDirectorが `--reviewed-by DevDirector` で採択する。エージェントは採択しない。
