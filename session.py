import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

from agent import run_turn, build_assistant_message, execute_tool_calls

DEFAULT_SAVE_DIR = Path("./conversations")


class ChatSession:
    def __init__(self, conversation_id: str | None = None, save_dir: Path = DEFAULT_SAVE_DIR):
        self.save_dir = Path(save_dir)
        self.save_dir.mkdir(parents=True, exist_ok=True)
        if conversation_id:
            try:
                self.messages: list[dict] = json.loads(
                    (save_dir / f"{conversation_id}.json").read_text()
                )["messages"]
            except FileNotFoundError:
                conversation_id = None
        if not conversation_id:
            self.messages: list[dict] = []
        self.conversation_id = conversation_id or uuid.uuid4().hex

    @property
    def _file_path(self) -> Path:
        return self.save_dir / f"{self.conversation_id}.json"

    def _save(self) -> None:
        data = {
            "id": self.conversation_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "messages": self.messages,
        }
        self._file_path.write_text(json.dumps(data, indent=2, default=vars))

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
        self._save()

    def run_tool_turn(self) -> Generator[dict, None, None]:
        prev_len = len(self.messages)
        tool_calls = self.messages[-1]["tool_calls"]
        execute_tool_calls(self.messages, tool_calls)
        self._save()
        for tc, msg in zip(tool_calls, self.messages[prev_len:]):
            yield {
                "type": "tool_result",
                "name": tc["function"]["name"],
                "arguments": tc["function"]["arguments"],
                "result": msg["content"],
            }

    def add_user_turn(self, prompt: str) -> None:
        self.messages.append({"role": "user", "content": prompt})
        self._save()

if __name__ == "__main__":
    session = ChatSession()
    session.add_user_turn("What is 35 * 29 + 54 * 47? Use the tools.")

    while True:
        for event in session.run_assist_turn():
            if event["type"] == "thinking":
                print(event["text"], end="", flush=True)
            elif event["type"] == "content":
                print(event["text"], end="", flush=True)

        print()  # newline after streaming

        if "tool_calls" not in session.messages[-1] or not session.messages[-1]["tool_calls"]:
            print(session.messages)
            break

        for event in session.run_tool_turn():
            print(f"Tool {event['name']}({event['arguments']}): {event['result']}")