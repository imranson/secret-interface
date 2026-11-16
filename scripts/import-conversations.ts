// Copies the JSON files older versions wrote into the app's database: conversations (<DATA_DIR>/conversations/ and
// its archived/ folder) and schedules (<DATA_DIR>/schedules/). They keep their ids and archived state and go to one
// account: the first one registered, or the one named with --user. Anything already in the database is skipped, so it
// is safe to run again. The files are left as they are.
//
//   npm run db:import                                                  # reads .env.local / .env like the app
//   DATABASE_URL=postgres://… npm run db:import -- ./data --user ada   # or name the database, folder and account
//
// Without DATABASE_URL it writes to the embedded database under DATA_DIR; stop the app first, as only one process can
// have that open at a time.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { getConfig } from '../lib/config'
import { getDb } from '../lib/db'
import { isValidScheduleId, normalizeSchedule, ScheduleStore } from '../lib/schedule-store'
import { ConversationStore, isValidConversationId, normalizeConversation } from '../lib/store'
import { UserStore } from '../lib/users'

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

async function sources(dir: string, archived: boolean, valid: (id: string) => boolean): Promise<Source[]> {
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
    .filter((source) => valid(source.id))
}

/** Reads each file and hands it to `add`, eight at a time. */
async function importAll(
  queue: Source[],
  add: (raw: unknown, source: Source, modified: string) => Promise<boolean | null>,
): Promise<{ added: number; skipped: number; unreadable: number }> {
  const counts = { added: 0, skipped: 0, unreadable: 0 }
  const worker = async () => {
    for (let source = queue.shift(); source; source = queue.shift()) {
      let raw: unknown
      let modified: string
      try {
        raw = JSON.parse(await fs.readFile(source.file, 'utf8'))
        modified = (await fs.stat(source.file)).mtime.toISOString()
      } catch (error) {
        console.warn(`Skipping unreadable ${source.file}: ${(error as Error).message}`)
        counts.unreadable++
        continue
      }
      const result = await add(raw, source, modified)
      if (result === null) counts.unreadable++
      else if (result) counts.added++
      else counts.skipped++
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return counts
}

const report = (what: string, { added, skipped, unreadable }: Awaited<ReturnType<typeof importAll>>) =>
  console.log(
    `Imported ${added} ${what}; skipped ${skipped} already in the database${unreadable ? `, ${unreadable} unreadable` : ''}.`,
  )

const { values, positionals } = parseArgs({ allowPositionals: true, options: { user: { type: 'string' } } })
const config = getConfig()
const dataDir = path.resolve(positionals[0] ?? config.dataDir)
const db = getDb()
const users = new UserStore(db)
const owner = values.user ? await users.findByUsername(values.user) : await users.first()
if (!owner) {
  console.error(
    values.user
      ? `There is no account called "${values.user}".`
      : 'There are no accounts yet. Create one in the app first; imports go to the first account unless you pass --user.',
  )
  await db.close()
  process.exit(1)
}
console.log(`Importing into ${config.databaseUrl ? 'DATABASE_URL' : 'the embedded database'} for ${owner.username}`)

const folder = path.join(dataDir, 'conversations')
// A conversation in both folders counts once, as active, as the old file store treated it.
const byId = new Map<string, Source>()
for (const source of [
  ...(await sources(path.join(folder, 'archived'), true, isValidConversationId)),
  ...(await sources(folder, false, isValidConversationId)),
]) {
  byId.set(source.id, source)
}
console.log(`Found ${byId.size} conversations in ${folder}`)
const conversations = new ConversationStore(db, owner.id)
report(
  'conversations',
  await importAll([...byId.values()], (raw, source, modified) =>
    conversations.importConversation(normalizeConversation(raw, source.id, source.archived, modified)),
  ),
)

const scheduleFolder = path.join(dataDir, 'schedules')
const scheduleSources = await sources(scheduleFolder, false, isValidScheduleId)
console.log(`Found ${scheduleSources.length} schedules in ${scheduleFolder}`)
const schedules = new ScheduleStore(db)
report(
  'schedules',
  await importAll(scheduleSources, async (raw, source) => {
    const schedule = normalizeSchedule(raw, source.id, owner.id)
    if (!schedule) {
      console.warn(`Skipping ${source.file}: not a schedule`)
      return null
    }
    return schedules.importSchedule(schedule)
  }),
)
await db.close()
