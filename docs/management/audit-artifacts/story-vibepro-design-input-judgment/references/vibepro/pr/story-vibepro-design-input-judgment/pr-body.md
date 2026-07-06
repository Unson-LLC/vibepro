## 判断
- このPRで判断すること: Engineering JudgmentをArchitecture/Spec前の設計入力として記録する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-design-input-judgment - Engineering JudgmentをArchitecture/Spec前の設計入力として記録する
- 正本: [docs/management/stories/active/story-vibepro-design-input-judgment.md](docs/management/stories/active/story-vibepro-design-input-judgment.md)
- 変更範囲: 27 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-design-input-judgment.md](docs/management/stories/active/story-vibepro-design-input-judgment.md), [docs/architecture/vibepro-design-input-judgment.md](docs/architecture/vibepro-design-input-judgment.md), [docs/specs/story-vibepro-design-input-judgment-spec.md](docs/specs/story-vibepro-design-input-judgment-spec.md)
- 実装: [src/architecture-readiness.js](src/architecture-readiness.js), [src/cli.js](src/cli.js), [src/diagnostic-engine.js](src/diagnostic-engine.js), ...and 5 more
- テスト: [test/architecture-readiness.test.js](test/architecture-readiness.test.js), [test/design-input-judgment.test.js](test/design-input-judgment.test.js), [test/e2e/story-vibepro-design-input-judgment-flow.spec.ts](test/e2e/story-vibepro-design-input-judgment-flow.spec.ts), ...and 5 more

## 経緯
- 要求: Engineering JudgmentをArchitecture/Spec前の設計入力として記録する
- 発生経緯: VibeProはStory、Graphify、Architecture、Spec、PR Gate DAGをつなぐ制御面である。一方で、Story作成直後の案内では `story diagnose` とEngineering JudgmentがArchitecture/Spec後のreadiness証跡として見えやすく、設計入力として働いたかがPR artifact上で分からなかった。 workflow-heavyやcross-surfaceのStoryでは、Architecture/Specを先に固めてからEngineering Judgmentを実行すると、判断が設計の入力ではなく事後確認になる。これではVibeProが防ぎたい「AIが設計を作ってから都合よくGateを通す」状態に寄る。


## 原因
- 最新診断gateが needs_review

## 解決
- Story diagnosisにdesign-inputフェーズを追加し、`--pre-architecture` を短縮指定として扱う。design-input診断はArchitecture/Specの前提調査として記録され、PR readiness時のEngineering Judgmentとは別の証跡として `pr_context.design_input_judgment` に残る。 PR Gate DAGは、workflow-heavyまたはcross-surfaceのArchitecture/Spec変更でdesign-input診断がない場合、release decision warningとして `gate:design_input_judgment` を出す。これは既存PRを不用意にブロックするためではなく、設計入力が欠けた事実をレビュー判断に載せるためのwarningである。

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 28 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/architecture-readiness.js](src/architecture-readiness.js), [src/cli.js](src/cli.js), [src/diagnostic-engine.js](src/diagnostic-engine.js), [src/pr-manager.js](src/pr-manager.js), ...
- テスト差分: [test/architecture-readiness.test.js](test/architecture-readiness.test.js), [test/design-input-judgment.test.js](test/design-input-judgment.test.js), [test/e2e/story-vibepro-design-input-judgment-flow.spec.ts](test/e2e/story-vibepro-design-input-judgment-flow.spec.ts), [test/evidence-depth-pr-prepare.test.js](test/evidence-depth-pr-prepare.test.js), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - Combined current-head regression evidence passed on HEAD 8aab12a565ec4875446c96a90d3f4cb8336c12fd: unit_regression for [docs/contracts/vibepro-responsibility-authority.json#VIBE-RAR-001](docs/contracts/vibepro-responsibility-authority.json%23VIBE-RAR-001), [docs/contracts/vibepro-responsibility-authority.json#VIBE-RAR-002](docs/contracts/vibepro-responsibility-authority.json%23VIBE-RAR-002), [docs/contracts/vibepro-core-responsibilities.json#VIBE-CORE-COST-001](docs/contracts/vibepro-core-responsibilities.json%23VIBE-CORE-COST-001), and [docs/contracts/vibepro-core-responsibilities.json#VIBE-CORE-STATUS-001](docs/contracts/vibepro-core-responsibilities.json%23VIBE-CORE-STATUS-001); pr_lifecycle_regression for VIBE-CORE-PR-001; agent_review_lifecycle_regression for VIBE-CORE-AR-001; evidence_lifecycle_regression for VIBE-CORE-EV-001; integration_runtime_path and negative_path for VIBE-CORE-COST-001; story_source_integrity_regression for VIBE-CORE-STORY-001; engineering_judgment_regression for VIBE-CORE-JUDGE-001; managed_worktree_regression for VIBE-CORE-WT-001.; evidence: [.vibepro/pr/story-vibepro-design-input-judgment/test-artifacts/combined-current-head-regression.json](.vibepro/pr/story-vibepro-design-input-judgment/test-artifacts/combined-current-head-regression.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-design-input-judgment/test-artifacts/combined-current-head-regression.json](.vibepro/pr/story-vibepro-design-input-judgment/test-artifacts/combined-current-head-regression.json)
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD 8aab12a565ec; evidence: [.vibepro/pr/story-vibepro-design-input-judgment/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-design-input-judgment/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-design-input-judgment/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-design-input-judgment/ci-evidence/test_22_.json)
- [x] E2E Gate - DIJ flow e2e passed 7/7 on 8aab12a with durable workflow replay, artifact replay, scenario clause, ac:7, and ac:8 evidence; evidence: [.vibepro/pr/story-vibepro-design-input-judgment/e2e-evidence-8aab12a.json](.vibepro/pr/story-vibepro-design-input-judgment/e2e-evidence-8aab12a.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-design-input-judgment/e2e-evidence-8aab12a.json](.vibepro/pr/story-vibepro-design-input-judgment/e2e-evidence-8aab12a.json)
- 最終E2E: pass: DIJ flow e2e passed 7/7 on 8aab12a with durable workflow replay, artifact replay, scenario clause, ac:7, and ac:8 evidence（[.vibepro/pr/story-vibepro-design-input-judgment/e2e-evidence-8aab12a.json](.vibepro/pr/story-vibepro-design-input-judgment/e2e-evidence-8aab12a.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-design-input-judgment/](.vibepro/pr/story-vibepro-design-input-judgment/)
- PR準備: [.vibepro/pr/story-vibepro-design-input-judgment/pr-prepare.json](.vibepro/pr/story-vibepro-design-input-judgment/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-design-input-judgment/decision-index.json](.vibepro/pr/story-vibepro-design-input-judgment/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 8aab12a565ec codex/issue245-design-input-judgment clean (story=story-vibepro-design-input-judgment)
