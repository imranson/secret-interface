# secret interface (v2)

A chat client for Ollama **cloud** models, built with Next.js, TypeScript, the Ollama JS SDK and `react-markdown` + `remark-gfm`. All model calls go to the Ollama web API (`https://ollama.com`); no local Ollama server is needed.

## Features

- Streaming chat: thinking tokens, answer tokens and tool calls stream live over NDJSON
- Assistant replies rendered as GitHub-flavoured Markdown in Source Serif 4
- Thinking control (auto / off / on / low / medium / high), falling back automatically for models without thinking
- Tools: `web_search` and `web_fetch` (Ollama web API) plus `get_current_datetime` (uses the browser's time zone)
- Default system prompt (`lib/prompts.ts`, override with `SYSTEM_PROMPT`)
- Conversation history with a new-conversation button and model picker; the sidebar collapses from the top bar (remembered in a cookie)
- Rough context-window meter (~4 chars/token against the model's context length from `/api/show`)
- Archive / restore: moves files between `data/conversations/` and `data/conversations/archived/`

## Setup

```sh
npm install
npm run dev        # http://localhost:3000
```

`.env.local`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `OLLAMA_API_KEY` | Key from https://ollama.com/settings/keys (required) | – |
| `OLLAMA_HOST` | API host | `https://ollama.com` |
| `OLLAMA_MODEL` | Default model (`:cloud`/`-cloud` suffixes are stripped) | `gpt-oss:120b` |
| `OLLAMA_CONTEXT_WINDOW` | Fallback context size for the meter | `128000` |
| `DATA_DIR` | Where conversations are stored | `data` |
| `SYSTEM_PROMPT` | Replaces the default system prompt | – |
| `MAX_TOOL_ROUNDS` | Tool-calling turns before a final answer is forced | `8` |

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
