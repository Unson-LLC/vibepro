---
story_id: story-vibepro-design-input-judgment
title: Engineering JudgmentをArchitecture/Spec前の設計入力として記録する
parent_design: vibepro-design-input-judgment
architecture_docs:
  - docs/architecture/vibepro-design-input-judgment.md
spec_docs:
  - docs/specs/vibepro-design-input-judgment.md
---

# Story: Design Input Judgment

## 背景

VibeProはStory、Graphify、Architecture、Spec、PR Gate DAGをつなぐ制御面である。一方で、Story作成直後の案内では `story diagnose` とEngineering JudgmentがArchitecture/Spec後のreadiness証跡として見えやすく、設計入力として働いたかがPR artifact上で分からなかった。

workflow-heavyやcross-surfaceのStoryでは、Architecture/Specを先に固めてからEngineering Judgmentを実行すると、判断が設計の入力ではなく事後確認になる。これではVibeProが防ぎたい「AIが設計を作ってから都合よくGateを通す」状態に寄る。

## 方針

Story diagnosisにdesign-inputフェーズを追加し、`--pre-architecture` を短縮指定として扱う。design-input診断はArchitecture/Specの前提調査として記録され、PR readiness時のEngineering Judgmentとは別の証跡として `pr_context.design_input_judgment` に残る。

PR Gate DAGは、workflow-heavyまたはcross-surfaceのArchitecture/Spec変更でdesign-input診断がない場合、release decision warningとして `gate:design_input_judgment` を出す。これは既存PRを不用意にブロックするためではなく、設計入力が欠けた事実をレビュー判断に載せるためのwarningである。

## 受け入れ基準

- `vibepro story diagnose . --id <story-id> --pre-architecture` がdesign-input診断としてrun/evidenceに記録される。
- `--phase design-input|pre-implementation` で診断フェーズを明示できる。
- Story作成直後のnext commandとworkflow guidanceは、最初の診断をArchitecture/Spec前のdesign-inputとして案内する。
- PR prepare artifactは `design_input_judgment` と `pre_implementation_judgment` を分けて保持する。
- workflow-heavyまたはcross-surfaceのArchitecture/Spec変更でdesign-input診断がない場合、Gate DAGにwarningが出る。
- design-input診断がある場合、同Gateはpassedになる。
- README、CLI reference、VibePro workflow skillが新しい順序を説明する。

## シナリオ

- `DIJ-SCENARIO-001`: VibePro workflow stateがStory selectedになった直後に `vibepro story diagnose . --id story-vibepro-design-input-judgment --pre-architecture --run-graphify` を実行し、Architecture/Specを固める前のdesign-input evidenceとして `diagnosis_phase=design_input` を残す。
- `DIJ-SCENARIO-002`: VibePro workflow statusがArchitecture/Specと実装済みになった後に `pr prepare` を実行し、`design_input_judgment` と `pre_implementation_judgment` が別々のPR contextとして保持されることを確認する。
- `DIJ-SCENARIO-003`: design-input evidenceが存在しないworkflow-heavy変更では `gate:design_input_judgment` がreview warningになり、design-input evidenceが存在する変更では同Gateがpassedへtransitionする。

## 検証

- `node --test test/design-input-judgment.test.js`
- `node --test test/architecture-readiness.test.js test/engineering-judgment-activation-precision.test.js test/pr-readiness-gate-status.test.js`
- `npm run typecheck`
