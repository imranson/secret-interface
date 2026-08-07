import json
import ollama

MODEL = "minimax-m2.7:cloud"

def add(a: float, b: float) -> float:
    return a + b

def multiply(a: float, b: float) -> float:
    return a * b

TOOLS = {
    "add": add,
    "multiply": multiply,
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
]

def run_turn(messages: list[dict]) -> tuple[str, str, list[dict]]:
    thinking_text = ""
    content_text = ""
    tool_calls = []

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
            thinking_text += msg["thinking"]
        if msg.get("content"):
            content_text += msg["content"]
        if msg.get("tool_calls"):
            tcs = msg["tool_calls"]
            if not isinstance(tcs, list):
                tcs = [tcs]
            tool_calls.extend(tcs)

    return content_text, thinking_text, tool_calls


def execute_tool_calls(messages: list[dict], tool_calls: list[dict]) -> None:
    for tool_call in tool_calls:
        fn = tool_call["function"]
        name = fn["name"]
        args = fn["arguments"]
        result = TOOLS[name](**args)

        messages.append({
            "role": "tool",
            "content": str(result),
        })
        print(f"TOOL {result}")


def build_assistant_message(content_text: str, thinking_text: str, tool_calls: list[dict]) -> dict:
    msg = {"role": "assistant", "content": content_text, "thinking": thinking_text}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return msg


def run(prompt: str) -> str:
    messages = [{"role": "user", "content": prompt}]

    while True:
        content_text, thinking_text, tool_calls = run_turn(messages)

        if thinking_text:
            print(f"THINKING: {thinking_text}")

        assistant_msg = build_assistant_message(content_text, thinking_text, tool_calls)
        messages.append(assistant_msg)

        if not tool_calls:
            return content_text

        execute_tool_calls(messages, tool_calls)

if __name__ == "__main__":
    answer = run("What is 375 + 554 * 347? Use the tools.")
    print(f"CONTENT {answer}")
