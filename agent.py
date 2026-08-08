import ollama
from ollama import WebFetchResponse, WebSearchResponse, web_fetch, web_search

MODEL = "minimax-m3:cloud"

def add(a: float, b: float) -> float:
    return a + b

def multiply(a: float, b: float) -> float:
    return a * b

TOOLS = {
    "add": add,
    "multiply": multiply,
    "web_search": web_search,
    "web_fetch": web_fetch,
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
                        "description": "Maximum number of results to return (default: 10)",
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
]

def run_turn(messages: list[dict]):
    stream = ollama.chat(
        model=MODEL,
        messages=messages,
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


def format_web_search_result(result: WebSearchResponse, query: str) -> str:
    lines = [f'Search results for "{query}":']
    # print('rresult nnum')
    # print(len(result.results))
    for r in result.results:
        lines.append(f"Title: {r.title or '(no title)'}")
        lines.append(f"URL: {r.url or '(no url)'}")
        lines.append(f"Content: {r.content or '(no content)'}")
        lines.append("")
    return "\n".join(lines).rstrip()


def format_web_fetch_result(result: WebFetchResponse, url: str) -> str:
    lines = [f'Fetch results for "{url}":']
    lines.append(f"Title: {result.title or '(no title)'}")
    lines.append(f"Content: {result.content or '(no content)'}")
    if result.links:
        lines.append(f"Links: {', '.join(result.links)}")
    return "\n".join(lines)


def execute_tool_calls(messages: list[dict], tool_calls: list[dict]) -> None:
    for tool_call in tool_calls:
        fn = tool_call["function"]
        name = fn["name"]
        args = fn["arguments"]
        result = TOOLS[name](**args)

        if name == "web_search":
            content = format_web_search_result(result, args.get("query", ""))
        elif name == "web_fetch":
            content = format_web_fetch_result(result, args.get("url", ""))
        else:
            content = str(result)

        messages.append({
            "role": "tool",
            "content": content,
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
