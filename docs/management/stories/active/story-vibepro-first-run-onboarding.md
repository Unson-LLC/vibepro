---
story_id: story-vibepro-first-run-onboarding
title: VibePro初回オンボーディング導線改善
view: dev
period: 2026-05
architecture_docs:
  reason: 既存CLI/README/HTML表示の説明改善であり、主要アーキテクチャ変更を伴わないため
---

# VibePro初回オンボーディング導線改善

## 背景

初回利用者は、VibeProの診断価値そのものは理解できる一方で、READMEの長さ、`origin/develop` 固定例、graphify/uv準備、`.vibepro/` の意味、生成HTMLの見る順番で迷いやすい。

VibeProは「StoryからArchitecture/Spec/Gateを作り、AIに安心して開発を任せるための道標」を提供するプロダクトなので、初回導線で道標の意味が伝わらない状態は価値伝達の阻害になる。

## 方針

- 内部JSON schemaや機械可読キーは英語のまま維持する。
- 人間が読むCLI出力、README、HTML見出し、Next Actionを `output.language` に沿って分かりやすくする。
- `origin/develop` のような特定リポジトリ前提の例を避け、base branchは実リポジトリごとに選ぶものとして案内する。
- graphifyは必須ではなく、影響範囲調査の精度を上げる推奨依存として説明する。

## 受け入れ基準

- [x] READMEの初回フローから `origin/develop` 固定例がなくなり、`<base-branch>` と候補説明になっている
- [x] README冒頭に、5分で使うための最短手順、見る成果物、AIエージェントへ渡すものがある
- [x] graphify/uv 未準備時に、必須ではないが推奨であることと、導入コマンドが分かる
- [x] `pr-prepare.html` の主要見出しが `ja/en` に応じて切り替わる
- [x] Requirement Consistency が `not_applicable` の時、何を足せば有効になるかが日本語/英語で分かる
- [x] READMEが英語版 `README.md` と日本語版 `README.ja.md` に分かれ、相互に言語切替リンクを持つ
- [x] READMEがOSSで一般的な概要、Quick Start、Features、Workflows、Documentation、License構成になっている
- [x] 既存の `node --test` が通る

## タスク

1. README/base branch導線
   - `origin/develop` 固定例を `<base-branch>` へ置換する
   - `origin/main`, `main`, `origin/develop`, `develop` などリポジトリ既定branchを選ぶ説明を追加する
   - 初回ユーザー向けの「5分で使う」セクションを追加する

2. graphify/uv準備案内
   - graphify未導入エラーに、任意/推奨の位置づけを出す
   - READMEで「graphifyなしでも進める」「精度を上げるなら導入する」を明示する

3. HTML主要見出しの言語切替
   - PR prepare HTMLの主要見出しを `output.language` に沿って日本語/英語にする
   - 既存のmachine-readable JSONは変えない

4. OSS向けREADME多言語化
   - `README.md` を英語のOSS入口にする
   - `README.ja.md` を日本語のOSS入口にする
   - GitHub上で使えるbadge/link形式の言語切替を両方に置く
   - npm packageに `README.ja.md` も含める
