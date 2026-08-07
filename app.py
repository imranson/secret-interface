import streamlit as st
from agent import run

st.title("Agent")

if "messages" not in st.session_state:
    st.session_state.messages = []

for msg in st.session_state.messages:
    role = msg["role"]
    if role in ("user", "assistant"):
        with st.chat_message(role):
            if msg.get("thinking"):
                with st.expander("Thinking"):
                    st.write(msg["thinking"])
            if msg.get("content"):
                st.write(msg["content"])

if prompt := st.chat_input("Ask something"):
    with st.chat_message("user"):
        st.write(prompt)

    with st.chat_message("assistant"):
        st.session_state.messages = run(st.session_state.messages, prompt)
        last = st.session_state.messages[-1]
        if last.get("thinking"):
            with st.expander("Thinking"):
                st.write(last["thinking"])
        st.write(last["content"])
