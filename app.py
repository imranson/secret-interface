import streamlit as st
from session import ChatSession, list_conversations, delete_conversation

st.set_page_config(page_title="Agent Chat", layout="wide")

# ---- Sidebar ----
with st.sidebar:
    st.title("Chats")

    if st.button("＋ New Chat", use_container_width=True):
        st.session_state.session = ChatSession()
        st.rerun()

    st.divider()

    conversations = list_conversations()
    current_id = st.session_state.get("session") and st.session_state.session.conversation_id

    for conv in conversations:
        is_active = current_id == conv["id"]
        label = f"{'▸ ' if is_active else ''}{conv['title']}"
        if st.button(
            label,
            key=conv["id"],
            use_container_width=True,
            type="primary" if is_active else "secondary",
        ):
            if not is_active:
                st.session_state.session = ChatSession(conversation_id=conv["id"])
                st.rerun()

    if not conversations:
        st.caption("No saved chats yet.")

# ---- Main ----
st.title("Agent Chat")

if "session" not in st.session_state:
    st.session_state.session = ChatSession()
session = st.session_state.session


def render_messages(messages: list[dict]) -> None:
    for msg in messages:
        role = msg["role"]
        if role in ("user", "assistant"):
            with st.chat_message(role):
                if msg.get("thinking"):
                    with st.expander("Thinking"):
                        st.code(msg["thinking"])
                if msg.get("content"):
                    st.markdown(msg["content"])
                if msg.get("tool_calls"):
                    st.code(str(msg["tool_calls"]))


render_messages(session.messages)

if prompt := st.chat_input("Ask something"):
    session.add_user_turn(prompt)
    with st.chat_message("user"):
        st.markdown(prompt)

    while True:
        with st.chat_message("assistant"):
            thinking_expander = st.expander("Thinking")
            thinking_placeholder = thinking_expander.empty()
            content_placeholder = st.empty()
            thinking_text = ""
            content_text = ""

            for event in session.run_assist_turn():
                if event["type"] == "thinking":
                    thinking_text += event["text"]
                    thinking_placeholder.code(thinking_text)
                elif event["type"] == "content":
                    content_text += event["text"]
                    content_placeholder.markdown(content_text)

        if "tool_calls" not in session.messages[-1] or not session.messages[-1]["tool_calls"]:
            break

        with st.chat_message("assistant"):
            for event in session.run_tool_turn():
                tool_expander = st.expander(f"{event['name']}({event['arguments']})").empty()
                if event["type"] == "tool_result":
                    tool_expander.code(f"{event['result']}")
