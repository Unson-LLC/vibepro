---
story_id: story-vibepro-production-runtime-connectors
status: active
---

# Production Runtime Connectors Architecture

## Decision

Provider固有のprocess transportを`agent-runtime-connectors.js`へ隔離し、Codex CLIと明示opt-inのClaude Codeを既存の`probe/start/status/cancel/collect_result` contractへ正規化する。CLI composition rootだけがproduction Coordinatorを既定注入し、呼び出し側が明示注入したCoordinatorは置換しない。

ImplementationはRunが検証済みのmanaged worktreeを`cwd`としworkspace-write sandboxで起動する。Reviewは同じauthority rootをread-only/plan modeで開き、要求されたreviewer identityとdispatch固有sessionを返す。最終結果は厳格なJSON contractを要求し、不在・不正・HEAD不一致を既存Coordinatorがfail closedにする。

Claude Codeは`VIBEPRO_CLAUDE_CODE_ENABLED=true`の場合だけprobe可能で、未設定時は`runtime_unavailable`を返す。fallback順は既存Runの`provider_fallbacks`だけを使用し、connectorは暗黙のprovider選択を行わない。connectorはGate、worktree lifecycle、Agent Review記録、PRを直接変更しない。

## Failure Boundary

binary/auth/capability/sandbox/quota/permission/timeoutはtyped probe/statusへ正規化する。providerが返さないtoken/costは推測せず`null`として保持する。process出力やcredentialはRun artifactへ保存せず、contractを満たす構造化resultだけをCoordinatorへ返す。

## Verification

- fake processによる両connectorのcontract/lifecycle/cancel/typed failureテスト
- 実Codex binaryのcredential-free probe smoke
- 既存Agent Runtime AdapterとGuarded Run suiteによる境界回帰

