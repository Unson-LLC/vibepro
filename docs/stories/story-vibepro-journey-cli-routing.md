---
story_id: story-vibepro-journey-cli-routing
title: vibepro journey derive / handoff / curate を CLI から実行できるようにする
status: active
view: dev
---

# Story: vibepro journey derive / handoff / curate を CLI から実行できるようにする

## Problem Frame

- 0.2.0-beta.31 の `src/journey-map.js` には derive / handoff / curate の実装があり、`story-manager.js` の next actions も `vibepro journey derive|handoff|curate` を案内している。
- しかし `src/cli.js` は `journey` をルーティングしておらず、`npx vibepro@0.2.0-beta.31 journey derive` は `Unknown command: journey` で終わる（374cbf6d の Slice 1 で CLI ブロックが削除された後、2026-10-15 の f2a59e3f / c9ba9488 で journey-map.js 側だけが再び拡張された）。
- このため Journey 9（brainbase-organization#516）の curate を CLI から実行できない。

## Constraints

- 追加するのは CLI のルーティング・help・エラーだけ。journey-map.js / journey-scope.js の挙動は変えない。
- curate の `--input <judgments.json|yaml>` を生成する仕組みはこの Story の範囲外（judgments.json の手書きは禁止のまま）。
- `docs/management/rebuild-plan.md` の Slice 1 は journey-map を削除対象に挙げている。この Story はその計画を覆す判断ではなく、現に残っているコードへの到達経路を戻すだけで、存続の判断はレビューに委ねる。
- 公開（beta.32）には佐藤さんの承認が要る。この PR ではマージ・公開をしない。

## Options

1. **CLI に `journey derive|handoff|curate` を戻す（採用）**: 旧ブロックと同じ引数（`--id` / `--input` / `--output` / `--json`）で、help（en/ja）・CLI reference・smoke とルーティング/エラーのテストを付ける。`map` / `status` は今回の要求外なので戻さない。
2. 別 bin / スクリプトから journey-map.js を呼ぶ: CLI 契約と help・reference から外れ、smoke の対象にもならないので不採用。
3. 何もしない（Slice 1 の方針どおり journey-map を削除する）: Journey 9 の curate が進められないため、この Story では採らない。削除するかどうかは別途の判断にする。

## 受け入れ条件

- [ ] `vibepro journey derive|handoff|curate` が journey-map.js の関数に届く。
- [ ] `vibepro journey` / `--help` で help を出し、未知の subcommand は `Unknown journey command` で exit 1。
- [ ] curate は `--input` が無いと `journey curate requires --input <judgments.json|yaml>` で exit 1、context pack が無いと derive を案内して exit 1。
- [ ] help（en/ja）と docs/reference の CLI reference に 3 コマンドが載る。
