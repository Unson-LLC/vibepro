import { createAgentCompletionInbox } from './agent-completion-inbox.js';
import { createAgentRuntimeCoordinator } from './agent-runtime-adapter.js';
import { createCodexSubagentRuntimeAdapter } from './codex-subagent-runtime-adapter.js';
import { createGuardedRunSession } from './guarded-run-session.js';

export function createCodexGuardedRunBridge({
  repoRoot,
  host,
  recordAgentReview,
  now = () => new Date(),
  guardedRunDependencies = {}
} = {}) {
  const inbox = createAgentCompletionInbox({ repoRoot, now });
  const adapter = createCodexSubagentRuntimeAdapter({ repoRoot, host, inbox, now });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter], now });
  const session = createGuardedRunSession({
    ...guardedRunDependencies,
    agentRuntimeCoordinator: coordinator,
    recordAgentReview: recordAgentReview ?? guardedRunDependencies.recordAgentReview
  });
  return Object.freeze({ inbox, adapter, coordinator, session });
}
