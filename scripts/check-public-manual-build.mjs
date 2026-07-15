import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PUBLIC_ROUTES = [
  'reference/gate-tuning/2026-07',
  'reference/vibepro-ui-journey-e2e-dogfood'
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

  const files = await walk(distDir);
  for (const forbiddenRoute of FORBIDDEN_PUBLIC_ROUTES) {
    const forbiddenOutput = files.find((file) => normalize(file).includes(forbiddenRoute));
    if (forbiddenOutput) {
      throw new Error(`Public build contains forbidden route output: ${normalize(forbiddenOutput)}`);
    }
  }

  const searchableFiles = files.filter((file) => /\.(?:html|js|json|txt|xml)$/u.test(file));
  for (const file of searchableFiles) {
    const content = await readFile(path.join(distDir, file), 'utf8');
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

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const distDir = path.resolve(process.argv[2] || 'docs/.vitepress/dist');
  const result = await checkPublicManualBuild(distDir);
  process.stdout.write(`Public manual build contract: ${result.status} (${result.files} files)\n`);
}
