import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TOOL_TIMEOUT_MS = 120000;
const MAX_BUFFER = 1024 * 1024 * 8;
const SCORECARD_REVIEW_THRESHOLD = 7;

export async function scanOssReadiness(repoRoot, options = {}) {
  const root = repoRoot;
  const env = options.env ?? process.env;
  const repoUrl = await resolveGithubRepoUrl(root, env);
  const tools = [];
  const findings = [];

  const gitleaks = await runGitleaks(root, env);
  tools.push(gitleaks.tool);
  findings.push(...gitleaks.findings);

  const scorecard = await runScorecard(root, env, repoUrl);
  tools.push(scorecard.tool);
  findings.push(...scorecard.findings);

  const syft = await runSyft(root, env);
  tools.push(syft.tool);
  findings.push(...syft.findings);

  const grype = await runGrype(root, env);
  tools.push(grype.tool);
  findings.push(...grype.findings);

  const reuse = await runReuse(root, env);
  tools.push(reuse.tool);
  findings.push(...reuse.findings);

  const riskSummary = summarizeFindings(findings);
  return {
    schema_version: '0.1.0',
    status: statusFromToolsAndFindings(tools, riskSummary),
    summary: {
      tool_count: tools.length,
      pass: tools.filter((tool) => tool.status === 'pass').length,
      needs_setup: tools.filter((tool) => tool.status === 'needs_setup').length,
      needs_review: tools.filter((tool) => tool.status === 'needs_review').length,
      fail: tools.filter((tool) => tool.status === 'fail').length,
      findings: findings.length
    },
    tools,
    findings,
    risk_summary: {
      findings: riskSummary
    }
  };
}

async function runGitleaks(root, env) {
  const command = 'gitleaks detect --source . --report-format json --no-banner';
  const result = await runTool('gitleaks', ['detect', '--source', '.', '--report-format', 'json', '--no-banner'], { cwd: root, env });
  if (result.missing) return missingTool('gitleaks', command, 'Install gitleaks and rerun `vibepro check oss-readiness <repo>`.');
  if (!result.ok && !result.stdout.trim()) return unusableTool('gitleaks', command, result);

  const parsed = parseToolJson('gitleaks', command, result);
  if (parsed.error) return parsed.error;
  const leaks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.findings) ? parsed.findings : [];
  const findings = leaks.map((leak, index) => ({
    id: `oss_readiness.gitleaks.secret.${leak.RuleID ?? leak.rule_id ?? index + 1}`,
    severity: 'critical',
    gate_effect: 'block',
    path: leak.File ?? leak.file ?? '',
    detail: `Gitleaks detected a secret candidate (${leak.RuleID ?? leak.Description ?? 'unknown rule'}). Secret value was redacted by VibePro.`,
    required_action: 'Remove the secret, rotate the credential if it was real, and record any false positive as a VibePro decision artifact.',
    line: leak.StartLine ?? leak.Line ?? leak.line ?? null
  }));
  return {
    tool: {
      id: 'gitleaks',
      label: 'Gitleaks secret scan',
      status: findings.length > 0 ? 'fail' : 'pass',
      command,
      summary: findings.length > 0 ? `${findings.length} secret candidates` : 'No secret candidates reported'
    },
    findings
  };
}

async function runScorecard(root, env, repoUrl) {
  const command = repoUrl
    ? `scorecard --repo ${repoUrl} --format json`
    : 'scorecard --repo <github-repo> --format json';
  if (!repoUrl) {
    return {
      tool: {
        id: 'scorecard',
        label: 'OpenSSF Scorecard',
        status: 'needs_setup',
        command,
        summary: 'GitHub origin URL could not be resolved',
        setup: {
          required: true,
          next_commands: ['Set a GitHub origin remote, then rerun `vibepro check oss-readiness <repo>`.']
        }
      },
      findings: [setupFinding('scorecard.repo_url_missing', 'OpenSSF Scorecard needs a GitHub repository URL.', 'Configure a GitHub origin remote or run Scorecard separately and attach the result.')]
    };
  }
  const result = await runTool('scorecard', ['--repo', repoUrl, '--format', 'json'], { cwd: root, env });
  if (result.missing) return missingTool('scorecard', command, 'Install OpenSSF Scorecard and rerun `vibepro check oss-readiness <repo>`.');
  if (!result.ok && !result.stdout.trim()) return unusableTool('scorecard', command, result);

  const parsed = parseToolJson('scorecard', command, result);
  if (parsed.error) return parsed.error;
  const score = Number(parsed?.score ?? parsed?.Score);
  const checks = Array.isArray(parsed?.checks) ? parsed.checks : Array.isArray(parsed?.Checks) ? parsed.Checks : [];
  const findings = [];
  if (Number.isFinite(score) && score < SCORECARD_REVIEW_THRESHOLD) {
    findings.push({
      id: 'oss_readiness.scorecard.low_score',
      severity: 'medium',
      gate_effect: 'review',
      detail: `OpenSSF Scorecard score is ${score}; threshold is ${SCORECARD_REVIEW_THRESHOLD}.`,
      required_action: 'Review low-scoring Scorecard checks before OSS publication.'
    });
  }
  for (const check of checks) {
    const checkScore = Number(check.score ?? check.Score);
    if (!Number.isFinite(checkScore) || checkScore >= 0) continue;
    findings.push({
      id: `oss_readiness.scorecard.negative.${slug(check.name ?? check.Name ?? 'check')}`,
      severity: 'medium',
      gate_effect: 'review',
      detail: `Scorecard check ${check.name ?? check.Name ?? 'unknown'} returned ${checkScore}.`,
      required_action: 'Inspect the Scorecard check detail and decide whether to fix or waive it.'
    });
  }
  return {
    tool: {
      id: 'scorecard',
      label: 'OpenSSF Scorecard',
      status: findings.length > 0 ? 'needs_review' : 'pass',
      command,
      summary: Number.isFinite(score) ? `score=${score}` : 'Scorecard completed'
    },
    findings
  };
}

