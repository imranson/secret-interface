import type { Tool } from 'ollama'

// Tool schemas are kept free of server-only imports so the client can include them in its
// context-window estimate.

export const WEB_SEARCH = 'web_search'
export const WEB_FETCH = 'web_fetch'
export const GET_CURRENT_DATETIME = 'get_current_datetime'
export const CALCULATE = 'calculate'

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
  {
    type: 'function',
    function: {
      name: CALCULATE,
      description:
        'Evaluate a math expression with the math.js parser. Use it for any non-trivial arithmetic instead of ' +
        'calculating in your head. Supports arithmetic, functions (sqrt, log = natural log, log10, sin with ' +
        'radians or "30 deg", factorial, gcd, combinations…), constants (pi, e, i), complex numbers, matrices ' +
        '([1, 2; 3, 4], det, inv), units ("5 cm to inch"), statistics (mean, median, std), exact fractions ' +
        '(fraction(1, 3)), high precision (bignumber("2")^100), variables and functions (a = 3; f(x) = x^2; ' +
        'f(a)) and symbolic derivative("x^2", "x") / simplify("2x + 3x").',
      parameters: {
        type: 'object',
        required: ['expression'],
        properties: {
          expression: {
            type: 'string',
            description:
              'The expression. Put several on separate lines to get each result; a statement ending in ";" is evaluated without showing its result.',
          },
        },
      },
    },
  },
]
