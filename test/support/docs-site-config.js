// Import the build config without contacting npm, including its top-level await.
export async function loadSiteConfig(fetchImpl, key = 'registry') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await import(`../../docs/.vitepress/config.mjs?test=${key}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export const registryTags = { latest: '0.2.0-beta.32', beta: '0.2.0-beta.34' };
export const { default: siteConfig, resolveNpmTags } = await loadSiteConfig(async () => ({
  ok: true,
  json: async () => registryTags
}));
