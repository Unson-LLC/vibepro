import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function resolveGitIdentity(repoRoot) {
  const cwd = path.resolve(repoRoot);
  const [
    { stdout: rootOutput },
    { stdout: gitDirOutput },
    { stdout: gitCommonDirOutput },
    { stdout: headOutput }
  ] = await Promise.all([
    execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }),
    execFileAsync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8' }),
    execFileAsync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }),
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  ]);
  return {
    root_realpath: await realpath(rootOutput.trim()),
    git_dir_realpath: await realpath(gitDirOutput.trim()),
    git_common_dir_realpath: await realpath(gitCommonDirOutput.trim()),
    head_sha: headOutput.trim()
  };
}
