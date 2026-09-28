import type { Tool } from 'ollama'

// Tool schemas are kept free of server-only imports so the client can include them in its
// context-window estimate.

export const WEB_SEARCH = 'web_search'
export const WEB_FETCH = 'web_fetch'
export const GET_CURRENT_DATETIME = 'get_current_datetime'

export const TOOL_DEFINITIONS: Tool[] = [
  {
    type: 'function',
    function: {
      name: WEB_SEARCH,
      description: 'Search the web and return the most relevant results with page excerpts.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'The search query.' },
          max_results: {
            type: 'integer',
            description: 'Maximum number of results to return (1-10, default 5).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: WEB_FETCH,
      description: 'Fetch a web page by URL and return its title, main text and links.',
      parameters: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: GET_CURRENT_DATETIME,
      description: "Get the current date, time and day of the week, in the user's time zone by default.",
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Optional IANA time zone such as "Europe/London" or "America/New_York".',
          },
        },
      },
    },
  },
]
