// Side-effect module: isolates the current process into a private scratch
// temp root so that mkdtemp(os.tmpdir()) calls scattered across the test
// suite stop leaking fixture directories into the real $TMPDIR. Node's
// os.tmpdir() re-reads process.env.TMPDIR (and TMP/TEMP on Windows) on every
// call, so setting these env vars before any test code runs is sufficient to
// redirect every mkdtemp(os.tmpdir()) call in this process (and in any child
// process it spawns, since env vars are inherited) into the scratch root.
// The scratch root is removed on process exit, and a self-healing sweep
// removes any scratch roots left behind by prior crashed/killed processes.

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRATCH_PREFIX = 'vibepro-scratch-';
const STALE_AGE_MS = 24 * 60 * 60 * 1000;

function sweepStaleScratchDirs() {
  try {
    const realTmpDir = os.tmpdir();
    const now = Date.now();
    let entries;
    try {
      entries = readdirSync(realTmpDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.startsWith(SCRATCH_PREFIX)) {
        continue;
      }
      const entryPath = path.join(realTmpDir, entry);
      try {
        const stats = statSync(entryPath);
        if (now - stats.mtimeMs <= STALE_AGE_MS) {
          continue;
        }
        rmSync(entryPath, { recursive: true, force: true });
      } catch {
        // Ignore: another process may have already removed it, or we lack
        // permission. Either way, this is best-effort cleanup.
      }
    }
  } catch {
    // Never let the sweep break test startup.
  }
}

sweepStaleScratchDirs();

export const scratchRoot = mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));

process.env.TMPDIR = scratchRoot;
process.env.TMP = scratchRoot;
process.env.TEMP = scratchRoot;

process.once('exit', () => {
  try {
    rmSync(scratchRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; ignore failures on exit.
  }
});
