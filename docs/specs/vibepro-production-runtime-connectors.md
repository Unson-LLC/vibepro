---
spec_id: spec-vibepro-production-runtime-connectors
story_id: story-vibepro-production-runtime-connectors
status: active
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
code_refs:
  - src/agent-runtime-connectors.js
  - src/agent-runtime-adapter.js
  - src/cli.js
test_refs:
  - test/agent-runtime-connectors.test.js
  - test/agent-runtime-adapter.test.js
---

# Production Runtime Connectors Spec

## Connector Contract

`codex`と`claude-code`は既存Agent Runtime Adapterの5 methodを実装する。probeはavailability、role別capability、sandbox、approval policyを返す。Claude Codeは明示設定されない限りunavailableである。

startはshellを介さず引数配列でprovider processを起動し、Implementationをmanaged worktree + workspace-write、Reviewを同worktree + read-only/planへ制限する。dispatch固有provider id/session/threadを返し、credentialやtranscriptを永続化しない。status/cancel/resultはprocess状態をtyped contractへ写像し、cancelはterminal closeを確認してから返す。

## Result and Failure Contract

成功resultはcompletion status、changed files、actual HEAD、test suggestions、summaryを必須とする。Reviewはchanged files空、closed lifecycle、別identity/sessionを追加する。usageはprovider観測値のみで、未知のtoken/costはnull。binary、auth、quota、permission、timeout、不正outputは成功へ昇格しない。

## Composition Contract

public CLIのGuarded Run composition rootはproduction Coordinatorを既定注入する。ただしテスト・埋め込み利用者が明示したCoordinatorを優先する。fallbackはRunに永続化されたpolicy順だけで実行し、connector自身はfallback、Gate、worktree、Review lifecycle、PRを操作しない。
