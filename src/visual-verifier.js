import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { runFlowVerification, resolveFlowProbes, resolveStory } from './flow-verifier.js';
import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { collectGitContext } from './git-fingerprint.js';

const DEFAULT_THRESHOLD_PCT = 5;

export async function runVisualVerification(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const story = resolveStory(config, options.storyId);
  const storyId = options.storyId ?? story?.story_id ?? null;
  const probes = resolveFlowProbes({
    config,
    manifest,
    story,
    journeyId: options.journeyId
  });
  const thresholdPct = Number.isFinite(options.thresholdPct) ? options.thresholdPct : DEFAULT_THRESHOLD_PCT;
  const qaId = options.qaId ?? storyId ?? `visual-${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')}`;
  const qaDir = path.join(getWorkspaceDir(root), 'qa', qaId);
  const baselineDir = path.join(getWorkspaceDir(root), 'qa', 'baseline');
  await mkdir(qaDir, { recursive: true });
  await mkdir(baselineDir, { recursive: true });

  const flowResult = options.baseUrl
    ? await runFlowVerification(root, {
        baseUrl: options.baseUrl,
        storyId,
        runId: options.runId,
        journeyId: options.journeyId,
        allowMutation: options.allowMutation,
        headed: options.headed,
        basicAuth: options.basicAuth,
        basicAuthEnv: options.basicAuthEnv,
        env: options.env
      })
    : null;

  const currentScreenshots = await resolveCurrentScreenshots(root, {
    probes,
    currentDir: options.currentDir,
    flowResult,
    manifest: await readManifest(root)
  });
  const probeResults = [];
  for (const probe of probes) {
    const screenshot = currentScreenshots.get(probe.id) ?? null;
    const baselinePath = path.join(baselineDir, `${safeFileName(probe.id)}.png`);
    const result = await compareProbeScreenshot(root, {
      probe,
      screenshot,
      baselinePath,
      updateBaseline: options.updateBaseline === true
    });
    probeResults.push(result);
  }

  const residualValues = probeResults
    .map((probe) => probe.meanAbsResidualPct)
    .filter((value) => typeof value === 'number');
  const meanAbsResidualPct = probeResults.some((probe) => probe.status === 'baseline_missing' || probe.status === 'current_missing')
    ? 100
    : residualValues.length > 0
      ? Math.max(...residualValues)
      : 100;
  const status = probeResults.length === 0
    ? 'needs_evidence'
    : probeResults.some((probe) => probe.status === 'baseline_missing')
      ? 'baseline_missing'
      : probeResults.some((probe) => probe.status === 'current_missing')
        ? 'needs_evidence'
        : meanAbsResidualPct <= thresholdPct
          ? 'pass'
          : 'needs_review';
  const createdAt = new Date().toISOString();
  const report = {
    schema_version: '0.1.0',
    artifact_kind: 'visual_residual',
    qa_id: qaId,
    story_id: storyId,
    created_at: createdAt,
    status,
    thresholdPct,
    meanAbsResidualPct,
    probes: probeResults,
    source: {
      current_dir: options.currentDir ? toWorkspaceRelative(root, path.resolve(root, options.currentDir)) : null,
      flow_run_id: flowResult?.verification?.run_id ?? null,
      flow_verification_json: flowResult?.artifacts?.json ?? null
    },
    git_context: await collectGitContext(root)
  };
  const jsonPath = path.join(qaDir, 'visual-residual.json');
  const markdownPath = path.join(qaDir, 'residual-analysis.md');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, renderResidualMarkdown(report));

  const nextManifest = await readManifest(root);
  nextManifest.visual_qa_runs = [
    {
      qa_id: qaId,
      story_id: storyId,
      created_at: createdAt,
      status,
      meanAbsResidualPct,
      thresholdPct,
      artifacts: {
        visual_residual_json: toWorkspaceRelative(root, jsonPath),
        residual_analysis: toWorkspaceRelative(root, markdownPath)
      }
    },
    ...(nextManifest.visual_qa_runs ?? []).filter((run) => run.qa_id !== qaId)
  ];
  await writeManifest(root, nextManifest);

  return {
    report,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    }
  };
}

