# VibePro 縮小リファクタ宣言（旧: 凍結宣言）

> **✅ 実装完了 (2026-08-07)**: 全6スライス着地（PR #429/#430/#431/#432/#433/#434）。src 150ファイル/111,341行 → 88ファイル/41,942行（-62%）。フルスイート 2,328テスト/34.8分 → 691テスト/3.9分。実装計画と各スライスの実測は `rebuild-plan.md` を参照。残フォローアップ: report fingerprint pr-body形状の再設計、story_source/AC条項マップのpr prepare再統合（いずれも動作影響なし）。

**日付**: 2026-08-06（同日中に凍結→縮小リファクタへ方針確定）
**決定者**: 佐藤圭吾（オーナー）

## 決定

1. **VibeProはプロダクトとして存続する。** ただし現行の重装備（Gate DAG、delivery-efficiencyバジェット、head束縛による証跡stale化、review lifecycle会計）は廃止対象とし、最小コアへ縮小リファクタする。
2. **self-dogfood原則は恒久廃止。** VibePro自身の開発は普通のgitフロー（ブランチ → テスト → `gh pr create` → レビュー → merge）で行う。VibePro CLIフローは自身の開発に使わない。
3. 旧機構のアクティブStory約240件（`.vibepro/config.json` `brainbase.stories[]`）は一括クローズ済み。旧バックログは修復しない。

## 最小コアのスコープ（残すもの / 捨てるもの）

**残す（v-next のコア）:**
- Story登録と Story→Spec→コードのトレーサビリティ
- Spec検証（code_refs/test_refs の存在・アンカー検証）
- 軽量レビュー1周（役割別の並列dispatchは可、lifecycle会計・予算・authorize儀式は無し）
- PR作成補助（証跡の要約をPR本文に添付する程度。mergeブロック機構は持たない）

**捨てる:**
- Gate DAG と route分類（workflow_heavy等）
- delivery-efficiencyバジェット全系（override/grant/decision record含む）
- head厳密束縛による証跡・裁定のstale化（content-surface束縛のみ残すか、再設計）
- review lifecycle会計・authorize/close儀式
- audit artifactの自動生成・自動push

## 判断の根拠（実測、2026-08-06棚卸し）

- 直近8週のマージ67件中56件（84%）がVibePro自身の修繕。アクティブStory 240件は全て自己言及。
- 1 Storyあたり最大192回のレビューdispatch・約165時間のレビューlifecycle消費。
- 構造的原因: 修正コミットごとの証跡stale化 → スイート再実行（28〜34分） → レビュー再dispatch、の収束しないループ。
- 詳細: `delivery-efficiency-budget-gap-analysis.md` / `issue-423-gap-analysis.md`

## 保全済み資産

- 未マージ4ブランチ（origin push済み）: `codex/content-scoped-evidence-reuse-key` (+21)、`claude/jolly-banach-a2c66a` (+20)、`claude/ecstatic-benz-371e23` (+7)、`claude/suspicious-galileo-b16c8b` (+1)
- dirty worktree実作業7本の差分: `.vibepro-store/freeze-rescue-2026-08-06/`
- zealous-jones裁定一次資料: `.vibepro-store/story-vibepro-work-based-agent-consumption-budget/rescue-2026-08-01/`
- 裁定記録・gap分析は縮小リファクタの設計判例として参照する（コードの復元元にはしない）

## 他リポジトリへの適用

縮小リファクタ完了までは、他リポジトリの開発にVibePro CLIフローを使わない。軽量規律（PR本文にStory 1段落＋ACごとの対応テスト列挙）はPRテンプレートとして先行配布する（試作: mana-runtime PR #77）。

## 成功基準（v-next 受け入れ条件）

- VibePro経由のPRの過半が VibePro 自身以外向けであること
- 1 Story あたりレビューdispatch 5回以内で PR-ready に到達すること
- 修正コミット1回あたりの追加検証コストが「変更対象のテストのみ」で済むこと（全体スイート28分の固定費を要求しない）