async function runSyft(root, env) {
  const command = 'syft . -o cyclonedx-json';
  const result = await runTool('syft', ['.', '-o', 'cyclonedx-json'], { cwd: root, env });
  if (result.missing) return missingTool('syft', command, 'Install syft and rerun `vibepro check oss-readiness <repo>`.');
  if (!result.ok && !result.stdout.trim()) return unusableTool('syft', command, result);

  const parsed = parseToolJson('syft', command, result);
  if (parsed.error) return parsed.error;
  const components = Array.isArray(parsed?.components) ? parsed.components : Array.isArray(parsed?.artifacts) ? parsed.artifacts : [];
  return {
    tool: {
      id: 'syft',
      label: 'Syft SBOM generation',
      status: 'pass',
      command,
      summary: `${components.length} SBOM components`
    },
    findings: []
  };
}

async function runGrype(root, env) {
  const command = 'grype . -o json';
  const result = await runTool('grype', ['.', '-o', 'json'], { cwd: root, env });
  if (result.missing) return missingTool('grype', command, 'Install grype and rerun `vibepro check oss-readiness <repo>`.');
  if (!result.ok && !result.stdout.trim()) return unusableTool('grype', command, result);

  const parsed = parseToolJson('grype', command, result);
  if (parsed.error) return parsed.error;
  const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
  const findings = matches.map((match, index) => {
    const vulnerability = match.vulnerability ?? {};
    const artifact = match.artifact ?? {};
    const severity = normalizeSeverity(vulnerability.severity);
    return {
      id: `oss_readiness.grype.${slug(vulnerability.id ?? `vulnerability-${index + 1}`)}`,
      severity: grypeSeverityToFindingSeverity(severity),
      gate_effect: grypeSeverityToGateEffect(severity),
      path: artifact.name ?? '',
      detail: `${vulnerability.id ?? 'Unknown vulnerability'} in ${artifact.name ?? 'unknown artifact'} (${severity}).`,
      required_action: severity === 'critical' || severity === 'high'
        ? 'Upgrade or remove the vulnerable dependency before OSS publication, or record a non-critical waiver with evidence.'
        : 'Review the vulnerable dependency and record the accepted risk or fix.'
    };
  });
  return {
    tool: {
      id: 'grype',
      label: 'Grype vulnerability scan',
      status: statusFromFindings(findings),
      command,
      summary: `${matches.length} vulnerability matches`
    },
    findings
  };
}

async function runReuse(root, env) {
  const command = 'reuse lint --json';
  const result = await runTool('reuse', ['lint', '--json'], { cwd: root, env });
  if (result.missing) return missingTool('reuse', command, 'Install reuse and rerun `vibepro check oss-readiness <repo>`.');
  if (!result.ok && !result.stdout.trim()) return unusableTool('reuse', command, result);

  const parsed = parseToolJson('reuse', command, result);
  if (parsed.error) return parsed.error;
  const compliant = parsed?.compliant === true || parsed?.summary?.compliant === true;
  const badFiles = [
    ...asArray(parsed?.files_without_copyright),
    ...asArray(parsed?.files_without_license),
    ...asArray(parsed?.bad_licenses)
  ].filter(Boolean);
  const findings = compliant || badFiles.length === 0
    ? []
    : badFiles.slice(0, 50).map((file, index) => ({
        id: `oss_readiness.reuse.non_compliant.${index + 1}`,
        severity: 'medium',
        gate_effect: 'review',
        path: typeof file === 'string' ? file : file.path ?? '',
        detail: 'REUSE reported missing or invalid license/copyright metadata.',
        required_action: 'Add machine-readable license and copyright metadata, or record an explicit waiver.'
      }));
  if (!compliant && findings.length === 0) {
    findings.push({
      id: 'oss_readiness.reuse.non_compliant',
      severity: 'medium',
      gate_effect: 'review',
      detail: 'REUSE reported the repository as non-compliant.',
      required_action: 'Run `reuse lint` locally and fix or waive the reported license metadata gaps.'
    });
  }
  return {
    tool: {
      id: 'reuse',
      label: 'REUSE license metadata',
      status: findings.length > 0 ? 'needs_review' : 'pass',
      command,
      summary: findings.length > 0 ? `${findings.length} license metadata findings` : 'REUSE compliant'
    },
    findings
  };
}

