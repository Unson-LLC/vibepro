import { initWorkspace } from './workspace.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';
import { runDiagnosis } from './diagnostic-engine.js';

const HELP = `VibePro CLI

Usage:
  vibepro init [repo]
  vibepro graph [repo] --from <graphify-out>
  vibepro diagnose [repo] [--run-id <id>]
`;

export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? null;
  const stderr = io.stderr ?? null;
  const [command, ...rest] = argv;

  try {
    if (!command || command === '--help' || command === '-h') {
      write(stdout, HELP);
      return { exitCode: 0, command: 'help' };
    }

    if (command === 'init') {
      const repoRoot = rest[0] ?? process.cwd();
      const workspace = await initWorkspace(repoRoot);
      write(stdout, `VibePro workspace initialized: ${workspace.workspaceDir}\n`);
      return { exitCode: 0, command, workspace };
    }

    if (command === 'graph') {
      const repoRoot = rest[0] ?? process.cwd();
      const sourceDir = getOption(rest, '--from');
      const result = await importGraphifyArtifacts(repoRoot, { sourceDir });
      write(stdout, `graphify artifacts imported: ${result.graphifyDir}\n`);
      return { exitCode: 0, command, result };
    }

    if (command === 'diagnose') {
      const repoRoot = rest[0] ?? process.cwd();
      const runId = getOption(rest, '--run-id');
      const result = await runDiagnosis(repoRoot, { runId });
      write(stdout, `diagnosis created: ${result.runDir}\n`);
      return { exitCode: 0, command, result };
    }

    write(stderr, `Unknown command: ${command}\n\n${HELP}`);
    return { exitCode: 1, command };
  } catch (error) {
    write(stderr, `${error.message}\n`);
    return { exitCode: 1, command };
  }
}

function getOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function write(stream, text) {
  if (stream) stream.write(text);
}
