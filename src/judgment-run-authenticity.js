import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

export const JUDGMENT_RUN_ID_PATTERN = /^judgment-\d{14}-[0-9a-f]{8}$/;
export const JUDGMENT_RUN_ID_OVERRIDE_ENV = 'VIBEPRO_ALLOW_JUDGMENT_RUN_ID';

export function resolveJudgmentPrepareRunId(requestedRunId, env = process.env, buildRunId) {
  if (requestedRunId === undefined || requestedRunId === null) return buildRunId();
  const runId = String(requestedRunId).trim();
  if (!runId) return buildRunId();
  assertJudgmentRunIdOverride(runId, env);
  return runId;
}

export function assertJudgmentRunIdOverride(runId, env = process.env) {
  if (env?.[JUDGMENT_RUN_ID_OVERRIDE_ENV] !== '1') {
    throw new Error(
      `judgment prepare refuses --run-id ${runId}. Omit --run-id so VibePro generates a genuine run id matching ${JUDGMENT_RUN_ID_PATTERN}. `
      + `Tests may set ${JUDGMENT_RUN_ID_OVERRIDE_ENV}=1.`
    );
  }
  assertGenuineJudgmentRunId(runId);
}

export function assertGenuineJudgmentRunId(runId) {
  if (!JUDGMENT_RUN_ID_PATTERN.test(String(runId ?? ''))) {
    throw new Error(
      `Judgment run_id ${runId} is not genuine. Expected ${JUDGMENT_RUN_ID_PATTERN}. `
      + 'Hand-made ids such as judgment-20261014080730-operator are refused.'
    );
  }
}

export function judgmentLineageSha256(input) {
  return sha256(JSON.stringify({
    schema_version: input?.schema_version ?? null,
    story_id: input?.story_id ?? null,
    run_id: input?.run_id ?? null,
    parent_run_id: input?.parent_run_id ?? null,
    goal: input?.goal ?? null
  }));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeWorkspaceRelative(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function sourceInputStaysInsideVibepro(sourceInput) {
  const normalized = normalizeWorkspaceRelative(sourceInput);
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  const parts = normalized.split('/');
  if (parts.includes('..')) return false;
  return normalized === '.vibepro' || normalized.startsWith('.vibepro/');
}

export async function assertJudgmentSourceInsideVibepro(repoRoot, inputPath) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(inputPath);
  const relative = normalizeWorkspaceRelative(path.relative(root, absolute));
  if (!sourceInputStaysInsideVibepro(relative)) {
    throw new Error(
      `Judgment source_input must stay inside .vibepro/. Refusing ${relative || absolute}.`
    );
  }
  const vibeproRoot = path.join(root, '.vibepro');
  try {
    const [realFile, realVibepro] = await Promise.all([realpath(absolute), realpath(vibeproRoot)]);
    const escaped = path.relative(realVibepro, realFile);
    if (escaped.startsWith('..') || path.isAbsolute(escaped)) {
      throw new Error(
        `Judgment source_input must stay inside .vibepro/. Refusing ${relative}, which resolves outside .vibepro/.`
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return relative;
}
