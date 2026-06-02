import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace } from './workspace.js';

export const DEFAULT_OUTPUT_LANGUAGE = 'ja';
export const SUPPORTED_OUTPUT_LANGUAGES = new Set(['ja', 'en']);

export function normalizeOutputLanguage(value) {
  return SUPPORTED_OUTPUT_LANGUAGES.has(value) ? value : DEFAULT_OUTPUT_LANGUAGE;
}

export function assertOutputLanguage(value) {
  if (SUPPORTED_OUTPUT_LANGUAGES.has(value)) return value;
  throw new Error(`Unsupported output language: ${value}. Supported languages: ja, en`);
}

export function resolveOutputLanguage(config, override = null) {
  if (override) return assertOutputLanguage(override);
  return normalizeOutputLanguage(config?.output?.language);
}

export async function resolveHumanOutputLanguage(repoRoot, options = {}) {
  const override = typeof options === 'string' ? options : options.language;
  if (override) return assertOutputLanguage(override);
  await initWorkspace(repoRoot);
  const configPath = path.join(getWorkspaceDir(repoRoot), 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  return resolveOutputLanguage(config);
}

export function localizedText(language, values) {
  const normalized = normalizeOutputLanguage(language);
  return values[normalized] ?? values[DEFAULT_OUTPUT_LANGUAGE] ?? values.en ?? '';
}

export async function setOutputLanguage(repoRoot, language) {
  const normalized = assertOutputLanguage(language);
  await initWorkspace(repoRoot);
  const configPath = path.join(getWorkspaceDir(repoRoot), 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.output = {
    ...(config.output ?? {}),
    language: normalized
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { language: normalized, config };
}
