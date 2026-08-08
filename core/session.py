import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

from .agent import run_turn, build_assistant_message, execute_tool_calls

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

def list_conversations(save_dir: Path = DEFAULT_SAVE_DIR) -> list[dict]:
    """Return metadata for all saved conversations, newest first."""
    save_dir = Path(save_dir)
    if not save_dir.exists():
        return []
    conversations = []
    for f in sorted(save_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text())
        except (json.JSONDecodeError, KeyError):
            continue
        messages = data.get("messages", [])
        title = "New chat"
        for msg in messages:
            if msg.get("role") == "user" and msg.get("content"):
                title = msg["content"][:60]
                break
        conversations.append({
            "id": data.get("id", f.stem),
            "title": title,
            "updated_at": data.get("updated_at", ""),
            "message_count": len(messages),
        })
    return conversations


def delete_conversation(conversation_id: str, save_dir: Path = DEFAULT_SAVE_DIR) -> bool:
    """Delete a conversation file. Returns True if deleted, False if not found."""
    file_path = Path(save_dir) / f"{conversation_id}.json"
    if file_path.exists():
        file_path.unlink()
        return True
    return False


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