// Resolve which MUST-HAVE design diagrams a change requires.
// Inputs: { story: { ac_count, ac_keywords }, code_diff: { files, deps_added } }
// Output: { required_diagrams: [...kind], reasons: [{ kind, signal }] }
// Each rule is pure and order-independent. See docs/specs/vibepro-must-have-diagram-gate.md.

const QUEUE_DEPS = new Set([
  'bullmq', 'bull', 'kafkajs', 'nats', '@aws-sdk/client-sqs', 'amqplib', 'redis-streams'
]);
const STREAM_DEPS = new Set([
  'kafkajs', '@aws-sdk/client-kinesis', 'nats', 'inngest', '@trigger.dev/sdk', 'temporal', '@temporalio/client'
]);
const THIRD_PARTY_PREFIXES = [
  'stripe', 'twilio', 'sendgrid', '@slack/', '@google-cloud/', '@aws-sdk/', '@azure/', 'octokit', '@octokit/'
];
const SECURITY_DEPS = new Set([
  'bcrypt', 'argon2', 'jose', 'passport', 'next-auth', '@auth/', 'stripe', 'jsonwebtoken'
]);
const PII_KEYWORDS = ['email', 'phone', 'ssn', 'tax_id', 'dob', 'address', 'payment', 'credit_card'];
const SECURITY_PATH_KEYWORDS = ['auth', 'login', 'oauth', 'session', 'jwt', 'password', 'permission', 'policy', 'rbac', 'acl'];
const RESPONSIBILITY_AUTHORITY_PATH = /^docs\/responsibility-authority\/.+\.json$/;
const CONTRACT_ARTIFACT_PATH = /^(docs\/contracts|contracts)\/.+\.json$/;
const CONTRACT_SECURITY_TERMS = [
  'authority', 'authorization', 'permission', 'policy', 'rbac', 'acl', 'security',
  'credential', 'token', 'secret', 'session', 'jwt', 'oauth', 'password',
  'access control', 'access-control', 'pii', 'personal data', 'personal-data'
];
const FLOW_KEYWORDS = ['checkout', 'onboarding', 'wizard', 'multi-step', 'flow', 'purchase', 'signup'];
const IAC_EXT = /\.(tf|tfvars)$/;
const IAC_PATH = /^(infra|pulumi|terraform)\//;
const DEPLOY_CONFIGS = new Set(['fly.toml', 'vercel.json', 'serverless.yml', 'serverless.yaml', 'wrangler.toml']);
const K8S_KIND_RE = /kind:\s*(Deployment|StatefulSet|DaemonSet|Service|Ingress|CronJob)/;

export function resolveRequiredDiagrams(input) {
  const story = input?.story ?? { ac_count: 0, ac_keywords: [] };
  const codeDiff = input?.code_diff ?? { files: [], deps_added: [] };
  const files = Array.isArray(codeDiff.files) ? codeDiff.files : [];
  const deps = Array.isArray(codeDiff.deps_added) ? codeDiff.deps_added : [];

  const reasons = [];
  const add = (kind, signal) => reasons.push({ kind, signal });

  for (const rule of RULES) rule({ story, files, deps, add });

  const required_diagrams = [...new Set(reasons.map((r) => r.kind))];
  return { required_diagrams, reasons };
}

