/**
 * Process-table guard for the real-app lanes: after teardown, no process of
 * the launched executable may survive. Shared by the packaged qualification
 * spec and the simulation runner so every real-driver run carries the same
 * orphan-process guarantee.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** True if any live process with the given image name is running. */
export async function listAppProcesses(exeName: string): Promise<string> {
  const { stdout } = await execFileAsync('tasklist', [
    '/FI',
    `IMAGENAME eq ${exeName}`,
    '/FO',
    'CSV',
    '/NH',
  ]);
  return stdout.trim();
}

/**
 * Asserts the app exe left no orphaned processes. Throws (rather than a bare
 * expect) so both Playwright specs and the plain-runner path fail identically.
 */
export async function assertNoOrphanProcesses(appExePath: string): Promise<void> {
  const exeName = appExePath.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!exeName) throw new Error('assertNoOrphanProcesses: empty exe name');
  const rows = await listAppProcesses(exeName);
  if (rows.includes(exeName)) {
    throw new Error(`orphaned packaged-app processes survived the run:\n${rows}`);
  }
}
