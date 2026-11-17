# secret interface (v2)

A chat client for Ollama models, built with Next.js, TypeScript, the Ollama JS SDK and `react-markdown` + `remark-gfm`. Model calls go to the Ollama web API (`https://ollama.com`) by default; a **Cloud / Local** switch in the composer sends them to a local Ollama server instead.

## Features

- Streaming chat: thinking tokens, answer tokens and tool calls stream live over NDJSON
- Assistant replies rendered as GitHub-flavoured Markdown in Source Serif 4
- Thinking control (auto / off / on / low / medium / high), falling back automatically for models without thinking
- Tools: `web_search` and `web_fetch` (Ollama web API), `get_current_datetime` (uses the browser's time zone) and `calculate` ([math.js](https://mathjs.org) expressions, run in a throwaway worker capped at 5s and 256 MB)
- Default system prompt (`lib/prompts.ts`, override with `SYSTEM_PROMPT`)
- Conversation history with a new-conversation button and model picker; the sidebar collapses from the top bar (remembered in a cookie)
- Cloud / Local switch: picks which Ollama server lists the models and answers. The choice, and the model picked on each, are remembered in the browser. Local model names keep their `:cloud`/`-cloud` suffix, which a local server needs to proxy cloud models. Web search and fetch always go through ollama.com, so they still need `OLLAMA_API_KEY`; a local server never receives the key
- Rough context-window meter (~4 chars/token against the model's context length from `/api/show`)
- Accounts: anyone can register with a username and password (or only people with an invite code, if `REGISTRATION_CODE` is set). Each account sees only its own conversations and schedules. Every account uses the server's one `OLLAMA_API_KEY`
  - Passwords are hashed with scrypt; sessions last 30 days in an HttpOnly cookie (Secure over HTTPS) and end on Sign out
  - The first account registered takes over any conversations and schedules saved before accounts existed
- Data (accounts, conversations, schedules) lives in PostgreSQL when `DATABASE_URL` is set; otherwise in an embedded PostgreSQL ([PGlite](https://pglite.dev)) under `DATA_DIR/db`. Tables are created on first use
- Archive / restore: archived conversations leave the history list and open read-only until restored
- Scheduled conversations: write a prompt, press **Repeat**, pick a time. The **Scheduled** tab shows scheduled / unread / completed counts and a status for each schedule, with Run now, Pause and Delete
  - A schedule keeps the server (Cloud / Local) and model it was created with
  - Each schedule owns one conversation: the first run creates it and later runs replace its contents, including any replies. A failed run keeps the last report
  - Archiving the conversation keeps that report; the next run starts a new one
  - Schedules run when someone opens the app, not at their set time, so the server can sleep while idle: each account's enabled schedules without an up-to-date report (never run, overdue or failed) start when that account opens the app, and an open tab starts any that come due
  - With `SERVERLESS=false`, a background clock (`instrumentation.ts`) also runs schedules on time, checking every 30s, so the server must stay running. Anything missed while it was down runs once on start-up

## Setup

```sh
npm install
npm run dev        # http://localhost:3000, then create an account
```

No database setup is needed: without `DATABASE_URL` the app keeps everything in `data/db`. To use your own Postgres instead (e.g. [Postgres.app](https://postgresapp.com) or `brew install postgresql@17`), set `DATABASE_URL`, such as `postgres://localhost/secret_interface` after `createdb secret_interface`. Only one server process can open the embedded database at a time.

`.env.local`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `OLLAMA_API_KEY` | Key from https://ollama.com/settings/keys (required for Cloud and for web search) | – |
| `OLLAMA_HOST` | Cloud API host | `https://ollama.com` |
| `OLLAMA_MODEL` | Default Cloud model (`:cloud`/`-cloud` suffixes are stripped) | `gpt-oss:120b` |
| `OLLAMA_LOCAL_HOST` | Local Ollama server | `http://127.0.0.1:11434` |
| `OLLAMA_LOCAL_MODEL` | Default Local model | the most recently pulled local model |
| `OLLAMA_CONTEXT_WINDOW` | Fallback context size for the meter | `128000` |
| `DATABASE_URL` | PostgreSQL connection string. Unset: the embedded database under `DATA_DIR` | – |
| `DATA_DIR` | Where the embedded database lives, and where `npm run db:import` looks for old files | `data` |
| `REGISTRATION_CODE` | When set, creating an account needs this invite code | – (open sign-up) |
| `SYSTEM_PROMPT` | Replaces the default system prompt | – |
| `SERVERLESS` | `false` turns on the scheduler's clock, so schedules run on time but the app never sleeps | `true` |

## Deploying on Railway

The repo deploys as-is: `railway.json` tells Railway to build the `Dockerfile`, run one replica and health-check `/api/health`.

1. Push the repo to GitHub, then in Railway: **New Project → Deploy from GitHub repo**.
2. Add a database: **New → Database → PostgreSQL**. In the app service's **Variables**, add `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (the private URL; no SSL settings needed).
3. Add `OLLAMA_API_KEY`, plus any other variables above. Consider `REGISTRATION_CODE`: sign-up is otherwise open to anyone with the URL, and every account spends the same API key.
4. **Settings → Networking → Generate Domain**. Railway sets `PORT` and the app listens on it.
5. Open the URL and create the first account; it takes over anything saved before accounts existed.

Keep a single replica: the scheduler and in-progress runs live in the server's memory.

Railway's **Settings → Serverless** works out of the box: the app sleeps about 10 minutes after the last visible tab closes. Don't set `SERVERLESS=false` with it: the scheduler's clock queries the database every 30s, which Railway counts as activity, so the app would never sleep.

Without `DATABASE_URL` the app still runs, using the embedded database at `/app/data`, but a redeploy wipes it unless you attach a volume at `/app/data`. Railway mounts volumes as root while the image runs as the `node` user, so also set `RAILWAY_RUN_UID=0`.

The image works on any Docker host too: `docker build -t secret-interface .` then `docker run -p 3000:3000 -e OLLAMA_API_KEY=… -e DATABASE_URL=… secret-interface`. For an external database URL that requires SSL, append `?sslmode=no-verify` (encrypted, certificate not checked) or `?sslmode=verify-full` if the server's certificate is publicly trusted.

### Importing from older versions

Older versions saved conversations as JSON files under `data/conversations/` (and `archived/`) and schedules under `data/schedules/`. `npm run db:import` copies them into the app's database (`DATABASE_URL` from the shell, `.env.local` or `.env`; otherwise the embedded one, so stop the app first), keeping their ids and archived state. They go to the first account registered, or to `--user <name>`, so create an account first. Anything already in the database is skipped, so it is safe to re-run; the files are left untouched. Pass a different data folder with `npm run db:import -- path/to/data`; to fill a hosted database, use its external URL.

A database from v2 (conversations in Postgres, no accounts) needs no import: the first account registered takes those conversations over.

## Tests

```sh
npm test               # unit + integration (never touch real data, a real database or the network)
npm run test:live      # opt-in smoke tests against the real Ollama cloud API
npm run typecheck
```

- `tests/unit` covers the libraries (config, store, agent loop, tools, token estimate, stream parsing, reducers) and components.
- `tests/integration` runs the real route handlers, signed in as a test account, against an in-process Postgres ([PGlite](https://pglite.dev), standing in for `pg`), a temporary `DATA_DIR` and a scripted fake Ollama client, including full `ChatApp` and sign-in UI tests whose `fetch` is routed into those handlers.

## Tips For Coders

For Ollama JS library references, see `ollama-js-ref/`.
