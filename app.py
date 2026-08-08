import streamlit as st
from session import ChatSession

st.title("Agent Chat")

session = ChatSession()

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
                if msg.get("tool_calls"):
                    st.write(str(msg["tool_calls"]))

render_messages(session.messages)

if prompt := st.chat_input("Ask something"):
    session.add_user_turn(prompt)
    render_messages(session.messages)

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
                    print(event['text'], end='')
                    thinking_placeholder.code(thinking_text)
                elif event["type"] == "content":
                    content_text += event["text"]
                    content_placeholder.markdown(content_text)

        if "tool_calls" not in session.messages[-1] or not session.messages[-1]["tool_calls"]:
            break

        with st.chat_message("assistant"):
            for event in session.run_tool_turn():
                if event["type"] == "tool_result":
                    st.caption(f"🔧 {event['name']}({event['arguments']}) → {event['result']}")
            