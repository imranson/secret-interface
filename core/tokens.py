import json


def estimate_tokens(messages: list[dict]) -> int:
    """Estimate the token count of a conversation using the char/4 heuristic."""
    return sum(_message_chars(msg) for msg in messages) // 4


def _message_chars(msg: dict) -> int:
    """Count the characters of a single message's text fields."""
    chars = _len(msg.get("content"))
    chars += _len(msg.get("thinking"))
    for tool_call in msg.get("tool_calls") or []:
        fn = tool_call.get("function") or {}
        chars += _len(fn.get("name"))
        chars += _len(fn.get("arguments"))
    if msg.get("role") == "tool":
        chars += _len(msg.get("name"))
        chars += _len(msg.get("arguments"))
    return chars


def _len(value) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value)
    return len(json.dumps(value, default=vars))
