---
story_id: story-vibepro-pr-ship-command
title: VibePro PR ship Command Architecture
---

# アーキテクチャ

## 判断

`vibepro pr ship` を `pr prepare` と `pr create` の間に置く。ShipはPR作成を急がせるコマンドではなく、最新Gate DAGを再生成したうえで、自動実行できる安全操作と人間判断が必要な停止点を分けるオーケストレーターである。

## 境界

Shipが実行してよい操作は、VibePro内部証跡の再生成と、Gateがreadyのときの既存 `pr create` 呼び出しに限定する。subagent dispatch、waiver、merge、raw GitHub CLIへの直接誘導はShipの責務ではない。

## フロー

```text
vibepro pr ship
  -> vibepro pr prepare
  -> Gate status判定
  -> blocked: Agent Review / evidence / waiver commandsを返す
  -> ready: vibepro pr create
```

## 停止点

- Required Agent Reviewが未完了なら、`review prepare`、`review start`、`review record` の順序を返して停止する。
- critical Gateが未解決なら、証跡または決定の追加を返して停止する。
- 非critical Gateだけが未解決なら、waiver判断が必要であることを返して停止する。

## 不変条件

- Shipは必ず `pr prepare` を先に再実行する。
- Shipの候補コマンドに raw `gh pr create` は出さない。
- `--dry-run` はPR作成を実行せず、実行済み安全操作、停止理由、人間判断、次コマンドをJSONで返す。
