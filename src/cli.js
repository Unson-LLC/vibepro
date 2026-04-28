import { initWorkspace } from './workspace.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';
import { runDiagnosis } from './diagnostic-engine.js';
import { createBrainbaseImport } from './brainbase-importer.js';
import { publishStatusToNocoDB, syncStoriesFromNocoDB } from './nocodb-story-sync.js';

const HELP = `VibePro CLI

Usage:
  vibepro init [repo]
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run]
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
      const result = await importGraphifyArtifacts(repoRoot, {
        sourceDir,
        runGraphify: hasFlag(rest, '--run-graphify'),
        env: io.env
      });
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

    if (command === 'brainbase') {
      const repoRoot = rest[0] ?? process.cwd();
      if (hasFlag(rest, '--sync-stories')) {
        const syncResult = await syncStoriesFromNocoDB(repoRoot, {
          env: io.env,
          fetch: io.fetch
        });
        write(stdout, `Brainbase stories synced: ${syncResult.stories.length}\n`);
      }
      const result = await createBrainbaseImport(repoRoot);
      write(stdout, `Brainbase import state created: ${result.importStatePath}\n`);
      if (hasFlag(rest, '--publish-status')) {
        const publishResult = await publishStatusToNocoDB(repoRoot, {
          env: io.env,
          fetch: io.fetch,
          dryRun: hasFlag(rest, '--dry-run')
        });
        write(stdout, publishResult.dryRun
          ? `Brainbase story status preview created: ${publishResult.storyId}\n`
          : `Brainbase story status published: ${publishResult.storyId}\n`);
      }
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

function hasFlag(args, name) {
  return args.includes(name);
}

function write(stream, text) {
  if (stream) stream.write(text);
}
