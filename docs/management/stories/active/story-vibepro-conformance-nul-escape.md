---
story_id: story-vibepro-conformance-nul-escape
title: architecture-conformance.jsの生NULバイトを\0エスケープに置換しテキストファイル性を回復する
status: active
view: dev
period: 2026-07
reason: |
  代替案の比較: (a) 生NULをスペースに置換する案は動作は同じだが、content-binding.jsで確立済みの「合成キー区切りにNULを使う」衝突回避意図を失う。(b) \0エスケープ置換はランタイム文字列が完全に同一のままファイルをASCIIテキストに戻すため、意図と挙動の両方を保存する。(b)を採用。
  互換性: matchedPatternsはassignFilesToModules内部のローカルSetで、add/hasが対称に同じ式を使うのみ。シリアライズ・永続化経路はなく、\0エスケープ置換で生成される文字列はバイト単位で従来と同一のため外部互換性への影響はゼロ。
  ロールバック: 2バイトの表現変更のみで、revert一発で戻せる。
  境界: src/architecture-conformance.jsの2箇所のみ。テスト・他モジュールのロジックには触れない。
---

# architecture-conformance.jsの生NULバイトを\0エスケープに置換しテキストファイル性を回復する

## 背景

`src/architecture-conformance.js` の `assignFilesToModules` にあるテンプレートリテラル2箇所（`matchedPatterns.add(...)` と `matchedPatterns.has(...)` の合成キー）に、エスケープシーケンス `\0` ではなく **生の0x00バイト** が埋め込まれている。導入コミットは 419d0a4c（2026-07-22, target architecture conformance導入）で、ファイル誕生時から存在する。

NUL区切り自体は `src/content-binding.js:174` の `` `${file.path}\0${file.sha256}\0${file.size}` `` と同じ、合成キーの衝突回避として意図的なパターンである。しかし生バイトで埋め込まれた結果:

- `file src/architecture-conformance.js` が "data"（バイナリ）と判定される
- `-a` なしの `grep` がこのファイルをバイナリ扱いし、マッチを黙って返さない
- grepベースのgate・tooling・レビューがこのファイルの実コンテンツを見落とすリスクがある

## 受け入れ条件

1. `src/architecture-conformance.js` に0x00バイトが存在しない（バイトスキャンで0件）。
2. 2箇所の合成キーは `\0` エスケープシーケンスで表現され、ランタイムの文字列値は変更前とバイト単位で同一である。
3. `node --test test/architecture-conformance.test.js` が全件パスする。
4. `grep -c matchedPatterns src/architecture-conformance.js` がバイナリ警告なしにマッチを返す（テキストファイル性の回復）。

## スコープ外

- assignFilesToModulesのロジック変更
- 他ファイルへのNUL混入検査の自動gate化（必要なら別Story）
