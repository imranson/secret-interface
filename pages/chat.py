import streamlit as st
from core.session import ChatSession, list_conversations, archive_conversation
from core.tokens import estimate_tokens
import core.model as model

st.set_page_config(page_title="Agent Chat", layout="wide")

if "session" not in st.session_state:
    st.session_state.session = ChatSession()
session = st.session_state.session

# ---- Sidebar ----
with st.sidebar:
    st.title("Chats")

    if st.button("＋ New Chat", use_container_width=True):
        st.session_state.session = ChatSession()
        st.rerun()

    model_name = st.text_input("Model", value=model.MODEL)
    thinking = st.checkbox("Thinking", value=model.THINKING)

    st.caption(f"Tokens: {estimate_tokens(session.messages):,}")
    st.divider()

    conversations = list_conversations()
    current_id = st.session_state.get("session") and st.session_state.session.conversation_id

    for conv in conversations:
        is_active = current_id == conv["id"]
        label = f"{'▸ ' if is_active else ''}{conv['title']}"
        col1, col2 = st.columns([0.85, 0.15])
        with col1:
            if st.button(
                label,
                key=conv["id"],
                use_container_width=True,
                type="primary" if is_active else "secondary",
            ):
                if not is_active:
                    st.session_state.session = ChatSession(conversation_id=conv["id"])
                    st.rerun()
        with col2:
            if st.button("📦", key=f"archive-{conv['id']}", use_container_width=True):
                archive_conversation(conv["id"])
                if is_active:
                    st.session_state.session = ChatSession()
                st.rerun()

    if not conversations:
        st.caption("No saved chats yet.")


# ---- Main ----
st.title("Nice to meet you, stranger")


def render_blob(role : str, content : str, txt_type : str) -> None:
    with st.chat_message(role):
        if txt_type == "text":
            st.text(content)
        elif txt_type == "markdown":
            st.markdown(content)
        else:
            st.code(content)

def render_expander(role : str, title : str, content : str, txt_type : str) -> None:
    with st.chat_message(role):
        with st.expander(title):
            if txt_type == "text":
                st.text(content)
            elif txt_type == "markdown":
                st.markdown(content)
            else:
                st.code(content, wrap_lines=True)

def render_messages(messages: list[dict]) -> None:
    for msg in messages:
        role = msg["role"]
        if role == "assistant":
            if msg.get("thinking"):
                render_expander(role, "Thinking", msg["thinking"], "code")
            if msg.get("content"):
                render_blob(role, msg["content"], "markdown")
        if role == "user":
            if msg.get("content"):
                render_blob(role, msg["content"], "text")
        if role == "tool":
            render_expander(role, f"{msg.get('name')}({msg.get('arguments')})", f"{msg.get('content')}", "code")

render_messages(session.messages)

if prompt := st.chat_input("Ask something"):
    session.add_user_turn(prompt)
    render_blob("user", prompt, "text")

    while True:
        with st.chat_message("assistant"):
            thinking_expander = st.expander("Thinking")
            thinking_placeholder = thinking_expander.empty()
            content_placeholder = st.empty()
            thinking_text = ""
            content_text = ""

            for event in session.run_assist_turn(model=model_name, think=thinking):
                if event["type"] == "thinking":
                    thinking_text += event["text"]
                    thinking_placeholder.code(thinking_text)
                elif event["type"] == "content":
                    content_text += event["text"]
                    content_placeholder.markdown(content_text)

        if "tool_calls" not in session.messages[-1] or not session.messages[-1]["tool_calls"]:
            break

        for event in session.run_tool_turn():
            render_expander("tool", f"{event['name']}({event['arguments']})", f"{event['content']}", "code")

    st.rerun() # after
