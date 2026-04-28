# VibePro CLI graphify 連携 Architecture

## Source Story（NocoDB 正本）

Story SSOT は NocoDB とする。この Architecture は、NocoDB の既存 Story レコードを確認したうえで紐付ける。

ローカル docs に Story 投影を置く場合があっても、それは可読性のための補助であり、Story 正本にはしない。

| 項目 | 値 |
|------|-----|
| Story SSOT | NocoDB |
| NocoDB Story view | https://noco.unson.jp/dashboard/#/nc/pfgza5aei6wboaq/mjpg80jobkjo8lz/vw5ur5jwyhhwgsyf/%25E3%2582%25B9%25E3%2583%2588%25E3%2583%25BC%25E3%2583%25AA%25E3%2583%25BC-%25E3%2583%259E%25E3%2582%25A4%25E3%2583%25AB%25E3%2582%25B9%25E3%2583%2588%25E3%2583%25BC%25E3%2583%25B3 |
| 対応する既存 Story | `番号=2`: M1: VibePro 診断→商用化ロードマップ |
| 対応 Story ID | `story-vibepro-diagnosis-commercialization-roadmap` |
| ローカル投影 | 非正本 |

## 既存 Story との対応

新規 Story を作る前に、NocoDB の既存 Story を確認した。この Architecture は、既存の `M1: VibePro 診断→商用化ロードマップ` に紐付ける。理由は、この Story が診断標準化、アーキテクチャ分析、リスク台帳、デプロイ計画、見積もり、商用化ロードマップをすでに含んでおり、今回の graphify / CLI 連携はその拡張として扱えるためである。

| NocoDBレコード | 既存Story | 判定 | 理由 |
|---------------|------------|------|------|
| `番号=2` | M1: VibePro 診断→商用化ロードマップ | 採用 | graphify / CLI 化は診断とアーキテクチャ分析の拡張である |
| `番号=1` | M0: Next.js + SPA診断パターン作成 | M1へ吸収してアーカイブ済み | Next.js + SPA 診断に狭すぎるため、M1の診断標準化へ吸収 |
| `番号=3` | Story Driven DevelopmentのLearnフェーズを完全自動化 | 不採用 | Learn 自動化であり、リポジトリ単位の本番化診断ではない |
| `番号=4` | 雲孫全プロダクトでのNPS計測基盤確立 | 不採用 | NPS 基盤展開であり、今回の graphify / CLI と無関係 |
| `番号=5` | Phase 1完成とmana/Zeims導入 | 不採用 | プロダクト展開のマイルストーンであり、診断特化ではない |
| `番号=6` | Slack Bot統合とNPS質問送信 | 不採用 | Slack / NPS 機能開発 |
| `番号=7` | Convex DB設計と集計ロジック実装 | 不採用 | NPS データ実装 |
| `番号=8` | brainbase連携とNPS可視化 | 不採用 | NPS 可視化連携 |
| `番号=9` | ストーリーのLearnフェーズを自動化 | 不採用 | ユーザー側の Learn 自動化 |
| `番号=10` | 全プロダクトのNPSを横断比較 | 不採用 | 経営向け NPS 概況 |
| `番号=11` | ユーザーフィードバックをSlackで即座に受信 | 不採用 | フィードバック通知機能 |

## 親 Frame

- [VibePro リポジトリ内制御基盤 Frame](../frames/vibepro-repo-local-control-plane-frame.md)
- [VibePro 運用思想](../frames/vibepro-operating-philosophy.md)

## アーキテクチャ意図

VibePro を、CLI で動くリポジトリ内制御基盤にする。graphify は VibePro の文脈 DAG に入力を渡す文脈抽出アダプターとして統合する。VibePro は本番化準備度の解釈、ゲート、証跡、Brainbase 連携を持ち続ける。

## Story 投影（非正本）

この投影は、NocoDB レコードと Architecture の対応をレビューしやすくするための補助であり、正本ではない。

AI で作られたプロダクトを本番化する責任者が、VibePro でリポジトリ内の本番化作業領域を初期化・維持できる。これにより、人間、AI assistant、Brainbase が、繰り返しの診断・実装サイクルで同じ文脈、証跡、ゲート状態を参照できる。

受け入れ条件の投影:

- 対象リポジトリに VibePro 作業領域を初期化できる
- graphify が生成した文脈成果物を生成または取り込める
- どのソース版を診断したかを記録できる
- 抽出された文脈、推論された文脈、曖昧な文脈を区別できる
- 文脈グラフを入力として本番化診断を実行できる
- 人間向けレポートと機械可読状態の両方を出せる
- 機密性の高い生証跡はデフォルトでコミット対象にしない
- Brainbase は安定した管理目録から最新実行とゲート状態を発見できる
- graphify 連携を無効化または置換しても、既存の VibePro 実行が無効にならない

## 境界モデル

```text
対象リポジトリ
  -> VibePro CLI
  -> リポジトリ内作業領域
  -> 文脈アダプター
  -> 診断エンジン
  -> ゲートエンジン
  -> レポート / 連携レイヤー
  -> Brainbase 集約
```

## 責務境界

