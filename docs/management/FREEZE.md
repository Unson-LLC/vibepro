# VibePro 凍結宣言

**日付**: 2026-08-06
**決定者**: 佐藤圭吾（オーナー）
**実施**: 凍結棚卸しセッション（Claude）

## 決定

VibeProリポジトリおよび Story → Architecture → Spec → Task → Code → Gate → PR の自己ドッグフーディング運用を凍結する。以後の開発（このリポジトリを含む全リポジトリ）は、通常のgitフロー（ブランチ → テスト → PR → レビュー → merge）で行う。

## 理由（実測）

- 直近8週間のマージ67件中56件（84%）がVibePro自身の改修で、外部プロジェクトへの出荷をほぼ生んでいなかった。
- アクティブStory 240件はすべてVibePro自身向け。
- 1 Storyあたり最大192回のレビューdispatch・約165時間のレビューlifecycle消費（`story-vibepro-guarded-run-session-contract` 実測）。
- 構造的原因: 修正コミットごとの証跡stale化 → verify run再実行（全体スイート28〜34分）→ レビュー再dispatch、という収束しないループ。詳細は `delivery-efficiency-budget-gap-analysis.md` / `issue-423-gap-analysis.md`。
- 凍結判断の直前、着地寸前だったStory（content-scoped-evidence-reuse-key）ですらレビュー予算枯渇と「merge後の状態をmerge前にレビューする」順序デッドロックで停止した。

## Storyの一括クローズ

`.vibepro/config.json` `brainbase.stories[]` の全エントリ（約240件）は、個別の記録された `status` にかかわらず、本宣言をもって一括クローズとする。config自体は改変せずアーカイブとして保存する。

## 未着地作業の処分

- push保全済みブランチ（マージしない）: `codex/content-scoped-evidence-reuse-key` (+21)、`claude/jolly-banach-a2c66a` (+20)、`claude/ecstatic-benz-371e23` (+7)、`claude/suspicious-galileo-b16c8b` (+1)
- 未コミット差分の退避: 実作業を含んでいたdirty worktree 7本の diff + untracked ファイルを `.vibepro-store/freeze-rescue-2026-08-06/` にpatchとして保存（gitignore領域、mainチェックアウト側に残置）
- zealous-jones裁定の一次資料: `.vibepro-store/story-vibepro-work-based-agent-consumption-budget/rescue-2026-08-01/`
- worktree約130本は削除（ローカルブランチrefは全て残存）

## 残す価値があるもの（後継の設計材料）

- Story→Spec→コードのトレーサビリティという規律そのもの（機構ではなく規約として移植する）
- violation ledger 69,524→55 の収束実績（継続的アーキテクチャ収束ハーネス）
- 予算ガードレール再設計の裁定記録（「壁時計は誤った単位」「boundは課される側が設定してはならない」）
- 証跡binding意味論の欠陥カタログ（gap分析2本）

## 再開基準

再開する場合は現行実装の修復ではなく、必要最小の機構をゼロから設計する。判断基準（当時の合意）: 「VibePro経由PRの過半が自分以外向けか」「1 Storyあたりレビュー5回以内か」を満たせる設計であること。
