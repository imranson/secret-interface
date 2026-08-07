import streamlit as st
from agent import run_turn, build_assistant_message, execute_tool_calls

st.title("Agent Chat")

if "messages" not in st.session_state:
    st.session_state.messages = []

def render_messages(messages: list[dict]) -> None:
    for msg in messages:
        role = msg["role"]
        if role in ("user", "assistant"):
            with st.chat_message(role):
                if msg.get("thinking"):
                    with st.expander("Thinking"):
                        st.write(msg["thinking"])
                if msg.get("content"):
                    st.write(msg["content"])

render_messages(st.session_state.messages)

def stream_assistant_turn(messages: list[dict]) -> tuple[str, str, list[dict]]:
    thinking_text = ""
    content_text = ""
    tool_calls = []

    with st.chat_message("assistant"):
        thinking_expander = st.expander("Thinking")
        content_placeholder = st.empty()

        for event in run_turn(messages):
            if event["type"] == "thinking":
                thinking_text += event["text"]
                thinking_expander.write(thinking_text)
            elif event["type"] == "content":
                content_text += event["text"]
                content_placeholder.write(content_text)
            elif event["type"] == "tool_calls":
                tool_calls.extend(event["tool_calls"])

    return content_text, thinking_text, tool_calls

def handle_prompt(prompt: str) -> None:
    st.session_state.messages.append({"role": "user", "content": prompt})
    render_messages(st.session_state.messages)

    while True:
        content_text, thinking_text, tool_calls = stream_assistant_turn(st.session_state.messages)

        assistant_msg = build_assistant_message(content_text, thinking_text, tool_calls)
        st.session_state.messages.append(assistant_msg)

        if not tool_calls:
            break

        prev_len = len(st.session_state.messages)
        execute_tool_calls(st.session_state.messages, tool_calls)
        for tc, msg in zip(tool_calls, st.session_state.messages[prev_len:]):
            with st.chat_message("assistant"):
                st.caption(f"{tc['function']['name']}({tc['function']['arguments']}): {msg['content']}")

if prompt := st.chat_input("Ask something"):
    handle_prompt(prompt)
