---
story_id: story-vibepro-test-tmpdir-fixture-cleanup
title: テストスイートが$TMPDIRに残すmkdtemp fixtureのクリーンアップ機構
status: active
reason: >-
  代替案: (a) 全mkdtemp呼び出し箇所(127ファイル・数百箇所)に個別のt.after()/finally
  rmを追加する案は変更面積が過大で、新規テストが同じ漏れを再導入するのを防げない。
  (b) npm testスクリプトに--importでグローバルsetupを差す案は
  `node --test test/<file>.test.js` の単発実行を保護できない。
  採用案はside-effect import 1行のscratch TMPDIR隔離ヘルパー: プロセス起動時に
  os.tmpdir()配下へ専用scratch rootを作りprocess.env.TMPDIRを差し替え、
  process exitで再帰削除する。os.tmpdir()は呼び出しごとにTMPDIRを読む(Node実測済)ため、
  テストヘルパー経由・src本体経由・子プロセス経由のmkdtempすべてがscratch rootに閉じる。
  互換性: fixtureパスは従来どおりos.tmpdir()配下であり、テスト本体のコード変更は
  import 1行のみ。個別テストの挙動・パス前提は変えない。
  rollback: import行とヘルパーファイルを削除すれば従来挙動に完全に戻る。
  boundary: src本体のmkdtempコールサイトのセマンティクスは変更しない
  (テストプロセス内で作られる分はTMPDIR差し替えで自動的に隔離される)。
  SIGKILL等でexitフックが走らないケースは、ヘルパーが起動時に24時間以上前の
  自前prefixのscratch rootを掃除する自己回復で補う。
---

# テストスイートが$TMPDIRに残すmkdtemp fixtureのクリーンアップ機構

## 背景 / 問題

VibeProのテストスイートはmacOSの`$TMPDIR`(`/var/folders/.../T`)に
`mkdtemp`でfixtureディレクトリ(`vibepro-*`, `story-vibepro-*`等のprefix)を作るが、
削除せず残す。2026-08-02時点で88,778個が蓄積し、rootボリューム残2.2Giまで
枯渇してENOSPCでテストが43/92 failした。

- `test/` 配下123ファイル + `src/` 4ファイルがmkdtempを使用し、prefixは約400種。
- `test/vibepro-cli.test.js` の `makeRepo` / `makeGitRepoWithStory` 等のヘルパーが
  最大の発生源だが、src側(`pr-manager.js`のgate-check-snapshot、
  `execution-state.js`のlinked-artifacts等)がテストプロセス内で作る分も漏れる。

## ユーザーストーリー

VibePro開発者として、テストスイートを何回実行してもホストの一時領域が
fixtureで枯渇しないでほしい。ENOSPC起因の偽の大量テスト失敗を二度と踏みたくない。

## 受け入れ基準

- AC1: mkdtempを使う全テストファイルがscratch隔離ヘルパーをimportし、テストプロセス正常終了時にそのプロセスが作ったfixtureディレクトリがホストの実$TMPDIR直下に残らない。
- AC2: 隔離はテスト内で呼ばれるsrc本体のmkdtempと、テストがspawnする子プロセス(git等)にも及ぶ(環境変数継承で保証)。
- AC3: 回帰ガード: mkdtemp/mkdtempSyncまたはtmpdir()/os.tmpdir()を参照するテストファイルがヘルパーをimportしていない場合に失敗するconformanceテストが存在する。
- AC4: クラッシュ残骸の自己回復: 24時間以上前のscratch root残骸をヘルパー起動時に掃除する。
- AC5: 既存テストスイートが引き続き全件パスする。

## スコープ外

- src本体のmkdtempコールサイト自体へのfinallyクリーンアップ追加
  (本番実行時の残骸は別Storyで扱う)。
- 蓄積済みfixtureの一括削除(運用作業として本Storyと同時に実施するがコード変更外)。
