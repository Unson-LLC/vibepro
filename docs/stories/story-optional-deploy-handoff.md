# 任意デプロイhandoff

## Story

VibePro利用者として、PR準備が終わった成果を、必要なときだけデプロイ担当へ渡せるローカルintentとして保存したい。
Brainbaseを使わないリポジトリでもVibePro単体でPR準備を続けられ、Brainbaseを使う運用では後段のbridgeが明示的な担当・認可・マージ確認を行える状態にする。

このhandoffは配備そのものではない。未マージのHEADに対する意図を記録し、マージ後のコミット確定と配備依頼への変換はbridgeの責務とする。

## Acceptance criteria

- **HOF-001**: `pr prepare`は、`--deploy-handoff <JSON入力ファイル>`を指定した場合だけ、`deploy-handoff.v1`を`.vibepro/pr/<story-id>/deploy-handoff.json`へ出力する。
  - Evidence method: CLI限定テストで、指定時の生成と未指定時の未生成を確認する。
- **HOF-002**: handoffはBrainbase認証・API・ネットワークへ依存せず、VibePro単体で生成できる。
  - Evidence method: Brainbase環境変数とクライアントを用意しない単体テストで生成する。
- **HOF-003**: handoffは`head_sha`、Story・検証・PR prepareのリポジトリ相対参照、targetのrepository/environment、空でないacceptance criteria、`normal|standalone`のmode、`authority_ref`を含む。
  - Evidence method: 契約テストで必須フィールド、相対path、criteriaの`id`/`condition`/`evidence_method`を検証する。
- **HOF-004**: handoffは`merge_sha`、`merge_commit_sha`、`request_id`、`deployed`を生成せず、acceptance criteriaをacceptedへ推論しない。
  - Evidence method: 出力検査とsemantic件数だけの入力に対する回帰テストで確認する。
- **HOF-005**: unknown version、不正SHA、全ゼロSHA、絶対path・親参照・リポジトリ外へ解決される参照、空criteria、重複criteria ID、長さ制限超過、無効targetを拒否する。
  - Evidence method: validatorの失敗ケースを網羅する単体テストを実行する。
- **HOF-006**: bridgeはGitHubのmerged PR、対象main、repository、approved headの一致とnon-zero merge commitを確認した後だけ、`deployment-request.v1`へ固定できる。
  - Evidence method: bridge側の検証証跡をhandoffの参照先として保持し、VibeProはbridgeの認可や配備状態を表明しない。

## Boundary

BrainbaseとVibeProはそれぞれ単独で利用できる。入力JSONを指定しない通常の`pr prepare`は既存の出力だけを作る。`mode=standalone`は製品単独利用を表す値ではなく、他の依頼と集約せず、既存queueのfenceとruntime完全一致を検証して受け入れる配備を表す。入力JSONに書かれた`authority_ref`は参照文字列であり、権限を付与しない。
入力JSONを指定しない通常の`pr prepare`は、既存の`deploy-handoff.json`を削除しない。consumerはhandoffの`head_sha`を現在の対象HEADと照合し、残っているファイルだけを新しい意図として扱わない。
