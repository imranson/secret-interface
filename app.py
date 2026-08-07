import streamlit as st
from agent import run

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

def handle_prompt(prompt: str) -> None:
    with st.chat_message("user"):
        st.write(prompt)

    prev_count = len(st.session_state.messages)
    st.session_state.messages = run(st.session_state.messages, prompt)

    for msg in st.session_state.messages[prev_count:]:
        role = msg["role"]
        if role == "assistant":
            with st.chat_message("assistant"):
                if msg.get("thinking"):
                    with st.expander("Thinking"):
                        st.write(msg["thinking"])
                if msg.get("tool_calls"):
                    for tc in msg["tool_calls"]:
                        name = tc["function"]["name"]
                        args = tc["function"]["arguments"]
                        st.caption(f"Tool: {name}({args})")
                if msg.get("content"):
                    st.write(msg["content"])
        elif role == "tool":
            with st.chat_message("assistant"):
                st.caption(f"Result: {msg['content']}")

if prompt := st.chat_input("Ask something"):
    handle_prompt(prompt)
