---
story_id: story-vibepro-test-tmpdir-fixture-cleanup
title: Test-suite scratch TMPDIR isolation Spec
status: active
parent_design: vibepro-test-tmpdir-fixture-cleanup
last_reviewed_root_hash: fdc3ab1c3fda8fe91c4776c7bc66b841ad8a16a6f4355b828187be80f96723b3
---

# Test-suite scratch TMPDIR isolation Spec

正本のSpec artifactは `.vibepro/spec/story-vibepro-test-tmpdir-fixture-cleanup/spec.json`（clauses: INV-001 / S-001 / S-002、diagrams: state / threat_model）。本ファイルはDesign SSOTのlineage束縛用のspec pointerであり、Storyの受け入れ基準は `docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md` を参照する。

## Contract Summary

- INV-001: `test/**/*.{test,spec}.{js,ts,jsx,tsx,cjs,mjs}` のうち mkdtemp / os.tmpdir() を参照する全ファイルは `test/support/scratch-tmpdir.js` をimportする。conformanceテスト（`test/scratch-tmpdir-conformance.test.js`）が違反ファイルを名指しして失敗する。
- S-001: ヘルパーをimportしたテストプロセスは、自プロセス・プロセス内で呼ばれるsrc本体・spawnした子プロセス（環境変数継承）のmkdtempをすべて実$TMPDIR直下のper-process `vibepro-scratch-*` rootへ隔離し、正常終了時にrootごと削除する。
- S-002: SIGKILL等でexitフックが走らなかった残骸は、24時間経過後に次のヘルパーimport時の自己回復スイープで削除される。スイープは `vibepro-scratch-` prefixのエントリのみを対象とする。
