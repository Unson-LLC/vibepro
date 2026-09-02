<!-- vibepro-projection story_id=story-vibepro-pr-narrative-projection feature_slug=pr-narrative-projection ownership=generated profile=feature_packet source=.vibepro/stories/story-vibepro-pr-narrative-projection/tasks/tasks.json source_sha256=d3394b0777ee7a26cd77096fb96a4d34252ddbe2fd40f04a76c44d300dec90b1 renderer=tasks_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Tasks

## VP-PR-NARRATIVE-001: 保存済み説明をPR本文へ鮮度検証付きで投影する

- story_id: story-vibepro-pr-narrative-projection
- status: done
- target_files: docs/architecture/story-vibepro-pr-narrative-projection.md, docs/features/pr-narrative-projection, docs/management/stories/active/story-vibepro-pr-narrative-projection.md, package-lock.json, package.json, src/artifact-routing.js, src/cli.js, src/pr-manager.js, src/report-fingerprint.js, src/report-pr-body-schema.json, src/report-validator.js, test/artifact-routing.test.js, test/pr-artifact-consistency.test.js, test/pr-manager.test.js, test/report-fingerprint.test.js, test/report-pipeline.test.js, test/vibepro-cli.test.js
- dependencies:
- acceptance_criteria:
  - 保存済み説明が生成PR本文の固定欄へ表示される。
  - 説明が未保存または現在証拠と不一致なら古い説明を表示しない。
  - 同一HEADで検証証拠またはレビュー役割の状態が変わった場合も再生成を要求する。
  - Markdown構造、インライン記法、HTMLを含む説明を保存時に拒否する。
  - 受理済みTaskをID・対象ファイル・依存関係付きで表示する。
  - 生成PR本文を直接読む回帰テストと型検査が成功する。
