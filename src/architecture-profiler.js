import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  'coverage',
  'node_modules',
  'graphify-out'
]);
const PACKAGE_MANAGERS = [
  { file: 'pnpm-lock.yaml', name: 'pnpm' },
  { file: 'yarn.lock', name: 'yarn' },
  { file: 'package-lock.json', name: 'npm' }
];
const LANGUAGE_EXTENSIONS = new Map([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.py', 'python'],
  ['.rb', 'ruby'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.php', 'php']
]);

export async function profileArchitecture(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await collectFiles(root);
  const fileSet = new Set(files.map((file) => file.relativePath));
  const packageJson = await readPackageJson(root, fileSet);
  const dependencies = collectDependencies(packageJson);
  const profile = {
    app_type: detectAppType({ fileSet, dependencies }),
    rendering: detectRendering({ fileSet, dependencies }),
    package_manager: detectPackageManager(fileSet),
    languages: detectLanguages(files),
    has_api_routes: hasApiRoutes(fileSet),
    has_database: hasAnyDependency(dependencies, [
      '@prisma/client',
      '@supabase/supabase-js',
      'drizzle-orm',
      'kysely',
      'mongoose',
      'pg',
      'prisma',
      'sequelize'
    ]),
    database: detectDatabase(dependencies),
    has_auth: hasAnyDependency(dependencies, [
      '@auth/core',
      '@clerk/nextjs',
      '@supabase/supabase-js',
      'next-auth',
      'passport'
    ]),
    auth: detectAuth(dependencies),
    deployment: detectDeployment(fileSet),
    evidence: buildProfileEvidence({ fileSet, packageJson, dependencies })
  };

  return {
    ...profile,
    applicable_checks: selectApplicableChecks(profile)
  };
}

function detectAppType({ fileSet, dependencies }) {
  if (dependencies.has('next') || dependencies.has('react') || dependencies.has('vue') || dependencies.has('svelte')) {
    return 'web_app';
  }
  if (fileSet.has('index.html')) return 'static_site';
  return 'unknown';
}

function detectRendering({ dependencies }) {
  if (dependencies.has('next')) return 'nextjs';
  if (dependencies.has('react')) return 'react';
  if (dependencies.has('vue')) return 'vue';
  if (dependencies.has('svelte')) return 'svelte';
  return null;
}

function detectPackageManager(fileSet) {
  const manager = PACKAGE_MANAGERS.find((candidate) => fileSet.has(candidate.file));
  if (manager) return manager.name;
  return fileSet.has('package.json') ? 'npm' : null;
}

function detectLanguages(files) {
  return [...new Set(files
    .map((file) => LANGUAGE_EXTENSIONS.get(path.extname(file.relativePath).toLowerCase()))
    .filter(Boolean))]
    .sort();
}

function hasApiRoutes(fileSet) {
  return [...fileSet].some((file) => (
    /^app\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/app\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^pages\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/pages\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
  ));
}

function detectDatabase(dependencies) {
  const database = [];
  if (dependencies.has('@supabase/supabase-js')) database.push('supabase');
  if (dependencies.has('@prisma/client') || dependencies.has('prisma')) database.push('prisma');
  if (dependencies.has('pg')) database.push('postgres');
  if (dependencies.has('drizzle-orm')) database.push('drizzle');
  if (dependencies.has('kysely')) database.push('kysely');
  if (dependencies.has('mongoose')) database.push('mongodb');
  if (dependencies.has('sequelize')) database.push('sequelize');
  return database;
}

function detectAuth(dependencies) {
  const auth = [];
  if (dependencies.has('next-auth')) auth.push('next-auth');
  if (dependencies.has('@auth/core')) auth.push('authjs');
  if (dependencies.has('@clerk/nextjs')) auth.push('clerk');
  if (dependencies.has('@supabase/supabase-js')) auth.push('supabase-auth');
  if (dependencies.has('passport')) auth.push('passport');
  return auth;
}

function detectDeployment(fileSet) {
  const deployment = [];
  if (fileSet.has('vercel.json')) deployment.push('vercel');
  if (fileSet.has('fly.toml')) deployment.push('fly');
  if (fileSet.has('wrangler.toml')) deployment.push('cloudflare');
  if (fileSet.has('Dockerfile') || fileSet.has('docker-compose.yml') || fileSet.has('docker-compose.yaml')) {
    deployment.push('docker');
  }
  return deployment;
}

function selectApplicableChecks(profile) {
  const checks = ['secrets', 'xss', 'dependency-graph'];
  if (profile.app_type === 'static_site') {
    checks.push('static-entry', 'static-publish-surface', 'external-resources');
  }
  if (profile.app_type === 'web_app' || profile.has_api_routes) {
    checks.push('api-boundary');
  }
  if (profile.has_database) checks.push('database-access');
  if (profile.has_auth) checks.push('auth-boundary');
  if (profile.deployment.length > 0) checks.push('deployment-readiness');
  return [...new Set(checks)];
}

function buildProfileEvidence({ fileSet, packageJson, dependencies }) {
  const evidence = [];
  if (fileSet.has('package.json')) {
    evidence.push({ kind: 'package_json', file: 'package.json', detail: packageJson?.name ?? 'package.json' });
  }
  if (dependencies.has('next')) {
    evidence.push({ kind: 'framework', file: 'package.json', detail: 'next' });
  }
  if (hasApiRoutes(fileSet)) {
    evidence.push({ kind: 'api_routes', file: findFirstApiRoute(fileSet), detail: 'API route detected' });
  }
  for (const deploymentFile of ['vercel.json', 'fly.toml', 'wrangler.toml', 'Dockerfile']) {
    if (fileSet.has(deploymentFile)) {
      evidence.push({ kind: 'deployment', file: deploymentFile, detail: deploymentFile });
    }
  }
  return evidence;
}

function findFirstApiRoute(fileSet) {
  return [...fileSet].find((file) => (
    /^app\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/app\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^pages\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/pages\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
  )) ?? null;
}

function collectDependencies(packageJson) {
  const dependencyGroups = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
    packageJson?.optionalDependencies
  ];
  return new Set(dependencyGroups.flatMap((group) => Object.keys(group ?? {})));
}

async function readPackageJson(root, fileSet) {
  if (!fileSet.has('package.json')) return null;
  try {
    return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function hasAnyDependency(dependencies, names) {
  return names.some((name) => dependencies.has(name));
}

async function collectFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, absolutePath));
      continue;
    }

    if (!entry.isFile()) continue;
    const fileStat = await stat(absolutePath);
    if (fileStat.size > 1024 * 1024) continue;
    files.push({ absolutePath, relativePath });
  }

  return files;
}
