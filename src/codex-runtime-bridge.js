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
  const resumeFromWake = async ({ story_id: storyIdSnake, storyId, run_id: runIdSnake, runId, dispatch_id: dispatchIdSnake, dispatchId } = {}) => {
    const resolvedStoryId = storyId ?? storyIdSnake;
    const resolvedRunId = runId ?? runIdSnake;
    const resolvedDispatchId = dispatchId ?? dispatchIdSnake;
    if (!resolvedStoryId || !resolvedRunId || !resolvedDispatchId) {
      throw new TypeError('Codex wake resume requires story_id, run_id, and dispatch_id');
    }
    const reconciled = await session.reconcileRuntime(repoRoot, {
      storyId: resolvedStoryId,
      runId: resolvedRunId,
      dispatchId: resolvedDispatchId
    });
    const binding = reconciled.dispatch?.review_binding;
    const record = reconciled.dispatch?.result?.review_record;
    if (reconciled.dispatch?.status !== 'completed' || reconciled.dispatch?.role !== 'review' || !binding) {
      return reconciled;
    }
    if (!record) {
      throw new Error('Completed review dispatch is missing its bound review_record');
    }
    const agentReview = await session.recordRuntimeReview(repoRoot, {
      storyId: resolvedStoryId,
      runId: resolvedRunId,
      dispatchId: resolvedDispatchId,
      review: {
        stage: binding.stage,
        role: binding.role,
        status: record.status,
        summary: record.summary,
        findings: record.findings,
        inspectionSummary: record.inspection_summary,
        inspectionEvidence: record.inspection_evidence,
        inspectionInputs: binding.inspection_inputs,
        judgmentDeltas: record.judgment_deltas,
        strictHeadBinding: binding.strict_head_binding,
        strictHeadReason: binding.strict_head_reason,
        agentTranscript: record.inspection_evidence,
        agentCloseEvidence: record.inspection_evidence
      }
    });
    return { ...reconciled, agent_review: agentReview.review };
  };
  const ingestCompletion = async ({ story_id: storyId, run_id: runId, dispatch_id: dispatchId, event } = {}) => {
    if (!storyId || !runId || !dispatchId || !event) {
      throw new TypeError('Codex completion ingestion requires story_id, run_id, dispatch_id, and event');
    }
    const run = await session.status(repoRoot, { storyId, runId });
    const dispatch = run.runtime_dispatches?.find((item) => item.dispatch_id === dispatchId);
    if (!dispatch) throw new Error(`runtime dispatch not found: ${dispatchId}`);
    if (event.dispatch_id !== dispatchId || event.provider_run_id !== dispatch.provider_run_id) {
      throw new Error('Codex completion ingestion identity does not match the persisted dispatch authority');
    }
    const persistedEvent = await adapter.ingestCompletion({ dispatch, providerEvent: event });
    const resumed = await resumeFromWake({ story_id: storyId, run_id: runId, dispatch_id: dispatchId });
    return { event: persistedEvent, resumed };
  };
  if (typeof host?.registerResumeHandler !== 'function') {
    throw new TypeError('Codex host must implement registerResumeHandler for push resume delivery');
  }
  const ready = Promise.resolve(host.registerResumeHandler({ resume: resumeFromWake }));
  return Object.freeze({ inbox, adapter, coordinator, session, resumeFromWake, ingestCompletion, ready });
}
