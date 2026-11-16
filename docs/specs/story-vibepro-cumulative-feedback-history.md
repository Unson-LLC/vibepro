# 最小Spec

Story: `docs/management/stories/active/story-vibepro-cumulative-feedback-history.md`

- 入力: 同じStoryの採用済み前回入力、feedback pointer、今回のoutcome。
- 出力: 次回`judgment prepare`の`development_cycle`。境界以後のバッチを時系列で持つ。
- 不変条件: 最新の採用記録、feedback、採用入力のStory・run・digestを照合する。現行の意味採用・PR権限・Gateには触れない。
- 検証: `test/judgment-operating-loop.test.js`の連続実行、confirmed境界、欠落・不整合の失敗。品質面は既存の対象テストと同じschema検証を通す。

Brainbase参照: `decision_intent_to_outcome_north_star`、`gls_vp_outcome_evaluation_16fff07267`。Graphify影響は取得失敗のためunknownであり、コードと対象テストで補う。