| 境界 | 責務 | 禁止事項 |
|----------|----------------|-------------|
| CLI | コマンド引数の解釈、リポジトリ検出、実行調整 | 診断ルールを持つ |
| リポジトリ内作業領域 | リポジトリ単位の VibePro 成果物を管理する | デフォルトでプロダクトのソースを変更する |
| 文脈アダプター | 外部の文脈情報を VibePro の文脈入力に変換する | 本番化準備度を判定する |
| graphify アダプター | graphify の出力を実行または取り込む | 推論された graph 情報を検証済み事実として扱う |
| 診断エンジン | 検出事項、スコア、推奨事項を作る | 証跡の出所を隠す |
| ゲートエンジン | 構造化された検出事項から経路とゲート状態を決める | 必須の人間ゲートを迂回する |
| レポート / 連携レイヤー | Markdown と機械可読状態を生成する | 自分自身を正本にする |
| Brainbase import | リポジトリ状態を複数 project で集約する | リポジトリ文脈を生ソースから毎回再導出する |

## データフロー

```text
リポジトリ内のファイル
  -> graphify アダプター
  -> 文脈グラフ成果物
  -> VibePro 文脈モデル
  -> 診断
  -> 検出事項とゲート
  -> レポートと管理目録
  -> Brainbase import
```

文脈グラフは診断への入力であり、診断そのものではない。

## 作業領域の投影

VibePro はリポジトリ内に作業領域を 1 つ予約し、その中に成果物を置く。

```text
.vibepro/
  config
  管理目録
  graphify 成果物
  診断実行結果
  ゲート状態
  連携状態
```

この文書では、具体的なファイル名や schema は確定しない。それらは Spec で扱う。Architecture では、リポジトリ内 VibePro 作業領域の存在と、その中の責務境界だけを固定する。

## 正本モデル

| 情報 | 正本 |
|------|------|
| プロダクトのソース | 対象リポジトリ |
| VibePro の実行状態 | VibePro 作業領域の管理目録 |
| 文脈グラフの元成果物 | 文脈アダプターの成果物領域 |
| 本番化準備度の解釈 | VibePro 診断実行結果 |
| ゲート状態 | VibePro ゲート状態 |
| 複数リポジトリをまたぐプロジェクト管理 | Brainbase |

人間向け Markdown レポートは投影である。機械可読な管理目録と実行状態が、VibePro と Brainbase の連携口になる。

## graphify の役割

graphify が提供するもの:

- コードと文書の構造抽出
- グラフ構造
- 関係のまとまりと重要ノード
- 抽出された関係、推論された関係、曖昧な関係
- AI assistant が再利用できる文脈レポート

VibePro はこれらを文脈品質と依存関係の信号として使う。曖昧または推論された graph の関係は診断質問へ回し、受け入れ済み事実として扱わない。

## Brainbase の役割

Brainbase は、複数リポジトリの VibePro 連携口を読む。

Brainbase が持つもの:

- 顧客 / プロジェクト関係
- Story / Decision の紐付け
- 複数リポジトリの状態ビュー
- 診断結果と実装結果をまたいだ学習
- 推進案件と商用フォローアップ

Brainbase は graphify の生出力形式に依存しない。VibePro の連携モデルに依存する。

VibePro CLI は Brainbase 連携口として、最新の管理目録と診断証跡を `.vibepro/brainbase/import-state.json` に正規化する。Brainbase は任意の Markdown レポートや graphify の生出力を直接読まず、この取り込み状態を読む。

Brainbase 取り込み状態は、単一Story固定ではなく複数Story、NocoDB ストーリーテーブルの `Horizon`、`View`、`Period`、`開始日`、`期限日` を持つ。これにより、同じ診断runをマイルストーン、顧客別ビュー、月次集計など複数の管理文脈へ対応づけられる。

## 人間ゲート

この Architecture では、次のゲートを必須として維持する。

- データ移行
- 本番切替
- 顧客通知
- セキュリティ例外
- 不可逆変更
- テンプレート境界を超える変更

文脈グラフはゲートリスクを発見できるが、ゲートを通過させることはできない。

## Architecture 判断

| 判断 | 理由 |
|----------|-----------|
| リポジトリ内作業領域を使う | 証跡とゲート履歴をプロダクトリポジトリに紐付けるため |
| graphify をアダプターの後ろに置く | graphify を VibePro の領域モデルにしないため |
| 管理目録を Brainbase 連携口にする | レポート本文の読み取りに依存せず安定集約できるようにするため |
| assistant 導入は明示コマンドに分ける | AGENTS、hooks、project instructions を予期せず変更しないため |
| 推論された graph edge は診断質問として扱う | 推論された文脈が誤った権威になるのを防ぐため |

## リスク

| リスク | 対策 |
|------|------------|
| 機密性の高い証跡が git にコミットされる | デフォルトの除外方針と提出用レポート / 生証跡の分離 |
| graphify の出力形式が変わる | アダプターが VibePro 文脈モデルに正規化する |
| リポジトリ内成果物が侵襲的に見える | VibePro 作業領域の中だけに書く |
| Brainbase が graphify の生ファイルに密結合する | Brainbase は VibePro の連携口だけを読む |
| 診断がグラフ依存に偏る | 静的チェック、LLMOps チェック、ゲート、証跡は VibePro が持つ |
| Brainbase 側の取り込み実装が Markdown 解析に依存する | VibePro が `import-state.json` を生成し、構造化JSONを連携口にする |

## Architecture 確認

| 確認項目 | 状態 |
|-------|--------|
| 境界が明確 | Ready |
| SSOT が明確 | Ready |
| 人間ゲートが明確 | Ready |
| graphify が中核領域ではない | Ready |
| 実装 schema に踏み込んでいない | Ready |
