import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Creates an isolated DATA_DIR so tests never touch real conversations. */
export async function makeTempDataDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'secret-interface-test-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
