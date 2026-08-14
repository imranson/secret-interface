import json
import re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

import httpx
import ollama

MODEL = "kimi-k2.6:cloud"

_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
_SYSTEM_PROMPT = (_PROMPT_DIR / "default-system-prompt-1.md").read_text()

def add(a: float, b: float) -> float:
    return a + b

def multiply(a: float, b: float) -> float:
    return a * b

def get_current_datetime() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# Custom web_fetch / web_search — replaces ollama.web_fetch / ollama.web_search
# which moved to the Ollama Cloud API (ollama.com) in v0.6.x and return 404.
# ---------------------------------------------------------------------------

class _TextExtractor(HTMLParser):
    """Extract visible text from HTML, discarding tags/scripts/styles."""

    def __init__(self):
        super().__init__()
        self.text: list[str] = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self._skip = False
        elif tag in ("p", "br", "li", "div", "h1", "h2", "h3", "h4", "h5", "h6"):
            self.text.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.text.append(data)


def _extract_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    raw = "".join(parser.text)
    # Collapse whitespace
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def web_fetch(url: str) -> dict:
    """Fetch and extract the text content of a web page."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SecretInterface/1.0)",
    }
    try:
        r = httpx.get(url, headers=headers, follow_redirects=True, timeout=15)
        r.raise_for_status()
        content_type = r.headers.get("content-type", "")
        if "text/html" in content_type:
            text = _extract_text(r.text)
        else:
            text = r.text
        # Truncate to a reasonable length for the model
        return {
            "title": url,
            "content": text[:8000],
            "links": [],
        }
    except Exception as exc:
        return {"title": url, "content": f"Error fetching URL: {exc}", "links": []}


def web_search(query: str, max_results: int = 3) -> dict:
    """Search the web using DuckDuckGo HTML search (no API key needed)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SecretInterface/1.0)",
    }
    try:
        r = httpx.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers=headers,
            timeout=15,
        )
        r.raise_for_status()
        results = _parse_ddg_html(r.text, max_results)
        return {"results": results}
    except Exception as exc:
        return {"results": [{"title": "Error", "url": "", "content": str(exc)}]}


def _parse_ddg_html(html: str, max_results: int) -> list[dict]:
    """Extract search results from DuckDuckGo HTML search page."""
    results: list[dict] = []
    # Split by result blocks and extract link + snippet from each
    blocks = re.split(r'<div[^>]*class="[^"]*result[^"]*"[^>]*>', html)[1:]
    for block in blocks[:max_results]:
        link_match = re.search(
            r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
            block,
            re.IGNORECASE | re.DOTALL,
        )
        snippet_match = re.search(
            r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
            block,
            re.IGNORECASE | re.DOTALL,
        )
        if link_match:
            url = link_match.group(1)
            title = re.sub(r"<[^>]+>", "", link_match.group(2)).strip()
            snippet = (
                re.sub(r"<[^>]+>", "", snippet_match.group(1)).strip()
                if snippet_match
                else ""
            )
            results.append({"title": title, "url": url, "content": snippet})
    return results


TOOLS = {
    "add": add,
    "multiply": multiply,
    "web_search": web_search,
    "web_fetch": web_fetch,
    "get_current_datetime": get_current_datetime,
}

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "add",
            "description": "Add two numbers",
            "parameters": {
                "type": "object",
                "properties": {
                    "a": {"type": "number"},
                    "b": {"type": "number"},
                },
                "required": ["a", "b"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "multiply",
            "description": "Multiply two numbers",
            "parameters": {
                "type": "object",
                "properties": {
                    "a": {"type": "number"},
                    "b": {"type": "number"},
                },
                "required": ["a", "b"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for information. Returns results with title, URL, and content snippet.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results to return is 10. If not given, 3 is the default max.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Fetch and extract the content of a web page from a URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to fetch content from",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_datetime",
            "description": "Get the current date and time. Returns a string in YYYY-MM-DD HH:MM:SS format.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]

def run_turn(messages: list[dict]):
    stream = ollama.chat(
        model=MODEL,
        messages=[{"role": "system", "content": _SYSTEM_PROMPT}] + messages,
        tools=TOOL_SCHEMAS,
        options={"think": True},
        stream=True,
    )

    for chunk in stream:
        msg = chunk["message"]
        if msg.get("thinking"):
            yield {"type": "thinking", "text": msg["thinking"]}
        if msg.get("content"):
            yield {"type": "content", "text": msg["content"]}
        if msg.get("tool_calls"):
            tcs = msg["tool_calls"]
            if not isinstance(tcs, list):
                tcs = [tcs]
            yield {"type": "tool_calls", "tool_calls": tcs}


def _to_json(result) -> str:
    return json.dumps(result, default=vars)

def execute_tool_calls(messages: list[dict], tool_calls: list[dict]) -> None:
    for tool_call in tool_calls:
        fn = tool_call["function"]
        name = fn["name"]
        args = fn["arguments"]
        result = TOOLS[name](**args)
        messages.append({
            "role": "tool",
            "name": name,
            "arguments": args,
            "content": _to_json(result),
        })


def build_assistant_message(content_text: str, thinking_text: str, tool_calls: list[dict]) -> dict:
    msg = {"role": "assistant", "content": content_text, "thinking": thinking_text}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return msg


def run(messages: list[dict], prompt: str) -> list[dict]:
    messages.append({"role": "user", "content": prompt})

    while True:
        thinking_text = ""
        content_text = ""
        tool_calls = []

        for event in run_turn(messages):
            if event["type"] == "thinking":
                thinking_text += event["text"]
                # print(event["text"], end="", flush=True)
            elif event["type"] == "content":
                content_text += event["text"]
                # print(event["text"], end="", flush=True)
            elif event["type"] == "tool_calls":
                tool_calls.extend(event["tool_calls"])

        # print()  # newline after streaming

        assistant_msg = build_assistant_message(content_text, thinking_text, tool_calls)
        messages.append(assistant_msg)

        if not tool_calls:
            # print(messages)
            return messages

        execute_tool_calls(messages, tool_calls)

if __name__ == "__main__":
    conversation = run([], "What is 35 * 29 + 54 * 47? Use the tools.")
    print(f"CONTENT {conversation[-1]['content']}")
