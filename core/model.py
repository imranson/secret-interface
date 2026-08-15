import json
import os
from datetime import datetime
from pathlib import Path

import ollama

MODEL = "glm-5.2:cloud"

def _get_secret(name: str, default: str = "") -> str:
    """Read a config value from Streamlit secrets, falling back to env vars."""
    try:
        import streamlit as st
        value = st.secrets.get(name)
        if value:
            return value
    except Exception:
        pass
    return os.getenv(name, default)

OLLAMA_HOST = _get_secret("OLLAMA_HOST", "https://ollama.com")
OLLAMA_API_KEY = _get_secret("OLLAMA_API_KEY")

CLIENT = ollama.Client(
    host=OLLAMA_HOST,
    headers={"Authorization": f"Bearer {OLLAMA_API_KEY}"} if OLLAMA_API_KEY else None,
)

_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
_SYSTEM_PROMPT = (_PROMPT_DIR / "default-system-prompt-1.md").read_text()
THINKING = True
STREAM = True

def add(a: float, b: float) -> float:
    return a + b

def multiply(a: float, b: float) -> float:
    return a * b

def get_current_datetime() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

TOOLS = {
    "add": add,
    "multiply": multiply,
    "web_search": CLIENT.web_search,
    "web_fetch": CLIENT.web_fetch,
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

def run_turn(messages: list[dict], model: str | None = None):
    stream = CLIENT.chat(
        model=model or MODEL,
        messages=[{"role": "system", "content": _SYSTEM_PROMPT}] + messages,
        tools=TOOL_SCHEMAS,
        options={"think": THINKING},
        stream=STREAM,
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
            elif event["type"] == "content":
                content_text += event["text"]
            elif event["type"] == "tool_calls":
                tool_calls.extend(event["tool_calls"])

        assistant_msg = build_assistant_message(content_text, thinking_text, tool_calls)
        messages.append(assistant_msg)

        if not tool_calls:
            # print(messages)
            return messages

        execute_tool_calls(messages, tool_calls)

if __name__ == "__main__":
    conversation = run([], "What is 35 * 29 + 54 * 47? Use the tools.")
    print(f"CONTENT {conversation[-1]['content']}")
