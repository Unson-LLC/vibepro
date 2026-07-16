# ゲートと証跡

VibeProのGateは、PRを作成またはマージしてよいかを判断するための確認項目です。必要なのは「もっともらしい説明」ではなく、現在の変更に紐づいた証跡です。

よくあるstatus:

- `passed`: 必要な証跡があり、現在の変更に一致している
- `needs_evidence`: 必要な検証、artifact、review、decision記録が不足している
- `needs_review`: 人間またはagent reviewがまだ必要
- `blocked`: 修正または明示的なwaiveが必要
- `waived`: 記録された判断により残リスクを受け入れている
- `inconclusive`: scannerがeligible targetを検査できなかった。passではない

## Impact Contextは補助証跡

Graphifyと `codebase-memory-mcp` は、関連ファイル、route、symbol、call path、risk hintを見つける助けになります。VibeProはそれらのsignalを使って、`execution_topology`、`public_contract`、`security_boundary`、`data_state`、`scope_reviewability` などのEngineering Judgment軸を活性化できます。

ただし、これらのsignalはruntime behavior、security correctness、rollback safety、UX、migration、release operationに必要な証跡を閉じません。次に何を読み、何を検証するかを決める材料として使います。

commit後は、以前のverification、review、adjudication、PR readinessをstale候補として扱い、current-head gateを再実行します。
