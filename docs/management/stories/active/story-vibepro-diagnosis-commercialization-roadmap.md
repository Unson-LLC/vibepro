---
story_id: story-vibepro-diagnosis-commercialization-roadmap
title: "M1: VibePro 診断→商用化ロードマップ"
source:
  type: local
  id: VP-STATIC-002
  title: "dotenvx encrypted env values should not block secret diagnosis"
architecture_docs:
  reason: "既存のstatic-site scannerのsecret分類にdotenvx暗号化env行の例外を追加する小規模修正であり、新規ADRは不要。"
status: active
created_at: 2026-05-13
updated_at: 2026-05-13
---

# Story: M1: VibePro 診断→商用化ロードマップ

## User Story

**As a** VibeProでリポジトリ診断を運用するユーザー
**I want to** dotenvxで暗号化されたtracked env値を平文secretとして扱わない
**So that** 実際には暗号化済みの環境変数ファイルでCritical Gateが誤ってblockされず、真のsecret漏えいに集中できる

## Background

SalesTailorは `.env.fly.preview`、`.env.fly.production`、`.env.vercel.preview`、`.env.vercel.production` をdotenvx暗号化済みファイルとして追跡している。既存のVibePro static scannerはenvファイルの非コメント行を一律 `env_file_value` としてblock扱いにしていたため、`KEY=encrypted:...` と `KEY="encrypted:..."` 形式まで秘密情報候補として検出していた。

## Acceptance Criteria

- [ ] `DOTENV_PUBLIC_KEY*` はdotenvxの公開鍵としてsecret hitにしない
- [ ] `KEY=encrypted:...` はdotenvx暗号化値としてsecret hitにしない
- [ ] `KEY="encrypted:..."` はdotenvx暗号化値としてsecret hitにしない
- [ ] gitignored `.env` ファイルは引き続きscan対象外のままにする
- [ ] runtime code内の平文secret候補や変数参照の分類は既存どおり維持する
- [ ] `node --test` の回帰テストで、暗号化env行が `secret_hits` に含まれないことを確認する

## Implementation Notes

- 対象: `src/static-site-scanner.js`
- 回帰テスト: `test/vibepro-cli.test.js`
- 既存のsecret maskingやruntime code分類は変更しない
