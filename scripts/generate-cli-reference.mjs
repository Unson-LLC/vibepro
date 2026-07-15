import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const targets = [
  { language: 'en', sourceLanguage: 'en', file: 'docs/reference/cli.md' },
  { language: 'ja', sourceLanguage: 'en', file: 'docs/ja/reference/cli.md' }
];

export function generateCliReferences() {
  let drifted = false;
  for (const target of targets) {
    const commands = readUsageCommands(target.sourceLanguage);
    const content = renderReference(target.language, target.sourceLanguage, commands);
    const outputPath = path.join(root, target.file);

    if (checkOnly) {
      const current = readFileSync(outputPath, 'utf8');
      if (current !== content) {
        drifted = true;
        process.stderr.write(`${target.file} is stale; run npm run docs:cli\n`);
      }
      continue;
    }

    writeFileSync(outputPath, content, 'utf8');
    process.stdout.write(`generated ${target.file} (${commands.length} commands)\n`);
  }

  if (drifted) process.exitCode = 1;
}

function readUsageCommands(language) {
  const output = execFileSync(
    process.execPath,
    ['bin/vibepro.js', 'help', '--language', language],
    { cwd: root, encoding: 'utf8' }
  );
  return parseUsageCommands(output, language);
}

export function parseUsageCommands(output, language = 'unknown') {
  const usageIndex = output.indexOf('\nUsage:\n');
  if (usageIndex === -1) throw new Error(`Usage section missing from ${language} help`);

  const commands = output
    .slice(usageIndex + '\nUsage:\n'.length)
    .split('\n')
    .filter((line) => line.startsWith('  vibepro '))
    .map((line) => line.trimEnd());

  if (commands.length === 0) throw new Error(`No commands found in ${language} help`);
  return commands;
}

function renderReference(language, sourceLanguage, commands) {
  const japanese = language === 'ja';
  const title = japanese ? 'CLIリファレンス' : 'CLI Reference';
  const notice = japanese
    ? `> この完全なコマンド一覧は、同じcommitの \`vibepro help --language ${sourceLanguage}\` にある言語非依存のUsage契約から生成されています。手編集せず、\`npm run docs:cli\` で更新してください。`
    : '> This command list is generated from `vibepro help --language en` at the same commit. Do not edit it by hand; run `npm run docs:cli`.';
  const intro = japanese
    ? '実行中のbinaryが正本です。最初に `vibepro version` でpackage版を確認し、`main` のマニュアルを読む場合は[リリースと監査](/ja/guide/release-and-audit)で公開済みpackageとの差を確認してください。'
    : 'The running binary is authoritative. Check its package version with `vibepro version`; when reading the manual from `main`, use [Release and Audit](/guide/release-and-audit) to distinguish unreleased behavior from the published package.';
  const workflow = japanese
    ? 'Architecture / Specを確定する前に `story diagnose --phase design-input --run-graphify`、実装またはPR readinessの前に `story diagnose --phase pre-implementation --run-graphify` を実行します。通常の出荷経路は `story diagnose` → Architecture / Spec → 実装 → `verify record` → `review prepare/start/close/record` → `adjudicate` → `guard check` → `pr prepare` → `pr create` → `verify import-ci` → `execute merge` です。各引数の完全な契約は以下の生成済みUsageを使ってください。'
    : 'Run `story diagnose --phase design-input --run-graphify` before finalizing Architecture/Spec. Before implementation or PR readiness, run `story diagnose --phase pre-implementation --run-graphify`. The normal shipping path is `story diagnose` → Architecture / Spec → implementation → `verify record` → `review prepare/start/close/record` → `adjudicate` → `guard check` → `pr prepare` → `pr create` → `verify import-ci` → `execute merge`. Use the generated Usage below for the complete argument contract.';

  return `# ${title}\n\n${notice}\n\n${intro}\n\n${workflow}\n\n## ${japanese ? '現在のUsage' : 'Current Usage'}\n\n\`\`\`text\n${commands.join('\n')}\n\`\`\`\n\n## ${japanese ? 'ドリフト確認' : 'Drift Check'}\n\n\`\`\`bash\nnpm run docs:cli:check\n\`\`\`\n`;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) generateCliReferences();
