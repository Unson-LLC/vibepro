---
story_id: story-vibepro-verify-command-test-path-existence-guard
title: verify record/runのコマンドが名指しするtest fileパスの実在を検証する
status: active
view: dev
period: 2026-07
reason: |
  代替案として (a) node --test の "Could not find" 出力を後段でパースする、(b) exit code を信用する、を検討したが、
  node --test は欠損ファイルでも exit 0 を返し、出力パースはランナーごとの表現に依存して壊れやすい。
  コマンド文字列から名指しされた repo 相対 test パスを決定的に解決して実在検証する方式が、
  verify run / verify record / import-ci 経由の全recording pathを1箇所（recordVerificationEvidence）で覆え、
  既存の e2eEvidenceHasExistingTarget と同じ概念の一般化であるため採用。
  互換性: glob・--test-name-pattern・パスを名指ししないコマンド（npm test 等）は対象外なので既存の正しい証跡は影響を受けない。
  ロールバック: ガード関数呼び出し1行を外せば従来挙動に戻る。
  境界: 検証対象はコマンド文字列中の repo 相対 test ファイルパスのみ。実行結果の真正性やテスト内容の妥当性は既存の artifact cross-check の責務。
---

# Story

`vibepro verify run` / `vibepro verify record` は、`node --test test/pr-manager.test.js` のように
リポジトリに存在しない test ファイルを名指しした passing unit record を受理してしまった。
`node --test <missing-file>` は "Could not find" を出力しつつ exit 0 で終わるため、
実行されていないカバレッジが gate DAG 上でクレジットされた
（story-vibepro-owner-gated-budget-override の closure で人手により発見。2名のgate reviewerとclause adjudicatorが見逃した）。

VibePro は、検証コマンドが repo 相対の test パスを名指しする場合
（node --test / npm test -- <paths> / playwright / vitest / jest の明示ファイル引数）、
各パスを解決し、存在しないパスがあれば record を拒否し、欠損パスを名指しして報告すべきである。

## Acceptance Criteria

- passing の verify record / verify run で、コマンドが名指しする repo 相対 test ファイルパスに実在しないものが含まれる場合、record は拒否され、エラーメッセージに欠損パスが列挙される。
- 拒否時、verification-evidence.json は書き込まれない（既存の artifact 矛盾時と同じ挙動）。
- ガードは決定的である: ファイル実在チェックのみで、ランナー出力のパースや推測を行わない。
- `node --test`, `npm test -- <paths>`, `npx playwright test <paths>`, `npx vitest <paths>`, `npx jest <paths>` 形式の明示ファイル引数を対象とする。
- glob パターン（`*` `?` `[`）、`--test-name-pattern` の値、フラグ引数、パスを名指ししないコマンド（`npm test` 等）は対象外で、従来どおり受理される。
- 実在する test パスを名指しした passing record は従来どおり受理される。

## Non Goals

- ランナー出力（"Could not find" 等）のパースによる検知。
- e2e `--target` の実在チェック（`e2eEvidenceHasExistingTarget` として既存）を置き換えること。
- コマンド実行結果の真正性検証（artifact cross-check の責務）。
