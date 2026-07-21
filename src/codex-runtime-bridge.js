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
  const resumeFromWake = ({ story_id: storyIdSnake, storyId, run_id: runIdSnake, runId, dispatch_id: dispatchIdSnake, dispatchId } = {}) => {
    const resolvedStoryId = storyId ?? storyIdSnake;
    const resolvedRunId = runId ?? runIdSnake;
    const resolvedDispatchId = dispatchId ?? dispatchIdSnake;
    if (!resolvedStoryId || !resolvedRunId || !resolvedDispatchId) {
      throw new TypeError('Codex wake resume requires story_id, run_id, and dispatch_id');
    }
    return session.reconcileRuntime(repoRoot, {
      storyId: resolvedStoryId,
      runId: resolvedRunId,
      dispatchId: resolvedDispatchId
    });
  };
  if (typeof host?.registerResumeHandler !== 'function') {
    throw new TypeError('Codex host must implement registerResumeHandler for push resume delivery');
  }
  const ready = Promise.resolve(host.registerResumeHandler({ resume: resumeFromWake }));
  return Object.freeze({ inbox, adapter, coordinator, session, resumeFromWake, ready });
}
