from typing import Generator

from agent import run_turn, build_assistant_message, execute_tool_calls

class ChatSession:
    def __init__(self):
        self.messages = []

    def run_assist_turn(self) -> Generator[dict, None, None]:
        thinking_text = ""
        content_text = ""
        tool_calls = []

        for event in run_turn(self.messages):
            if event["type"] == "thinking":
                thinking_text += event["text"]
                yield {"type": "thinking", "text": event["text"]}
            elif event["type"] == "content":
                content_text += event["text"]
                yield {"type": "content", "text": event["text"]}
            elif event["type"] == "tool_calls":
                tool_calls.extend(event["tool_calls"])

        assistant_msg = build_assistant_message(content_text, thinking_text, tool_calls)
        self.messages.append(assistant_msg)

    def run_tool_turn(self) -> Generator[dict, None, None]:
        prev_len = len(self.messages)
        tool_calls = self.messages[-1]["tool_calls"]
        execute_tool_calls(self.messages, tool_calls)
        for tc, msg in zip(tool_calls, self.messages[prev_len:]):
            yield {
                "type": "tool_result",
                "name": tc["function"]["name"],
                "arguments": tc["function"]["arguments"],
                "result": msg["content"],
            }

    def add_user_turn(self, prompt: str) -> None:
        self.messages.append({"role": "user", "content": prompt})

if __name__ == "__main__":
    session = ChatSession()
    session.add_user_turn("What is 35 * 29 + 54 * 47? Use the tools.")
    
    while True:
        thinking_text = ""
        content_text = ""
        tool_calls = []

        for event in run_turn(session.messages):
            if event["type"] == "thinking":
                thinking_text += event["text"]
                print(event["text"], end="", flush=True)
            elif event["type"] == "content":
                content_text += event["text"]
                print(event["text"], end="", flush=True)
            elif event["type"] == "tool_calls":
                tool_calls.extend(event["tool_calls"])

        print()  # newline after streaming

        assistant_msg = build_assistant_message(content_text, thinking_text, tool_calls)
        session.messages.append(assistant_msg)

        if not tool_calls:
            print(session.messages)
            break

        execute_tool_calls(session.messages, tool_calls)