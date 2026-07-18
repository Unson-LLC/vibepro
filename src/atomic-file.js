import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function atomicReplaceFile(targetPath, data, options = {}) {
  const absolute = path.resolve(targetPath);
  const directory = path.dirname(absolute);
  const temporary = path.join(directory, `.${path.basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
  const existingMode = options.mode == null ? await existingReplacementMode(absolute) : null;
  const fileMode = options.mode ?? existingMode ?? 0o666;
  const syncDirectoryAfterRename = options.syncDirectory ?? syncDirectory;
  let handle = null;
  let renamed = false;
  await mkdir(directory, { recursive: true });
  try {
    handle = await open(temporary, 'wx', fileMode);
    if (existingMode != null) await handle.chmod(existingMode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, absolute);
    renamed = true;
    try {
      await syncDirectoryAfterRename(directory);
    } catch (error) {
      // rename is the commit point: reporting a write failure now would falsely
      // imply that callers can rely on the previous bytes still being present.
      try { options.onDurabilityError?.(error); } catch {}
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!renamed) await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function existingReplacementMode(targetPath) {
  try {
    return (await stat(targetPath)).mode & 0o777;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error;
  } finally {
    if (handle) await handle.close();
  }
}