export function renderVisualVerificationSummary(result) {
  return `# VibePro Visual Verification

- qa_id: ${result.report.qa_id}
- story: ${result.report.story_id ?? '-'}
- status: ${result.report.status}
- meanAbsResidualPct: ${formatPct(result.report.meanAbsResidualPct)}
- thresholdPct: ${formatPct(result.report.thresholdPct)}
- report: ${result.artifacts.markdown}
`;
}

async function resolveCurrentScreenshots(root, { probes, currentDir, flowResult, manifest }) {
  const screenshots = new Map();
  if (currentDir) {
    const absoluteDir = path.resolve(root, currentDir);
    for (const probe of probes) {
      const candidates = [
        path.join(absoluteDir, `${safeFileName(probe.id)}.png`),
        ...probe.steps
          .filter((step) => step.action === 'screenshot')
          .map((step) => path.join(absoluteDir, `${safeFileName(step.name ?? probe.id)}.png`))
      ];
      const first = await firstExistingPath(candidates);
      if (first) screenshots.set(probe.id, first);
    }
    return screenshots;
  }
  const runId = flowResult?.verification?.run_id ?? manifest.latest_flow_verification_run;
  if (!runId) return screenshots;
  const verificationPath = path.join(getWorkspaceDir(root), 'verification', runId, 'flow-verification.json');
  let verification;
  try {
    verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return screenshots;
    throw error;
  }
  for (const probe of verification.probes ?? []) {
    const screenshot = probe.artifacts?.screenshot_paths?.[0];
    if (screenshot) screenshots.set(probe.id, path.join(getWorkspaceDir(root), 'verification', runId, screenshot));
  }
  return screenshots;
}

async function compareProbeScreenshot(root, { probe, screenshot, baselinePath, updateBaseline }) {
  if (!screenshot) {
    return {
      probe_id: probe.id,
      status: 'current_missing',
      meanAbsResidualPct: null,
      current_screenshot: null,
      baseline_screenshot: toWorkspaceRelative(root, baselinePath)
    };
  }
  if (updateBaseline) await copyFile(screenshot, baselinePath);
  const baseline = await readOptionalBuffer(baselinePath);
  if (!baseline) {
    return {
      probe_id: probe.id,
      status: 'baseline_missing',
      meanAbsResidualPct: null,
      current_screenshot: toWorkspaceRelative(root, screenshot),
      baseline_screenshot: toWorkspaceRelative(root, baselinePath)
    };
  }
  let meanAbsResidualPct;
  let comparisonError = null;
  try {
    meanAbsResidualPct = calculateMeanAbsResidualPct(await readFile(screenshot), baseline);
  } catch (error) {
    meanAbsResidualPct = 100;
    comparisonError = error.message;
  }
  return {
    probe_id: probe.id,
    status: comparisonError ? 'needs_review' : updateBaseline ? 'baseline_updated' : 'compared',
    meanAbsResidualPct,
    current_screenshot: toWorkspaceRelative(root, screenshot),
    baseline_screenshot: toWorkspaceRelative(root, baselinePath),
    ...(comparisonError ? { comparison_error: comparisonError } : {})
  };
}

async function readOptionalBuffer(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function calculateMeanAbsResidualPct(current, baseline) {
  const currentPng = decodePngRgba(current);
  const baselinePng = decodePngRgba(baseline);
  if (currentPng.width !== baselinePng.width || currentPng.height !== baselinePng.height) return 100;
  const length = Math.max(currentPng.pixels.length, baselinePng.pixels.length);
  if (length === 0) return 0;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((currentPng.pixels[index] ?? 0) - (baselinePng.pixels[index] ?? 0));
  }
  return Number(((total / length / 255) * 100).toFixed(4));
}

