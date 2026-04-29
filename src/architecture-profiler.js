import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  '.worktrees',
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
  const auth = detectAuth({ dependencies, fileSet });
  const appType = detectAppType({ fileSet, dependencies });
  const rendering = detectRendering({ dependencies });
  const frameworks = detectFrameworks(dependencies);
  const languages = detectLanguages(files);
  const apiRoutes = listApiRoutes(fileSet);
  const database = detectDatabase(dependencies);
  const deployment = detectDeployment(fileSet);
  const views = buildArchitectureViews({
    appType,
    rendering,
    frameworks,
    languages,
    apiRoutes,
    database,
    auth,
    deployment,
    dependencies,
    fileSet
  });
  const profile = {
    system_type: toSystemType(appType),
    app_type: appType,
    rendering,
    frameworks,
    package_manager: detectPackageManager(fileSet),
    languages,
    views,
    has_api_routes: views.runtime.entrypoints.length > 0,
    has_database: views.data.stores.length > 0 || views.data.access_patterns.length > 0,
    database,
    has_auth: auth.length > 0,
    auth,
    deployment,
    evidence: buildProfileEvidence({ fileSet, packageJson, dependencies })
  };
  const checkCatalog = selectCheckCatalog(profile);

  return {
    ...profile,
    applicable_checks: checkCatalog.applicable_checks,
    selected_views: checkCatalog.selected_views
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

function detectFrameworks(dependencies) {
  return ['next', 'react', 'vue', 'svelte']
    .filter((dependency) => dependencies.has(dependency))
    .map((dependency) => dependency === 'next' ? 'nextjs' : dependency);
}

function toSystemType(appType) {
  if (appType === 'web_app') return 'web_application';
  if (appType === 'static_site') return 'static_site';
  return 'unknown';
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
  return listApiRoutes(fileSet).length > 0;
}

function listApiRoutes(fileSet) {
  return [...fileSet].filter((file) => (
    /^app\/api\/.+\/route\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/app\/api\/.+\/route\.(js|jsx|ts|tsx)$/.test(file)
    || /^pages\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/pages\/api\/.+\.(js|jsx|ts|tsx)$/.test(file)
  )).sort();
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

function detectAuth({ dependencies, fileSet }) {
  const auth = [];
  if (dependencies.has('next-auth')) auth.push('next-auth');
  if (dependencies.has('@auth/core')) auth.push('authjs');
  if (dependencies.has('@clerk/nextjs')) auth.push('clerk');
  if (dependencies.has('@supabase/supabase-js')) auth.push('supabase-auth');
  if (dependencies.has('passport')) auth.push('passport');
  if (hasNextMiddleware(fileSet)) auth.push('next-middleware');
  if (hasNextAuthRoute(fileSet)) auth.push('next-auth-route');
  return auth;
}

function hasNextMiddleware(fileSet) {
  return fileSet.has('middleware.ts')
    || fileSet.has('middleware.js')
    || fileSet.has('src/middleware.ts')
    || fileSet.has('src/middleware.js');
}

function hasNextAuthRoute(fileSet) {
  return [...fileSet].some((file) => (
    /^app\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/app\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^pages\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/pages\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
  ));
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

function buildArchitectureViews({
  appType,
  rendering,
  frameworks,
  languages,
  apiRoutes,
  database,
  auth,
  deployment,
  dependencies,
  fileSet
}) {
  const structureComponents = [];
  if (apiRoutes.length > 0) structureComponents.push('api_routes');
  if (hasNextMiddleware(fileSet)) structureComponents.push('middleware');
  if (hasPages(fileSet)) structureComponents.push('pages');
  if (fileSet.has('index.html')) structureComponents.push('static_entry');

  return {
    structure: {
      containers: appType === 'unknown' ? [] : [appType],
      components: structureComponents,
      frameworks,
      languages
    },
    runtime: {
      entrypoints: [...apiRoutes, ...listMiddlewareFiles(fileSet)],
      server_boundaries: [
        ...(apiRoutes.length > 0 ? ['api_routes'] : []),
        ...(hasServerActions(fileSet) ? ['server_actions'] : []),
        ...(hasNextMiddleware(fileSet) ? ['middleware'] : [])
      ],
      rendering
    },
    data: {
      stores: database.filter((item) => ['postgres', 'mongodb', 'supabase'].includes(item)),
      access_patterns: database.filter((item) => !['postgres', 'mongodb', 'supabase'].includes(item))
    },
    security: {
      auth_boundaries: buildAuthBoundaries(fileSet),
      auth_mechanisms: auth,
      secret_files: listEnvFiles(fileSet)
    },
    deployment: {
      targets: deployment,
      config_files: listDeploymentFiles(fileSet)
    },
    quality: {
      test_tools: detectTestTools(dependencies),
      ci: listCiFiles(fileSet)
    }
  };
}

function selectCheckCatalog(profile) {
  const checks = ['secrets', 'xss', 'dependency-graph'];
  const selectedViews = ['structure'];
  if (profile.views.runtime.entrypoints.length > 0 || profile.views.runtime.server_boundaries.length > 0) {
    selectedViews.push('runtime');
    checks.push('api-boundary');
  }
  if (profile.app_type === 'static_site') {
    checks.push('static-entry', 'static-publish-surface', 'external-resources');
  }
  if (profile.views.data.stores.length > 0 || profile.views.data.access_patterns.length > 0) {
    selectedViews.push('data');
    checks.push('database-access');
  }
  if (profile.views.security.auth_boundaries.length > 0 || profile.views.security.auth_mechanisms.length > 0) {
    selectedViews.push('security');
    checks.push('auth-boundary');
  }
  if (profile.views.deployment.targets.length > 0) {
    selectedViews.push('deployment');
    checks.push('deployment-readiness');
  }
  if (profile.views.quality.test_tools.length > 0 || profile.views.quality.ci.length > 0) {
    selectedViews.push('quality');
  }
  return {
    selected_views: [...new Set(selectedViews)],
    applicable_checks: [...new Set(checks)]
  };
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
  if (hasNextMiddleware(fileSet)) {
    evidence.push({ kind: 'auth_boundary', file: findNextMiddleware(fileSet), detail: 'Next.js middleware detected' });
  }
  if (hasNextAuthRoute(fileSet)) {
    evidence.push({ kind: 'auth_boundary', file: findFirstNextAuthRoute(fileSet), detail: 'Auth route detected' });
  }
  for (const deploymentFile of ['vercel.json', 'fly.toml', 'wrangler.toml', 'Dockerfile']) {
    if (fileSet.has(deploymentFile)) {
      evidence.push({ kind: 'deployment', file: deploymentFile, detail: deploymentFile });
    }
  }
  return evidence;
}

function findFirstApiRoute(fileSet) {
  return listApiRoutes(fileSet)[0] ?? null;
}

function findNextMiddleware(fileSet) {
  return ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js']
    .find((file) => fileSet.has(file)) ?? null;
}

function findFirstNextAuthRoute(fileSet) {
  return [...fileSet].find((file) => (
    /^app\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/app\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^pages\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/pages\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
  )) ?? null;
}

function buildAuthBoundaries(fileSet) {
  return [
    ...listMiddlewareFiles(fileSet).map((file) => ({ type: 'middleware', file })),
    ...listNextAuthRoutes(fileSet).map((file) => ({ type: 'auth_route', file }))
  ];
}

function listMiddlewareFiles(fileSet) {
  return ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js']
    .filter((file) => fileSet.has(file));
}

function listNextAuthRoutes(fileSet) {
  return [...fileSet].filter((file) => (
    /^app\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/app\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^pages\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/pages\/api\/auth\/.+\.(js|jsx|ts|tsx)$/.test(file)
  )).sort();
}

function listEnvFiles(fileSet) {
  return [...fileSet].filter((file) => {
    const basename = path.basename(file);
    return basename === '.env' || basename.startsWith('.env.');
  }).sort();
}

function listDeploymentFiles(fileSet) {
  return ['vercel.json', 'fly.toml', 'wrangler.toml', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']
    .filter((file) => fileSet.has(file));
}

function detectTestTools(dependencies) {
  return [...new Set(['vitest', 'jest', 'playwright', '@playwright/test', 'cypress']
    .filter((dependency) => dependencies.has(dependency))
    .map((dependency) => dependency === '@playwright/test' ? 'playwright' : dependency))];
}

function listCiFiles(fileSet) {
  return [...fileSet].filter((file) => file.startsWith('.github/workflows/') || file.startsWith('.circleci/')).sort();
}

function hasPages(fileSet) {
  return [...fileSet].some((file) => (
    /^app\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/app\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^pages\/.+\.(js|jsx|ts|tsx)$/.test(file)
    || /^src\/pages\/.+\.(js|jsx|ts|tsx)$/.test(file)
  ));
}

function hasServerActions(fileSet) {
  return [...fileSet].some((file) => /actions?\.(js|jsx|ts|tsx)$/.test(file));
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
