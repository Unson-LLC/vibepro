# 戦略

## vibe codingで特に多い言語・技術スタック

1位：JavaScript / TypeScript（圧倒的）
2位：Python
3位：HTML + CSS + 少量のJS
4位：Ruby（Rails）
5位：Go

## vibe codingで特に多い形

静的フロント（HTML/JS）
フロント + 軽いAPI（Node / Python）
DBなし or 超簡易DB

## vibe coderが考えていない部分

セキュリティ
公開範囲
秘密情報
運用

ここを 型（テンプレ）として与える

## 静的フロントに寄せる方法

要件としてOKなら、DBをやめてローカル保存（LocalStorage/IndexedDB）にする
フォーム送信は Google Forms / Notion Forms / Airtable 等に逃がす（自前APIを消す）

認証があると静的フロントは厳しいか
 　clerkとか？

## first step

まずは、静的サイトを対象にサービス化してみる
ベースを作成

## next steps  

静的サイト + 外部API  
vite + React.js(SPA)  
Next.js
など対応範囲を増やしていく  