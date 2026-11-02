import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Creates an isolated DATA_DIR so tests never touch real conversations. */
export async function makeTempDataDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'secret-interface-test-'))
  // Retries because a test can end just before the server's final save lands in the folder being removed. A failed
  // cleanup also skips unmounting, which would break the next test.
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
}
