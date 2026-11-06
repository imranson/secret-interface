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
- Conversations are stored in PostgreSQL (`DATABASE_URL`); the `conversations` table is created on first use
- Archive / restore: archived conversations leave the history list and open read-only until restored
- Scheduled conversations: write a prompt, press **Repeat**, pick a time. The **Scheduled** tab shows scheduled / unread / completed counts and a status for each schedule, with Run now, Pause and Delete
  - A schedule keeps the server (Cloud / Local) and model it was created with
  - Each schedule owns one conversation: the first run creates it and later runs replace its contents, including any replies. A failed run keeps the last report
  - Archiving the conversation keeps that report; the next run starts a new one
  - Runs come from a background clock (`instrumentation.ts`) that checks every 30s, so the server must be running. Anything missed while it was down runs once on start-up. Every time the app opens in a tab, each schedule shows as completed or running: any enabled schedule without an up-to-date report (never run, overdue or failed) starts then

## Setup

```sh
npm install
npm run dev        # http://localhost:3000
```

Conversations need a PostgreSQL database. Locally, any Postgres works (e.g. [Postgres.app](https://postgresapp.com) or `brew install postgresql@17`); point `DATABASE_URL` at it, such as `postgres://localhost/secret_interface` after `createdb secret_interface`.

`.env.local`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `OLLAMA_API_KEY` | Key from https://ollama.com/settings/keys (required for Cloud and for web search) | – |
| `OLLAMA_HOST` | Cloud API host | `https://ollama.com` |
| `OLLAMA_MODEL` | Default Cloud model (`:cloud`/`-cloud` suffixes are stripped) | `gpt-oss:120b` |
| `OLLAMA_LOCAL_HOST` | Local Ollama server | `http://127.0.0.1:11434` |
| `OLLAMA_LOCAL_MODEL` | Default Local model | the most recently pulled local model |
| `OLLAMA_CONTEXT_WINDOW` | Fallback context size for the meter | `128000` |
| `DATABASE_URL` | PostgreSQL connection string where conversations are stored (required) | – |
| `DATA_DIR` | Where schedules are stored, and where `npm run db:import` looks for old conversation files | `data` |
| `SYSTEM_PROMPT` | Replaces the default system prompt | – |

## Deploying (Railway / Render / Fly.io)

1. Create a Postgres database on the platform and set the app's `DATABASE_URL` to its internal/private connection string, plus `OLLAMA_API_KEY` and any other variables above. The table is created automatically on first request.
2. Build with `npm run build` and start with `npx next start` (`npm start` builds again on every boot).
3. SSL: internal URLs need none. For an external URL that requires SSL, append `?sslmode=no-verify` (encrypted, certificate not checked) or `?sslmode=verify-full` if the server's certificate is publicly trusted.

Schedules are still JSON files under `DATA_DIR`; these hosts wipe the disk on every deploy, so mount a persistent volume there to keep them.

### Importing conversations from older versions

Older versions saved conversations as JSON files under `data/conversations/` (and `archived/`). `npm run db:import` copies them into the database at `DATABASE_URL` (read from the shell, `.env.local` or `.env`), keeping their ids and archived state. Conversations already in the database are skipped, so it is safe to re-run; the files are left untouched. Pass a different data folder with `npm run db:import -- path/to/data`; to fill a hosted database, use its external URL.

## Tests

```sh
npm test               # unit + integration (never touch real data, a real database or the network)
npm run test:live      # opt-in smoke tests against the real Ollama cloud API
npm run typecheck
```

- `tests/unit` covers the libraries (config, store, agent loop, tools, token estimate, stream parsing, reducers) and components.
- `tests/integration` runs the real route handlers against an in-process Postgres ([PGlite](https://pglite.dev), standing in for `pg`), a temporary `DATA_DIR` and a scripted fake Ollama client, including a full `ChatApp` UI test whose `fetch` is routed into those handlers.

## Tips For Coders

For Ollama JS library references, see `ollama-js-ref/`.
