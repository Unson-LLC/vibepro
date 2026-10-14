import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

export const PRODUCER_MODULE_ENV = 'BRAINBASE_PRODUCER_MODULE';
export const OUTCOME_CASE_SERVICE_ENV = 'BRAINBASE_OUTCOME_CASE_SERVICE';
export const HANDOFF_ISSUER_ENV = 'BRAINBASE_HANDOFF_ISSUER';
export const PRODUCER_ROOT_ENV = 'BRAINBASE_PRODUCER_ROOT';

export const OUTCOME_CASE_SERVICE_FILENAME = 'outcome-case-service.js';
export const HANDOFF_ISSUER_FILENAME = 'vibepro-handoff-issuer.js';

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage', '.vibepro', '.vibepro-store']);
const DEFAULT_LIMITS = Object.freeze({
  maxParentLevels: 6,
  maxDirectoryDepth: 8,
  maxVisitedDirectories: 4000,
});

export async function resolveBrainbaseProducerModules(env = process.env, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const producerModulePath = env[PRODUCER_MODULE_ENV]
    ? path.resolve(env[PRODUCER_MODULE_ENV])
    : null;
  if (!producerModulePath) {
    return {
      producerModulePath: null,
      outcomeCaseServicePath: null,
      handoffIssuerPath: null,
    };
  }
  await assertFile(producerModulePath, PRODUCER_MODULE_ENV);
  const outcomeCaseServicePath = await resolveCompanion({
    env,
    envName: OUTCOME_CASE_SERVICE_ENV,
    filename: OUTCOME_CASE_SERVICE_FILENAME,
    producerModulePath,
    limits,
  });
  const handoffIssuerPath = await resolveCompanion({
    env,
    envName: HANDOFF_ISSUER_ENV,
    filename: HANDOFF_ISSUER_FILENAME,
    producerModulePath,
    limits,
  });
  return { producerModulePath, outcomeCaseServicePath, handoffIssuerPath };
}

async function resolveCompanion({ env, envName, filename, producerModulePath, limits }) {
  const explicit = env[envName];
  if (explicit) {
    const resolved = path.resolve(explicit);
    await assertFile(resolved, envName);
    return resolved;
  }

  const configuredRoot = env[PRODUCER_ROOT_ENV] ? path.resolve(env[PRODUCER_ROOT_ENV]) : null;
  if (configuredRoot) {
    const matches = await findNamedFiles(configuredRoot, filename, limits);
    return chooseMatch(filename, envName, matches, `under ${configuredRoot}`);
  }

  const producerDir = path.dirname(producerModulePath);
  const sibling = path.join(producerDir, filename);
  if (await fileExists(sibling)) return sibling;

  const underProducer = await findNamedFiles(producerDir, filename, limits);
  if (underProducer.length > 0) {
    return chooseMatch(filename, envName, underProducer, `under ${producerDir}`);
  }

  if (path.basename(producerDir) === 'server-parts') {
    throw notFound(filename, envName, producerModulePath);
  }

  let current = producerDir;
  for (let level = 0; level < limits.maxParentLevels; level += 1) {
    const parent = path.dirname(current);
    if (parent === current) break;
    const matches = await findNamedFiles(parent, filename, limits);
    if (matches.length > 0) return chooseMatch(filename, envName, matches, `under ${parent}`);
    current = parent;
    if (path.basename(current) === 'server-parts') break;
  }
  throw notFound(filename, envName, producerModulePath);
}

function chooseMatch(filename, envName, matches, where) {
  if (matches.length === 1) return matches[0];
  const listed = matches.map((match) => `- ${match}`).join('\n');
  const error = new Error(
    `${filename} matched ${matches.length} files ${where}. Set ${envName} to one path:\n${listed}`,
  );
  error.code = 'BRAINBASE_PRODUCER_MODULE_AMBIGUOUS';
  throw error;
}

function notFound(filename, envName, producerModulePath) {
  const error = new Error(
    `${filename} was not found beside ${producerModulePath} or under its parent directories. `
    + `Set ${envName} or ${PRODUCER_ROOT_ENV}.`,
  );
  error.code = 'BRAINBASE_PRODUCER_MODULE_NOT_FOUND';
  throw error;
}

async function findNamedFiles(root, filename, limits) {
  const matches = [];
  let visited = 0;
  async function walk(directory, depth) {
    if (depth > limits.maxDirectoryDepth) return;
    visited += 1;
    if (visited > limits.maxVisitedDirectories) {
      const error = new Error(
        `stopped searching for ${filename} after ${limits.maxVisitedDirectories} directories under ${root}. `
        + 'Set the explicit module path.',
      );
      error.code = 'BRAINBASE_PRODUCER_SEARCH_LIMIT';
      throw error;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'EACCES') return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        await walk(entryPath, depth + 1);
        continue;
      }
      if ((entry.isFile() || entry.isSymbolicLink()) && entry.name === filename) {
        matches.push(entryPath);
      }
    }
  }
  await walk(root, 0);
  return matches;
}

async function assertFile(filePath, envName) {
  if (!(await fileExists(filePath))) {
    const error = new Error(`${envName} does not point to a file: ${filePath}`);
    error.code = 'BRAINBASE_PRODUCER_MODULE_NOT_FOUND';
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
