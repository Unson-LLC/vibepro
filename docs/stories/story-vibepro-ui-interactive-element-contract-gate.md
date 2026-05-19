---
story_id: story-vibepro-ui-interactive-element-contract-gate
title: UI操作可能要素の契約診断
view: dev
period: 2026-05
architecture_docs:
  reason: 既存flow-design scannerとUI check packの汎用診断強化であり、新しいrunner基盤を追加しないため
---

# UI操作可能要素の契約診断

## 背景

Story E2Eは主要導線の登録、保存、表示確認には効くが、画面上のすべての「押せそうなUI」を網羅するとは限らない。

その結果、実装途中の「音声入力」「AI要約」「詳細を見る」などが通常ボタンと同じ見た目で残り、ユーザー視点では押しても何も起きないsilent noopになる。これはE2Eの有無ではなく、E2E粒度とVibePro Gate設計の不足である。

## 方針

- `vibepro check ui` の `flow_design` に interactive element contract を追加する。
- クリック可能に見えるUI要素は、保存、表示変化、画面遷移、scroll/focus、disabled、準備中表示のいずれかに分類できる必要がある。
- 静的検査では JSX の `button`、`a`、`role="button"`、button/action系class、Button/Link/Action系コンポーネントを棚卸しする。
- `onClick` がある場合でも、handlerが `console.log`、TODO、placeholder、空実装のみなら契約不足として扱う。
- 明示的な `disabled`、`aria-disabled`、または「準備中」「未実装」「coming soon」表示は未実装状態として許容する。
- 主要Story E2Eとは別に、画面単位の「押せそうなUIの反応」確認をGate判断へ持ち込む。
- 過検知を避けるため、`onClick` inline handler、親 `Link`、native `summary/details`、`label htmlFor`、保存完了などの状態表示テキストは操作契約あり、または非クリック表示として分類する。

## 受け入れ基準

- [x] `scanFlowDesign` が `interactive_contract_hits` を出す
- [x] handlerがユーザー可視の効果を持たないクリック可能UIを検出する
- [x] `onClick` / `href` / `submit` / `disabled` / 準備中表示がないクリック可能UIを検出する
- [x] `vibepro check ui` が interactive element contract 違反を `needs_review` にする
- [x] 診断 finding に「クリック可能に見えるUIに操作契約がない候補」を出す
- [x] `=>` を含む JSX handler をタグ終端と誤認しない
- [x] 親 `Link` に包まれた `Button`、native `summary/details`、`label htmlFor`、状態表示テキストを過検知しない
