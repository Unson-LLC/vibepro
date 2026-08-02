---
story_id: story-vibepro-profiler-file-walk-stack-overflow
title: architecture-profiler のファイル走査を反復処理化し、大規模treeでの "Maximum call stack size exceeded" を解消する
status: active
view: dev
period: 2026-08
reason: >-
  代替案は (a) --stack-size を上げる運用回避、(b) 走査対象から .claude 等を追加除外、(c) 走査の反復処理化。
  (a) は根本原因（spread引数数がV8上限を超える）を隠すだけで規模拡大で再発する。(b) はプロファイル対象の
  意味論を変えるため別Storyとする。(c) を採用: diagnosis 生成パス上の各walker関数を明示キューによる
  反復走査＋単一アキュムレータへ書き換える。各関数の返り値の型・要素（absolutePath/relativePath、
  拡張子/1MB超スキップ、IGNORED_DIRS除外）は不変で後方互換。ロールバックは各関数を旧再帰実装へ戻すだけで
  呼び出し側に影響しない。境界は各scannerモジュール内のwalker関数のみで、diagnostic-engine 本体は無変更。
---

# architecture-profiler のファイル走査を反復処理化する

## 背景

`vibepro story diagnose <repo> --id <id> --run-graphify` が、graphify import 直後の diagnosis 生成
（`runDiagnosis` → `buildEvidence` → `profileArchitecture` → `collectFiles`）で
`Maximum call stack size exceeded` により失敗する。

実測（/Users/ksato/workspace/repos/vibepro 本体checkout, 2026-08-02）:

- 走査対象は 134,431 ファイル、最大ディレクトリ深さは 13。
- 原因は再帰の深さではなく、`files.push(...await collectFiles(root, absolutePath))` 型の
  spread引数渡しが `.claude/` 配下の約127,000要素を一度に引数として渡し、V8 の引数上限
  （スタックサイズ比例）を超えること。
- 同型の再帰walkerは diagnosis 生成パス上の 8 モジュールに複製されている:
  architecture-profiler / network-contract-scanner / database-access-scanner / code-quality-scanner /
  static-site-scanner / component-style-scanner / flow-design-scanner / gesture-interaction-scanner。
  1つ目（architecture-profiler）だけ直しても次のwalker（network-contract-scanner）で同一エラーが
  再発することを実測済みのため、diagnosis 生成パス上の全walkerを本Storyの対象とする。
- `node --stack-size=16000` で完走するのはこの上限が引き上がるためで、根本解決ではない。
- 現行コードの exit code は 1（0 ではない）が、出力は bare message のみでスタックが出ない。

## 受け入れ条件

- AC1: diagnosis 生成パス上の全ディレクトリwalker（上記8モジュール）が再帰・spread引数渡しを使わず、
  明示キュー＋単一アキュムレータで走査する。各walkerの走査結果（relativePath集合、拡張子/1MB超スキップ、
  IGNORED_DIRS除外、flow-designのENOENT/ENOTDIR許容）は旧実装と同一。 <!-- ac:AC1 -->
- AC2: サブディレクトリ1つに大量ファイル（spread上限相当）を持つtreeでも、デフォルトスタックの Node で
  `profileArchitecture` が RangeError を出さず完走する（縮小スタックの子プロセスで旧実装がfailし
  新実装がpassすることを回帰テストで固定する）。 <!-- ac:AC2 -->
- AC3: 実障害環境（vibepro本体checkout, 134k files）で `story diagnose --id <id> --run-graphify` が
  `--stack-size` なしで完走する。 <!-- ac:AC3 -->

## スコープ外

- `.claude/worktrees` / `.vibepro-store` を profiler の除外対象へ追加する意味論変更（別Storyで扱う）。
- CLI トップレベルの error 表示改善（現行でも non-zero exit しており、根本原因を除去するため本Storyでは扱わない）。