async function runTool(command, args, options) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER
    });
    return { ok: true, stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: 0 };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, missing: true, stdout: '', stderr: '', exitCode: null };
    }
    return {
      ok: false,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? error.message ?? ''),
      exitCode: typeof error.code === 'number' ? error.code : null
    };
  }
}

async function resolveGithubRepoUrl(root, env) {
  const result = await runTool('git', ['config', '--get', 'remote.origin.url'], { cwd: root, env });
  const remote = result.stdout.trim();
  if (!remote) return null;
  const https = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/);
  if (https) return `github.com/${https[1]}`;
  const ssh = remote.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/);
  if (ssh) return `github.com/${ssh[1]}`;
  return null;
}

function missingTool(id, command, guidance) {
  return {
    tool: {
      id,
      label: labelForTool(id),
      status: 'needs_setup',
      command,
      summary: `${id} is not installed or not on PATH`,
      setup: {
        required: true,
        next_commands: [guidance]
      }
    },
    findings: [setupFinding(`${id}.missing`, `${id} is not installed or not on PATH.`, guidance)]
  };
}

function unusableTool(id, command, result) {
  return {
    tool: {
      id,
      label: labelForTool(id),
      status: 'needs_setup',
      command,
      summary: `${id} failed before producing usable JSON`
    },
    findings: [{
      id: `oss_readiness.${id}.execution_failed`,
      severity: 'medium',
      gate_effect: 'review',
      detail: `${id} failed before producing usable JSON. stderr: ${redact(String(result.stderr ?? '')).slice(0, 500)}`,
      required_action: `Run \`${command}\` locally, fix tool setup or repository issues, and rerun VibePro.`
    }]
  };
}

function parseToolJson(id, command, result) {
  const parsed = parseJson(result.stdout);
  return parsed === null ? { error: unusableTool(id, command, result) } : parsed;
}

function setupFinding(id, detail, requiredAction) {
  return {
    id: `oss_readiness.setup.${id}`,
    severity: 'medium',
    gate_effect: 'review',
    detail,
    required_action: requiredAction
  };
}

function summarizeFindings(findings) {
  const summary = { block: 0, review: 0, info: 0 };
  for (const finding of findings) {
    const effect = ['block', 'review', 'info'].includes(finding.gate_effect) ? finding.gate_effect : 'info';
    summary[effect] += 1;
  }
  return summary;
}

function statusFromToolsAndFindings(tools, riskSummary) {
  if ((riskSummary.block ?? 0) > 0 || tools.some((tool) => tool.status === 'fail')) return 'fail';
  if (tools.some((tool) => tool.status === 'needs_setup')) return 'needs_setup';
  if ((riskSummary.review ?? 0) > 0 || tools.some((tool) => tool.status === 'needs_review')) return 'needs_review';
  return 'pass';
}

function statusFromFindings(findings) {
  const summary = summarizeFindings(findings);
  if (summary.block > 0) return 'fail';
  if (summary.review > 0) return 'needs_review';
  return 'pass';
}

function grypeSeverityToGateEffect(severity) {
  if (severity === 'critical' || severity === 'high') return 'block';
  if (severity === 'medium') return 'review';
  return 'info';
}

function grypeSeverityToFindingSeverity(severity) {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
}

function normalizeSeverity(value) {
  const severity = String(value ?? 'unknown').toLowerCase();
  return ['critical', 'high', 'medium', 'low', 'negligible', 'unknown'].includes(severity) ? severity : 'unknown';
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function labelForTool(id) {
  return {
    gitleaks: 'Gitleaks secret scan',
    scorecard: 'OpenSSF Scorecard',
    syft: 'Syft SBOM generation',
    grype: 'Grype vulnerability scan',
    reuse: 'REUSE license metadata'
  }[id] ?? id;
}

function redact(value) {
  return value
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/g, 'sk-REDACTED')
    .replace(/([A-Za-z0-9_-]*(?:token|secret|key)[A-Za-z0-9_-]*\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
}
