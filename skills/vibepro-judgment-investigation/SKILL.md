---
name: vibepro-judgment-investigation
description: Use when a VibePro judgment needs a bounded investigation loop that turns a raw goal into evidence-backed candidate options and follow-up questions.
---

# VibePro Judgment Investigation

## When to Use

対象リポジトリで、依頼の目的・問題設定・変更境界・選択肢がまだ確定していないときに使う。Graphify、コード、設定、実行ログ、利用者確認のどれを調べるかを判断DAGから組み立て、現在の証拠で候補を更新するためのSkillである。

Storyの採択、承認、マージ、デプロイ、コマンド実行、外部共有を自動化する作業には使わない。単なる文字列検索、既に一つの選択肢へ採択済みの作業、実装そのものの代わりにも使わない。

## Required Workflow

### 1. 生の依頼を入力する

ホストが `--input` に渡すJSONには、少なくとも次を置く。

```json
{
  "schema_version": "0.1.0",
  "case_id": "checkout-entry",
  "goal": "利用者が既存の購入導線で購入結果を受け取れるようにする",
  "scope": { "files": ["src/checkout-entry.js"] },
  "constraints": ["業務APIだけが業務状態を確定する"]
}
```

最初の入力に、確認していない真偽の `observations` を作ってはいけない。`true` / `false` は、実際に取得した証拠とその対象範囲を確認した後のモデル応答で扱う。

### 2. 最初の問いを作る

```sh
vibepro judgment investigate . --input raw-goal.json --json
```

初回応答の `model_request` と、その中の応答スキーマを読む。ここで判断するのは、どの問いを解くか、どの証拠があれば選択肢を分けられるか、次に誰へ何を確認するかである。VibeProに同梱されたキーワード規則やSkill自身で、経路・契約・原因を決めない。

### 3. 実際のホストモデルで意味を整理する

`model_request` を、このホストが実際に利用しているモデルへ渡す。VibePro CLIは有料APIや自律的なLLMを内蔵していない。モデルは現在読めた証拠だけを使い、要求された応答スキーマに従って候補、根拠、未解決の質問、次の証拠要求を返す。

過去の回答、Story、グラフの辺を現在の事実へ昇格させない。証拠を取得できなかった場合は `unknown` または `partial` の意味を保つ。本人の価値選択や業務契約が必要なら、モデルが勝手に選ばず、質問として残す。

### 4. Graphifyを必要な段階で使う

Graphify adapterは、`--graph` に渡した既存Graphify成果物を読む読み取り専用の証拠プロバイダーである。CLIはGraphifyを実行・生成・再生成しない。成果物を作る責任は、既存のGraphify実行経路またはホストに残る。最初に全体構造を見て問題設定を修正してもよいし、最初の問いを受けて特定の経路や共有箇所を絞ってもよい。結果を再評価へ渡すときは次のように指定する。

```sh
vibepro judgment investigate . \
  --input round-1.json \
  --response semantic-model-response.json \
  --graph path/to/current-graphify-artifact.json \
  --json
```

グラフのノード、辺、コミュニティは静的な構造候補である。Graphifyだけで利用者の仕事、契約一致、認証、実行到達、再発防止、成功を証明しない。`freshness` は不明で、runtime確認済みにはならない。グラフがない、対象ファイルが未収載、読み取りに失敗した場合は、`unavailable` / `partial` の調査不足として返す。

Source adapterは、リポジトリ内の相対パスをboundedな行・バイト範囲で読むだけで、書き込みやコマンド実行をしない。抜粋が静的であること、範囲外が未確認であること、シンボリックリンクなどで読めないことを結果に残す。外部providerは、実装された認証済みホストまたはコネクタが証拠を返す場合だけ利用できる。CLI単体では外部取得を行わず、未取得を `unavailable` のまま扱う。

### 5. 応答を再解釈する

実際のモデル応答を `--response` で渡し、出力を次のラウンドの `--input` にする。ラウンドごとに、新しい証拠で問題設定、選択肢、成立条件、質問を更新する。応答スキーマが許す範囲で、案件固有の追加質問を作ってよい。反証された仮説向けの質問を残さず、まだ識別できない案は一つに絞らない。

必要な外部証拠をこのホストが取得できないときは、取得できた範囲だけで `candidate` / `advisory` を返し、誰が何を確認すべきかを出力する。Skillの指示だけで外部コネクタ、ブラウザ、ユーザー判断を代行したと扱ってはいけない。

CLIが確認できるのは、入力と調査contextの一致、参照の整合性、許可されたprovider、providerの `available` / `partial` / `unavailable` 状態、派生statusの再計算である。JSON snapshot内のreceiptの真正性や意味的妥当性、ホストが見ていない案件での判断精度は保証しない。根拠の内容を読み、現在の案件へ適用できるかを判断する責任はホストに残る。

### 6. Storyの下書きへ添付する

調査結果をStoryの判断入力へ付ける場合は、実装されたCLIの `prepare --investigation` オプションを使う。これは調査結果、候補、保留中の質問を入力ドラフトへ添付する。既存の `judgment input adopt`、明示された採択権限、評価、実行権限は変更しない。調査結果の添付だけで採択や実行を行わず、既存の権限と指示に従って後続処理を扱う。

## Inputs and Outputs

入力は、raw goalまたは前ラウンド出力、任意のGraphify `graph.json`、実際のモデルが作成した `--response` である。初期goalには `case_id`、`scope.files`、`constraints` を残し、調査対象と制約を追跡できるようにする。

出力は判断候補、選択肢の比較、根拠、未解決の問い、追加証拠の要求、次の調査を含む助言である。候補の存在は採択や実装成功を意味しない。`advisory: true` と `blocking: false` を維持し、承認・マージ・デプロイの権限を判断出力へ変換しない。

## Common Rationalizations

- 「Graphifyでつながっているから同じ契約だ」: 構造の接続は契約・目的・実動作の証拠ではない。
- 「前回のモデル回答がそう言ったから現在もそうだ」: 前回回答は仮説または過去時点の根拠であり、現在の証拠で再確認する。
- 「質問が残ると進めないのでfalseにする」: 不足は `unknown` / `partial` のままにし、判断を変える証拠を求める。
- 「モデルに渡せばVibeProが全部調べる」: モデル要求の作成と応答の検証が責任範囲であり、外部調査や業務判断は別の担当である。

## Red Flags

- `--response` を渡さず、CLIの候補だけを専門判断の確定値として扱う。
- Graphifyの辺だけで、既存方式の再利用・契約一致・実行成功を選ぶ。
- `scope.files`、制約、現在の証拠範囲を示さずに「原因が特定できた」と書く。
- 未取得の実行ログやユーザー確認を、モデルの説明文で補う。
- `prepare --investigation` の結果だけで `input adopt`、マージ、デプロイへ進む。
- 外部証拠を取得できないのに、取得したかのような `source_refs` や真偽を作る。

## Verification

完了時に、次を確認する。

1. 初回入力が生のgoal、対象ファイル、制約であり、事前に作った真偽観測を含まない。
2. `model_request` の応答スキーマを実際のホストモデルへ渡し、返答を `--response` で入力した。
3. Graphifyを使った場合、その結果を構造候補として扱い、実行成功や契約一致の別証拠を残した。
4. 未取得・部分取得・本人の選択待ちが `unknown` / `partial`、質問、または追加証拠要求として残っている。
5. 出力が候補・助言であり、`prepare --investigation` を使った場合も採択状態や実行権限が変わっていない。
6. 新しい証拠で候補が変わった場合、前ラウンドを上書きせず、次のラウンドとして追跡できる。
