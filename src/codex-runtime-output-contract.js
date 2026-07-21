const MAX_PROMPT_TEXT = 64 * 1024;

export function buildCodexRuntimePrompt(request) {
  const binding = request.review_binding;
  const inspectionInputs = binding?.inspection_inputs ?? [];
  const judgments = request.requested_judgments ?? [];
  const prompt = [
    'You are a read-only Codex subagent executing a VibePro runtime dispatch.',
    `Story: ${request.story_id}`,
    `Logical task: ${request.task_id}`,
    `Role: ${request.role}`,
    `Inspection surface hash: ${request.inspection_surface_hash}`,
    `Input HEAD: ${request.input_head_sha}`,
    binding ? `Review stage/role: ${binding.stage}/${binding.role}` : null,
    inspectionInputs.length > 0 ? `Inspect these inputs: ${inspectionInputs.join(', ')}` : null,
    judgments.length > 0 ? `Complete only these unfinished judgments: ${judgments.map((item) => item.judgment_id).join(', ')}` : null,
    '',
    'Inspect the repository and run only read-only verification. Do not edit files, commit, push, approve, merge, or change external state.',
    'Return only the JSON object required by the supplied output schema. Findings must be evidence-backed.',
    'For review_record.inspection_evidence, use bounded file paths, commands, or artifact references; never include credentials or a raw transcript.'
  ].filter((line) => line !== null).join('\n');
  if (Buffer.byteLength(prompt) > MAX_PROMPT_TEXT) throw new Error('Codex runtime prompt exceeds 64 KiB');
  return prompt;
}

export function codexRuntimeOutputSchema(request) {
  const finding = {
    type: 'object', additionalProperties: false,
    required: ['id', 'severity', 'detail'],
    properties: {
      id: boundedString(256), severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, detail: boundedString(4096)
    }
  };
  const judgment = {
    type: 'object', additionalProperties: false,
    required: ['judgment_id', 'verdict'],
    properties: { judgment_id: boundedString(256), verdict: boundedString(64), detail: boundedString(4096) }
  };
  const properties = {
    summary: boundedString(8192),
    test_suggestions: { type: 'array', maxItems: 64, items: boundedString(1024) },
    judgments: { type: 'array', maxItems: 128, items: judgment }
  };
  const required = ['summary', 'test_suggestions', 'judgments'];
  if (request.role === 'review' && request.review_binding) {
    properties.review_record = {
      type: 'object', additionalProperties: false,
      required: ['status', 'summary', 'findings', 'inspection_summary', 'inspection_evidence', 'judgment_deltas'],
      properties: {
        status: { type: 'string', enum: ['pass', 'needs_changes', 'block'] },
        summary: boundedString(8192), findings: { type: 'array', maxItems: 64, items: finding },
        inspection_summary: boundedString(8192), inspection_evidence: boundedString(8192),
        judgment_deltas: { type: 'array', minItems: 1, maxItems: 128, items: boundedString(4096) }
      }
    };
    required.push('review_record');
  }
  return { type: 'object', additionalProperties: false, required, properties };
}

export function toCodexCompletionResult(request, started, output) {
  return {
    completion_status: 'completed',
    changed_files: [],
    head_sha: request.input_head_sha,
    test_suggestions: output.test_suggestions,
    summary: output.summary,
    agent_identity: request.reviewer_identity ?? started.agent_identity,
    thread_id: started.thread_id,
    lifecycle: 'closed',
    judgments: output.judgments,
    ...(output.review_record ? { review_record: output.review_record } : {})
  };
}

function boundedString(maxLength) {
  return { type: 'string', minLength: 1, maxLength };
}
