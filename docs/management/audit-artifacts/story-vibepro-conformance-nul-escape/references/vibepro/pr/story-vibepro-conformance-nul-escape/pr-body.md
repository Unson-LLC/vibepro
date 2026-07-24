## 判断
- このPRで判断すること: architecture-conformance.jsの生NULバイトを\0エスケープに置換しテキストファイル性を回復する を満たすための Runtime / Contract Docs 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-conformance-nul-escape - architecture-conformance.jsの生NULバイトを\0エスケープに置換しテキストファイル性を回復する
- 正本: [docs/management/stories/active/story-vibepro-conformance-nul-escape.md](docs/management/stories/active/story-vibepro-conformance-nul-escape.md)
- 変更範囲: 3 files / Runtime / Contract Docs
- 設計/Story: [docs/management/stories/active/story-vibepro-conformance-nul-escape.md](docs/management/stories/active/story-vibepro-conformance-nul-escape.md)
- 実装: [src/architecture-conformance.js](src/architecture-conformance.js)

## 経緯
- 要求: architecture-conformance.jsの生NULバイトを\0エスケープに置換しテキストファイル性を回復する
- 発生経緯: `src/architecture-conformance.js` の `assignFilesToModules` にあるテンプレートリテラル2箇所（`matchedPatterns.add(...)` と `matchedPatterns.has(...)` の合成キー）に、エスケープシーケンス `\0` ではなく **生の0x00バイト** が埋め込まれている。導入コミットは 419d0a4c（2026-07-22, target architecture conformance導入）で、ファイル誕生時から存在する。 NUL区切り自体は `src/content-binding.js:174` の `` `${file.path}\0${file.sha256}\0${file.size}` `` と同じ、合成キーの衝突回避として意図的なパターンである。しかし生バイトで埋め込まれた結果: - `file src/architecture-conformance.js` が "data"（バイナリ）と判定される - `-a` なしの `grep` がこのファイルをバイナリ扱いし、マッチを黙って返さない - grepベースのgate・tooling・レビューがこのファイルの実コンテンツを見落とすリスクがある


## 原因
- ソース差分に対するテスト差分がない

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-conformance-nul-escape.md](docs/management/stories/active/story-vibepro-conformance-nul-escape.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-conformance-nul-escape.md](docs/management/stories/active/story-vibepro-conformance-nul-escape.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 5 件あるため履歴確認が必要だが、別Story lineageは検出されていない / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: [src/architecture-conformance.js](src/architecture-conformance.js)
- Risk: ソース差分に対するテスト差分がない
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/a413907f-956a-47c0-91fa-e0143de14790/scratchpad/typecheck-artifact.json
- [x] Unit Gate - 12/12 tests pass after replacing 2 raw NUL bytes with \0 escapes (rebased head); evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/a413907f-956a-47c0-91fa-e0143de14790/scratchpad/unit-status-artifact.json / gate: passed / evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/a413907f-956a-47c0-91fa-e0143de14790/scratchpad/unit-status-artifact.json
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD aa22e2d29472; evidence: [.vibepro/pr/story-vibepro-conformance-nul-escape/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-conformance-nul-escape/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-conformance-nul-escape/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-conformance-nul-escape/ci-evidence/test_22_.json)
- [x] E2E Gate - e2e replay 2/2 pass at rebased head: conformance CLI flow regenerates artifacts through fixed assignFilesToModules; output byte-identical to pre-fix module on real inputs; evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/a413907f-956a-47c0-91fa-e0143de14790/scratchpad/e2e-replay-artifact.json / gate: passed / evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/a413907f-956a-47c0-91fa-e0143de14790/scratchpad/e2e-replay-artifact.json
- 最終E2E: pass: e2e replay 2/2 pass at rebased head: conformance CLI flow regenerates artifacts through fixed assignFilesToModules; output byte-identical to pre-fix module on real inputs（../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/a413907f-956a-47c0-91fa-e0143de14790/scratchpad/e2e-replay-artifact.json）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-conformance-nul-escape/](.vibepro/pr/story-vibepro-conformance-nul-escape/)
- PR準備: [.vibepro/pr/story-vibepro-conformance-nul-escape/pr-prepare.json](.vibepro/pr/story-vibepro-conformance-nul-escape/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-conformance-nul-escape/decision-index.summary.json](.vibepro/pr/story-vibepro-conformance-nul-escape/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-vibepro-conformance-nul-escape/decision-index.json](.vibepro/pr/story-vibepro-conformance-nul-escape/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 aa22e2d29472 claude/story-vibepro-conformance-nul-escape clean (story=story-vibepro-conformance-nul-escape)
