import json
import ollama

MODEL = "kimi-k2.6:cloud"

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

def run(prompt: str) -> str:
    messages = [{"role": "user", "content": prompt}]

    while True:
        response = ollama.chat(
            model=MODEL,
            messages=messages,
            tools=TOOL_SCHEMAS,
        )

        message = response["message"]

        if not message.get("tool_calls"):
            return message["content"]

        messages.append(message)

        for tool_call in message["tool_calls"]:
            fn = tool_call["function"]
            name = fn["name"]
            args = fn["arguments"]
            result = TOOLS[name](**args)

            messages.append({
                "role": "tool",
                "content": str(result),
            })
            print(f"TOOL {result}")

if __name__ == "__main__":
    answer = run("What is 39058704923875 + 5524352345234? Use the tools.")
    print(answer)
