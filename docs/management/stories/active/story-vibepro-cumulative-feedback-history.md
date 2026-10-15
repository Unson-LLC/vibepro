---
story_id: story-vibepro-cumulative-feedback-history
title: 未確認の採用履歴を次の専門判断へ持ち越す
status: active
---

# Story

Brainbaseの問題選択を受けてVibeProの専門判断を繰り返す利用者として、最後に外部成果を確認してからの採用済み変更を次の判断で参照したい。未改善の構造増加を見落として同じ追加判断を繰り返さないため。

## 受入条件

1. `mixed`・`falsified`・`unknown`の結果は、前回の採用済み履歴を保持して今回のバッチを加える。
2. 確認済みの外部成果だけが履歴境界を進める。
3. 最新の採用入力やfeedbackが欠落・不整合なら、ゼロ扱いせず復旧対象を示して失敗する。
4. 同条件の連続実行で、従来消えた履歴が残り、次の専門判断へ反映される。

Spec: `docs/specs/story-vibepro-cumulative-feedback-history.md`
