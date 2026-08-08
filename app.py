import streamlit as st

st.set_page_config(page_title="Agent Chat", layout="wide")

pages = [
    st.Page("pages/chat.py", title="Chat", icon="💬"),
    st.Page("pages/home.py", title="Home", icon="🏠"),
]

pg = st.navigation(pages)
pg.run()
