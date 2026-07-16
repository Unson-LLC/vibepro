import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_PUBLIC_ROUTES = [
  'reference/gate-tuning/2026-07',
  'reference/vibepro-ui-journey-e2e-dogfood'
];

export const FORBIDDEN_PUBLIC_CORPORA = [
  'architecture',
  'management',
  'specs',
  'stories',
  'contracts',
  'frames',
  'marketing',
  'playbooks',
  'static_site'
];

export const REQUIRED_PUBLIC_ROUTES = [
  'guide/agent-review.html',
  'guide/ai-pr-workflow.html',
  'guide/check-packs.html',
  'guide/checkpoints-and-execution.html',
  'guide/ci-integration.html',
  'guide/control-loop.html',
  'guide/core-concepts.html',
  'guide/feature-map.html',
  'guide/gate-tuning-ritual.html',
  'guide/gates-and-evidence.html',
  'guide/getting-started.html',
  'guide/graphify-impact.html',
  'guide/managed-execution.html',
  'guide/release-and-audit.html',
  'guide/safety-model.html',
  'guide/story-spec-traceability.html',
  'guide/verification-decisions-ci.html',
  'guide/what-is-vibepro.html',
  'reference/artifact-map.html',
  'reference/cli.html',
  'reference/cloudflare-pages.html',
  'reference/version-history.html',
  'ja/guide/agent-review.html',
  'ja/guide/ai-pr-workflow.html',
  'ja/guide/check-packs.html',
  'ja/guide/checkpoints-and-execution.html',
  'ja/guide/control-loop.html',
  'ja/guide/core-concepts.html',
  'ja/guide/feature-map.html',
  'ja/guide/gates-and-evidence.html',
  'ja/guide/getting-started.html',
  'ja/guide/graphify-impact.html',
  'ja/guide/managed-execution.html',
  'ja/guide/release-and-audit.html',
  'ja/guide/safety-model.html',
  'ja/guide/story-spec-traceability.html',
  'ja/guide/verification-decisions-ci.html',
  'ja/guide/what-is-vibepro.html',
  'ja/reference/artifact-map.html',
  'ja/reference/cli.html',
  'ja/reference/cloudflare-pages.html',
  'ja/reference/version-history.html'
];

const REQUIRED_FILES = [
  'index.html',
  'ja/index.html',
  'assets/vibepro-header.png',
  'robots.txt',
  'llms.txt',
  'sitemap.xml'
];

export async function checkPublicManualBuild(distDir) {
  for (const relativePath of REQUIRED_FILES) {
    await requireFile(distDir, relativePath);
  }
  for (const relativePath of REQUIRED_PUBLIC_ROUTES) {
    await requireFile(distDir, relativePath);
  }

  const files = await walk(distDir);
  for (const corpus of FORBIDDEN_PUBLIC_CORPORA) {
    const forbiddenOutput = files.find((file) => {
      const normalized = normalize(file);
      return normalized === corpus || normalized.startsWith(`${corpus}/`);
    });
    if (forbiddenOutput) {
      throw new Error(`Public build contains forbidden corpus output: ${normalize(forbiddenOutput)}`);
    }
  }
  for (const forbiddenRoute of FORBIDDEN_PUBLIC_ROUTES) {
    const forbiddenOutput = files.find((file) => normalize(file).includes(forbiddenRoute));
    if (forbiddenOutput) {
      throw new Error(`Public build contains forbidden route output: ${normalize(forbiddenOutput)}`);
    }
  }

  const searchableFiles = files.filter((file) => /\.(?:html|js|json|txt|xml)$/u.test(file));
  for (const file of searchableFiles) {
    const content = await readFile(path.join(distDir, file), 'utf8');
    for (const corpus of FORBIDDEN_PUBLIC_CORPORA) {
      const escapedCorpus = escapeRegExp(corpus);
      const publicLink = new RegExp(`(?:href|src)=["'](?:https://vibepro\\.pages\\.dev)?/?${escapedCorpus}/`, 'u');
      const sitemapLocation = new RegExp(`<loc>[^<]*/${escapedCorpus}/`, 'u');
      if (publicLink.test(content) || sitemapLocation.test(content)) {
        throw new Error(`Public build references forbidden corpus ${corpus} in ${normalize(file)}`);
      }
    }
    for (const forbiddenRoute of FORBIDDEN_PUBLIC_ROUTES) {
      if (content.includes(forbiddenRoute)) {
        throw new Error(`Public build references forbidden route ${forbiddenRoute} in ${normalize(file)}`);
      }
    }
    if (content.includes('/Users/')) {
      throw new Error(`Public build exposes a local absolute path in ${normalize(file)}`);
    }
  }

  const index = await readFile(path.join(distDir, 'index.html'), 'utf8');
  for (const contract of [
    'property="og:image"',
    'name="twitter:image"',
    'name="vibepro-source-commit"',
    'application/ld+json',
    '/assets/vibepro-header.png'
  ]) {
    if (!index.includes(contract)) {
      throw new Error(`Public index is missing required contract: ${contract}`);
    }
  }

  return { status: 'pass', files: files.length };
}

async function requireFile(root, relativePath) {
  try {
    await access(path.join(root, relativePath));
  } catch {
    throw new Error(`Public build is missing required file: ${relativePath}`);
  }
}

async function walk(root, current = '') {
  const output = [];
  for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
    const relativePath = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...await walk(root, relativePath));
    if (entry.isFile()) output.push(relativePath);
  }
  return output;
}

function normalize(file) {
  return file.split(path.sep).join('/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const distDir = path.resolve(process.argv[2] || 'docs/.vitepress/dist');
  const result = await checkPublicManualBuild(distDir);
  process.stdout.write(`Public manual build contract: ${result.status} (${result.files} files)\n`);
}
