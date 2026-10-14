import { createHmac, timingSafeEqual } from 'node:crypto';

export const JUDGMENT_RECEIPT_HMAC_ENV = 'VIBEPRO_JUDGMENT_RECEIPT_HMAC_KEY';
export const JUDGMENT_PR_NUMBER_ENV = 'VIBEPRO_JUDGMENT_PR_NUMBER';

const RECEIPT_HMAC_MIN_CHARS = 32;

const RECEIPT_SIGNED_KEYS = Object.freeze([
  'schema_version',
  'story_id',
  'run_id',
  'artifact',
  'input_sha256',
  'lineage_sha256',
  'source_head_sha',
  'pr_number',
  'feedback',
  'prepared_at',
  'advisory',
  'blocking'
]);

const ADOPTION_SIGNED_KEYS = Object.freeze([
  'schema_version',
  'story_id',
  'run_id',
  'source_input',
  'adopted_input',
  'input_sha256',
  'reviewed_by',
  'authority',
  'review_summary',
  'pr_number',
  'source_head_sha',
  'problem_frame_status',
  'active_axes',
  'option_count',
  'adopted_at',
  'artifact',
  'advisory',
  'blocking'
]);

export function requireJudgmentReceiptKey(env = process.env) {
  const key = env?.[JUDGMENT_RECEIPT_HMAC_ENV];
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error(
      `Judgment receipt key is missing. Set ${JUDGMENT_RECEIPT_HMAC_ENV} from Infisical (https://infisical.unson.jp). `
      + 'vibepro judgment prepare, adopt, evaluate, and audit refuse without it.'
    );
  }
  if (key.length < RECEIPT_HMAC_MIN_CHARS) {
    throw new Error(
      `${JUDGMENT_RECEIPT_HMAC_ENV} must be at least ${RECEIPT_HMAC_MIN_CHARS} characters. `
      + 'Store it in Infisical (https://infisical.unson.jp). The value is not created or printed here.'
    );
  }
  return key;
}

export function resolveJudgmentPrNumber(env = process.env) {
  const explicit = String(env?.[JUDGMENT_PR_NUMBER_ENV] ?? '').trim();
  if (/^[1-9][0-9]*$/.test(explicit)) return Number(explicit);
  const ref = String(env?.GITHUB_REF ?? '');
  const match = ref.match(/^refs\/pull\/([1-9][0-9]*)(?:\/|$)/);
  if (match) return Number(match[1]);
  throw new Error(
    `Judgment receipt requires a pull request number. Set ${JUDGMENT_PR_NUMBER_ENV} to the PR that owns this head. `
    + 'A receipt prepared for another PR is refused.'
  );
}

function macPayload(record, keys) {
  const payload = {};
  for (const key of keys) payload[key] = canonicalize(record?.[key] ?? null);
  return JSON.stringify(payload);
}

function hmacHex(record, keys, env) {
  const key = requireJudgmentReceiptKey(env);
  return createHmac('sha256', key).update(macPayload(record, keys)).digest('hex');
}

function hmacMatches(actual, expected) {
  const actualBuf = Buffer.from(String(actual ?? ''));
  const expectedBuf = Buffer.from(expected);
  return actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf);
}

export function sealJudgmentReceipt(record, env = process.env) {
  return { ...record, receipt_hmac: hmacHex(record, RECEIPT_SIGNED_KEYS, env) };
}

export function sealJudgmentAdoption(record, env = process.env) {
  return { ...record, adoption_hmac: hmacHex(record, ADOPTION_SIGNED_KEYS, env) };
}

export function assertJudgmentReceiptMac(record, env = process.env) {
  const expected = hmacHex(record, RECEIPT_SIGNED_KEYS, env);
  if (!hmacMatches(record?.receipt_hmac, expected)) {
    throw new Error(
      'Judgment draft receipt signature is not valid. Hand-made receipts are refused. '
      + 'Only `vibepro judgment prepare` can create a receipt.'
    );
  }
}

export function assertJudgmentAdoptionMac(record, env = process.env) {
  const expected = hmacHex(record, ADOPTION_SIGNED_KEYS, env);
  if (!hmacMatches(record?.adoption_hmac, expected)) {
    throw new Error(
      'Judgment adoption signature is not valid. A rewritten adoption, including reviewed_by, is refused. '
      + 'Only `vibepro judgment input adopt` can create an adoption record.'
    );
  }
}

export function assertJudgmentReceiptContext(receipt, { env = process.env, headSha } = {}) {
  assertJudgmentReceiptMac(receipt, env);
  const prNumber = resolveJudgmentPrNumber(env);
  if (receipt?.pr_number !== prNumber) {
    throw new Error(
      `Judgment draft receipt was prepared for PR ${receipt?.pr_number ?? 'missing'} and cannot be used on PR ${prNumber}.`
    );
  }
  if (!headSha || receipt?.source_head_sha !== headSha) {
    throw new Error(
      `Judgment draft receipt was prepared at head ${receipt?.source_head_sha ?? 'missing'} and cannot be used at head ${headSha || 'missing'}.`
    );
  }
}

export function parseReviewedByActor(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(human|agent):([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/);
  if (!match) {
    throw new Error(
      'judgment input adopt --reviewed-by must be human:<id> or agent:<id> so the actor kind is mechanically checkable. '
      + `Refusing ${JSON.stringify(text)}.`
    );
  }
  return { kind: match[1], id: match[2] };
}

export function reviewedByIsMechanicallyCheckable(value) {
  if (!value || typeof value !== 'object') return false;
  return (value.kind === 'human' || value.kind === 'agent')
    && typeof value.id === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id);
}

export function formatReviewedByActor(value) {
  if (value && typeof value === 'object' && value.kind && value.id) return `${value.kind}:${value.id}`;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '-';
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) normalized[key] = canonicalize(value[key]);
    return normalized;
  }
  return value;
}
