// Copies the conversation JSON files older versions wrote (<DATA_DIR>/conversations/ and its archived/ folder) into
// the PostgreSQL database at DATABASE_URL, keeping their ids and archived state. Conversations already in the database
// are skipped, so it is safe to run again. The files are left as they are.
//
//   npm run db:import                                         # reads .env.local / .env like the app
//   DATABASE_URL=postgres://… npm run db:import -- ./data     # or name the database and folder directly
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'
import { getConfig } from '../lib/config'
import { ConversationStore, isValidConversationId, normalizeConversation } from '../lib/store'

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file) // Never overrides variables already set in the shell.
  } catch {
    // No such file.
  }
}

interface Source {
  id: string
  file: string
  archived: boolean
}

async function sources(dir: string, archived: boolean): Promise<Source[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ id: name.slice(0, -'.json'.length), file: path.join(dir, name), archived }))
    .filter((source) => isValidConversationId(source.id))
}

const config = getConfig()
if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
const folder = path.join(path.resolve(process.argv[2] ?? config.dataDir), 'conversations')
// A conversation in both folders counts once, as active, as the old file store treated it.
const byId = new Map<string, Source>()
for (const source of [...(await sources(path.join(folder, 'archived'), true)), ...(await sources(folder, false))]) {
  byId.set(source.id, source)
}
const queue = [...byId.values()]
console.log(`Found ${queue.length} conversations in ${folder}`)

const pool = new Pool({ connectionString: config.databaseUrl })
const store = new ConversationStore(pool)
let added = 0
let skipped = 0
let unreadable = 0
try {
  const worker = async () => {
    for (let source = queue.shift(); source; source = queue.shift()) {
      let raw: unknown
      let modified: string
      try {
        raw = JSON.parse(await fs.readFile(source.file, 'utf8'))
        modified = (await fs.stat(source.file)).mtime.toISOString()
      } catch (error) {
        console.warn(`Skipping unreadable ${source.file}: ${(error as Error).message}`)
        unreadable++
        continue
      }
      const conversation = normalizeConversation(raw, source.id, source.archived, modified)
      if (await store.importConversation(conversation)) added++
      else skipped++
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  console.log(`Imported ${added}; skipped ${skipped} already in the database${unreadable ? `, ${unreadable} unreadable` : ''}.`)
} finally {
  await pool.end()
}
