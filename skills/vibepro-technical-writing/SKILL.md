---
name: vibepro-technical-writing
description: VibePro の技術ドキュメント（docs/、README、skills/ の本文）を書く・書き直す時に使う。構成は pstack の technical-writing（Diátaxis）に従い、日本語の文は同梱の yomiyasu で推敲し、数値・否定・主語が変わっていないことを必ず確かめる。コード、設定、CHANGELOG の自動生成部分には使わない。
---

# VibePro technical writing

技術ドキュメントを書く手順です。既存の pstack の設定はそのまま使い、このスキルは VibePro 固有の手順だけを足します。

## 1. 構成を決める（pstack technical-writing）

pstack の `/technical-writing` が使える環境では、先にそれを読みます。使えない環境では、次の要点に従います。

- 1文書に1つの型を選びます。型は Diátaxis の4つです。
  - tutorial: 手を動かして学ぶ。各手順で見える結果を書く。
  - how-to: 目的を達成する手順。背景は書かずにリンクする。
  - reference: 調べるための事実。指示や意見を書かない。
  - explanation: なぜそうなっているか。設計判断、制約、代わりの案を書く。
- 型を混ぜません。混ざったら文書を分けてリンクします。
- 見出しには要点を書きます。コマンド、ファイル、フラグは実際の名前で書きます。
- 文書の冒頭に型を書く必要はありません。PR 本文に「型: explanation」のように1行書きます。

## 2. 日本語を推敲する（yomiyasu）

日本語の本文は、構成を決めて書いたあとに `third_party/yomiyasu/SKILL.md`（yomiyasu v2.2.2、MIT）で推敲します。このスキルから使うときは、yomiyasu を名前で頼まれたものとして扱います。

- 書き直す前の原文を `/tmp` などリポジトリの外に写してから直します。
- `--doc-type` は、reference と how-to なら `manual`、tutorial と explanation なら `article` を使います。
- 見出しの数と順は変えません。構成を変えたいときは、推敲の前に 1. でやり直します。

## 3. 必須の確認（数値・否定・主語）

書き直したら、次のコマンドを必ず実行します。終了コードが 0 でなければ、PR に出しません。

```bash
scripts/docs-ja-check.sh <原文の写し> <書き直した文書> [manual|article]
```

このスクリプトは次の2つを実行します。

1. `python3 third_party/yomiyasu/scripts/yomiyasu_diff.py 原文 最終稿 --fail-on=meaning-risk`
   数値、否定、主語と目的語の入れ替え（「が」「を」など）、文の種類、確度の変化があると終了コード 1 で止まります。
2. `python3 third_party/yomiyasu/scripts/yomiyasu_check.py run --source 原文 --final 最終稿 --doc-type 種類`
   lint と diff をまとめて実行し、記録を残します。出力は最後まで読みます。

道具は主語の抜けを見落とすことがあります。そのため、主語が書かれた文が書き直したあとも同じ主語を持つことを、全文差分を見て人か別のモデルが確かめます。結果は PR 本文に「数値・否定・主語: 変化なし（docs-ja-check.sh exit 0、差分を目視）」のように書きます。

意図して数値や否定を変えたとき（事実の誤りを直したときなど）は、その行と理由を PR 本文に書きます。

## 4. PR に書くこと

- 選んだ型（tutorial、how-to、reference、explanation のどれか）
- `scripts/docs-ja-check.sh` の終了コードと、`yomiyasu-check:` で始まる状態の行
- 変えたところ（5点まで）