const RULES = [
  // R1: ER for schema changes
  ({ files, add }) => {
    for (const f of files) {
      const p = f.path ?? '';
      if (p === 'prisma/schema.prisma' || /^prisma\/schema\.prisma$/.test(p)) {
        add('er', `schema file modified: ${p}`);
        return;
      }
      if (/^db\/migrations\//.test(p) || /^migrations\//.test(p)) {
        add('er', `migration added: ${p}`);
        return;
      }
      if (/\.sql$/.test(p)) {
        const content = f.content ?? '';
        if (/CREATE\s+TABLE|ALTER\s+TABLE/i.test(content) || !content) {
          add('er', `SQL file changed: ${p}`);
          return;
        }
      }
    }
  },

  // R2: state machine for status / state changes
  ({ files, add }) => {
    for (const f of files) {
      const p = f.path ?? '';
      const c = f.content ?? '';
      if (/xstate|state-machine|workflow/i.test(p)) {
        add('state', `state machine file: ${p}`);
        return;
      }
      if (/enum\s+\w*(Status|State)\b/.test(c) || /\b(status|state)\s+\w*Enum\b/i.test(c)) {
        add('state', `status/state enum in ${p}`);
        return;
      }
      if (/model\s+\w+\s*\{[^}]*\b(status|state)\b\s+\w+/m.test(c)) {
        add('state', `status/state field declared in ${p}`);
        return;
      }
    }
  },

  // R3: sequence for inter-actor messaging
  ({ files, deps, add }) => {
    for (const f of files) {
      const p = f.path ?? '';
      if (/\/webhook(s)?\//.test(p) || /webhook\.[tj]sx?$/.test(p)) {
        add('sequence', `webhook route: ${p}`);
        return;
      }
    }
    for (const d of deps) {
      if (QUEUE_DEPS.has(d)) {
        add('sequence', `queue/messaging dep added: ${d}`);
        return;
      }
      if (THIRD_PARTY_PREFIXES.some((prefix) => d === prefix || d.startsWith(prefix))) {
        add('sequence', `3rd party SDK added: ${d}`);
        return;
      }
    }
  },

  // R4: flow for multi-step user workflows
  ({ story, files, add }) => {
    const keywords = Array.isArray(story.ac_keywords) ? story.ac_keywords : [];
    const acCount = Number(story.ac_count ?? 0);
    if (acCount >= 3 && keywords.some((k) => FLOW_KEYWORDS.includes(String(k).toLowerCase()))) {
      add('flow', `Story.AC count ${acCount} with workflow keyword`);
      return;
    }
    for (const f of files) {
      const p = (f.path ?? '').toLowerCase();
      if (/\/(checkout|onboarding|wizard)\//.test(p)) {
        add('flow', `workflow path: ${f.path}`);
        return;
      }
    }
  },

  // R5: C4 context for new service boundaries
  ({ files, add }) => {
    for (const f of files) {
      const p = f.path ?? '';
      if (f.status === 'added' && /^packages\/[^/]+\/package\.json$/.test(p)) {
        add('c4_context', `new package boundary: ${p}`);
        return;
      }
      if (f.status === 'added' && /^services\/[^/]+\//.test(p)) {
        add('c4_context', `new service directory: ${p}`);
        return;
      }
    }
  },

  // R6: deployment for IaC changes
  ({ files, add }) => {
    for (const f of files) {
      const p = f.path ?? '';
      if (IAC_EXT.test(p) || IAC_PATH.test(p)) {
        add('deployment', `IaC file: ${p}`);
        return;
      }
      if (DEPLOY_CONFIGS.has(p)) {
        add('deployment', `deploy config: ${p}`);
        return;
      }
      if (/\.ya?ml$/.test(p) && K8S_KIND_RE.test(f.content ?? '')) {
        add('deployment', `k8s manifest: ${p}`);
        return;
      }
    }
  },

  // R7: threat model for security-sensitive changes
  ({ files, deps, add }) => {
    let explicitArtifactTrigger = false;
    for (const f of files) {
      const p = (f.path ?? '').toLowerCase();
      const content = String(f.content ?? '').toLowerCase();
      if (RESPONSIBILITY_AUTHORITY_PATH.test(p)) {
        add('threat_model', `responsibility authority artifact: ${f.path}`);
        explicitArtifactTrigger = true;
        continue;
      }
      if (
        CONTRACT_ARTIFACT_PATH.test(p)
        && (
          CONTRACT_SECURITY_TERMS.some((term) => content.includes(term))
          || SECURITY_PATH_KEYWORDS.some((kw) => p.includes(kw))
        )
      ) {
        add('threat_model', `security-sensitive contract artifact: ${f.path}`);
        explicitArtifactTrigger = true;
      }
    }
    if (explicitArtifactTrigger) return;
    for (const f of files) {
      const p = (f.path ?? '').toLowerCase();
      const content = String(f.content ?? '').toLowerCase();
      if (
        CONTRACT_ARTIFACT_PATH.test(p)
        && SECURITY_PATH_KEYWORDS.some((kw) => p.includes(kw))
      ) {
        add('threat_model', `security-sensitive contract artifact: ${f.path}`);
        return;
      }
      if (SECURITY_PATH_KEYWORDS.some((kw) => p.includes(kw))) {
        add('threat_model', `security-sensitive path: ${f.path}`);
        return;
      }
      if (PII_KEYWORDS.some((kw) => content.includes(kw))) {
        add('threat_model', `PII column hint in ${f.path}`);
        return;
      }
    }
    for (const d of deps) {
      if (SECURITY_DEPS.has(d) || THIRD_PARTY_PREFIXES.some((prefix) => d === prefix && (prefix === 'stripe'))) {
        add('threat_model', `security/payment dep added: ${d}`);
        return;
      }
    }
  },

  // R8: DFD for async pipelines
  ({ files, deps, add }) => {
    for (const f of files) {
      const p = (f.path ?? '').toLowerCase();
      if (/(^|\/)cron(\/|$|s?\.)/.test(p) || /\/(pipeline|etl|ingest|stream)\//.test(p)) {
        add('dfd', `async pipeline path: ${f.path}`);
        return;
      }
    }
    for (const d of deps) {
      if (STREAM_DEPS.has(d)) {
        add('dfd', `stream/event dep added: ${d}`);
        return;
      }
    }
  }
];
