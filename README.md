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
- Archive / restore: moves files between `data/conversations/` and `data/conversations/archived/`
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

`.env.local`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `OLLAMA_API_KEY` | Key from https://ollama.com/settings/keys (required for Cloud and for web search) | – |
| `OLLAMA_HOST` | Cloud API host | `https://ollama.com` |
| `OLLAMA_MODEL` | Default Cloud model (`:cloud`/`-cloud` suffixes are stripped) | `gpt-oss:120b` |
| `OLLAMA_LOCAL_HOST` | Local Ollama server | `http://127.0.0.1:11434` |
| `OLLAMA_LOCAL_MODEL` | Default Local model | the most recently pulled local model |
| `OLLAMA_CONTEXT_WINDOW` | Fallback context size for the meter | `128000` |
| `DATA_DIR` | Where conversations and schedules are stored | `data` |
| `SYSTEM_PROMPT` | Replaces the default system prompt | – |

## Tests

```sh
npm test               # unit + integration (never touch real data or the network)
npm run test:live      # opt-in smoke tests against the real Ollama cloud API
npm run typecheck
```

- `tests/unit` covers the libraries (config, store, agent loop, tools, token estimate, stream parsing, reducers) and components.
- `tests/integration` runs the real route handlers against a temporary `DATA_DIR` with a scripted fake Ollama client, including a full `ChatApp` UI test whose `fetch` is routed into those handlers.

## Tips For Coders

For Ollama JS library references, see `ollama-js-ref/`.