function decodePngRgba(buffer) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(buffer) || buffer.length < pngSignature.length || !buffer.subarray(0, 8).equals(pngSignature)) {
    throw new Error('visual residual comparison requires valid PNG screenshots');
  }

  let offset = 8;
  let width = null;
  let height = null;
  let bitDepth = null;
  let colorType = null;
  let palette = null;
  const idatChunks = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error(`invalid PNG chunk length for ${type}`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('unsupported PNG compression, filter, or interlace method');
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height || bitDepth !== 8 || colorType === null || idatChunks.length === 0) {
    throw new Error('unsupported PNG screenshot format');
  }

  const channels = channelCountForColorType(colorType);
  const bytesPerPixel = channels;
  const scanlineBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const expectedLength = (scanlineBytes + 1) * height;
  if (inflated.length < expectedLength) throw new Error('truncated PNG pixel data');

  const raw = Buffer.alloc(scanlineBytes * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * (scanlineBytes + 1);
    const filterType = inflated[sourceRow];
    const targetRow = y * scanlineBytes;
    for (let x = 0; x < scanlineBytes; x += 1) {
      const value = inflated[sourceRow + 1 + x];
      const left = x >= bytesPerPixel ? raw[targetRow + x - bytesPerPixel] : 0;
      const up = y > 0 ? raw[targetRow + x - scanlineBytes] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? raw[targetRow + x - scanlineBytes - bytesPerPixel] : 0;
      raw[targetRow + x] = undoPngFilter(filterType, value, left, up, upLeft);
    }
  }

  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0, out = 0; index < raw.length; index += channels, out += 4) {
    if (colorType === 0) {
      pixels[out] = raw[index];
      pixels[out + 1] = raw[index];
      pixels[out + 2] = raw[index];
      pixels[out + 3] = 255;
    } else if (colorType === 2) {
      pixels[out] = raw[index];
      pixels[out + 1] = raw[index + 1];
      pixels[out + 2] = raw[index + 2];
      pixels[out + 3] = 255;
    } else if (colorType === 3) {
      const paletteIndex = raw[index] * 3;
      if (!palette || paletteIndex + 2 >= palette.length) throw new Error('PNG palette index out of range');
      pixels[out] = palette[paletteIndex];
      pixels[out + 1] = palette[paletteIndex + 1];
      pixels[out + 2] = palette[paletteIndex + 2];
      pixels[out + 3] = 255;
    } else if (colorType === 4) {
      pixels[out] = raw[index];
      pixels[out + 1] = raw[index];
      pixels[out + 2] = raw[index];
      pixels[out + 3] = raw[index + 1];
    } else if (colorType === 6) {
      pixels[out] = raw[index];
      pixels[out + 1] = raw[index + 1];
      pixels[out + 2] = raw[index + 2];
      pixels[out + 3] = raw[index + 3];
    }
  }
  return { width, height, pixels };
}

function channelCountForColorType(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`unsupported PNG color type ${colorType}`);
}

function undoPngFilter(filterType, value, left, up, upLeft) {
  if (filterType === 0) return value;
  if (filterType === 1) return (value + left) & 0xff;
  if (filterType === 2) return (value + up) & 0xff;
  if (filterType === 3) return (value + Math.floor((left + up) / 2)) & 0xff;
  if (filterType === 4) return (value + paethPredictor(left, up, upLeft)) & 0xff;
  throw new Error(`unsupported PNG filter type ${filterType}`);
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function renderResidualMarkdown(report) {
  const exceedingProbes = report.probes.filter((probe) => typeof probe.meanAbsResidualPct === 'number' && probe.meanAbsResidualPct > report.thresholdPct);
  return `# Visual Residual Analysis

| 項目 | 内容 |
|------|------|
| QA ID | ${report.qa_id} |
| Story ID | ${report.story_id ?? '-'} |
| Status | ${report.status} |
| Threshold | ${formatPct(report.thresholdPct)}% |
| meanAbsResidualPct | ${formatPct(report.meanAbsResidualPct)}% |

## Probes

${report.probes.length === 0 ? '- なし' : report.probes.map((probe) => `- ${probe.probe_id}: ${probe.status}, meanAbsResidualPct=${formatPct(probe.meanAbsResidualPct)}%, current=${probe.current_screenshot ?? '-'}, baseline=${probe.baseline_screenshot ?? '-'}`).join('\n')}

## Threshold Exceedances

${exceedingProbes.length === 0 ? '- なし' : exceedingProbes.map((probe) => `- ${probe.probe_id}: meanAbsResidualPct=${formatPct(probe.meanAbsResidualPct)}% > threshold=${formatPct(report.thresholdPct)}%`).join('\n')}
`;
}

async function readConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

function safeFileName(value) {
  return String(value ?? 'screenshot')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screenshot';
}

function formatPct(value) {
  return typeof value === 'number' ? String(value) : '-';
}
