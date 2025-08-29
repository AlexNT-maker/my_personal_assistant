# main.py
# Desktop Chatbot backend — Flask + SQLite + OpenAI
# Comments & tech terms in English.

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from datetime import datetime
from dotenv import load_dotenv
from openai import OpenAI
import os

# --- Setup --------------------------------------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL   = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
assert OPENAI_API_KEY, "OPENAI_API_KEY is missing in .env"

client = OpenAI(api_key=OPENAI_API_KEY)

app = Flask(__name__)
CORS(app)

DB_URL = "sqlite:///chatbot.db"
engine = create_engine(DB_URL, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()

# --- Models -------------------------------------------------------------
class UserProfile(Base):
    __tablename__ = "user_profile"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=True)
    timezone = Column(String(60), nullable=True)
    tone = Column(String(60), nullable=True)   # e.g., professional, casual
    notes = Column(Text, nullable=True)        # short notes about preferences

class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(Integer, primary_key=True)
    title = Column(String(200), default="New Conversation")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    role = Column(String(20), nullable=False)      # 'user' | 'assistant' | 'system'
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    conversation = relationship("Conversation", back_populates="messages")

Base.metadata.create_all(engine)

# --- Helpers ------------------------------------------------------------
def get_session():
    return SessionLocal()

def ensure_profile(session):
    prof = session.query(UserProfile).first()
    if not prof:
        prof = UserProfile(name=None, timezone="Europe/Athens", tone="professional", notes=None)
        session.add(prof)
        session.commit()
    return prof

def title_from_first_user_message(history):
    """history: list of dicts with keys role/content (text only)"""
    for m in history:
        if m["role"] == "user":
            text = (m["content"] if isinstance(m["content"], str) else "").strip().splitlines()[0]
            return (text[:40] + "…") if len(text) > 40 else text
    return "New Conversation"

# --- UI -----------------------------------------------------------------
@app.get("/")
def home():
    return render_template("index.html")

# --- Profile CRUD -------------------------------------------------------
@app.get("/api/profile")
def get_profile():
    s = get_session()
    prof = ensure_profile(s)
    return jsonify({
        "id": prof.id,
        "name": prof.name,
        "timezone": prof.timezone,
        "tone": prof.tone,
        "notes": prof.notes
    })

@app.put("/api/profile")
def update_profile():
    s = get_session()
    prof = ensure_profile(s)
    data = request.json or {}
    prof.name = data.get("name", prof.name)
    prof.timezone = data.get("timezone", prof.timezone)
    prof.tone = data.get("tone", prof.tone)
    notes = data.get("notes", prof.notes)
    if notes and len(notes) > 500:
        return jsonify({"error": "Notes too long (max 500 chars)."}), 400
    prof.notes = notes
    s.commit()
    return jsonify({"ok": True})

@app.delete("/api/profile")
def delete_profile():
    s = get_session()
    prof = s.query(UserProfile).first()
    if prof:
        s.delete(prof)
        s.commit()
    return jsonify({"ok": True})

# --- Conversations CRUD -------------------------------------------------
@app.post("/api/conversations")
def create_conversation():
    s = get_session()
    c = Conversation(title="New Conversation")
    s.add(c)
    s.commit()
    return jsonify({"id": c.id, "title": c.title})

@app.get("/api/conversations")
def list_conversations():
    s = get_session()
    convos = s.query(Conversation).order_by(Conversation.updated_at.desc()).all()
    return jsonify([
        {"id": c.id, "title": c.title, "updated_at": c.updated_at.isoformat()} for c in convos
    ])

@app.delete("/api/conversations/<int:cid>")
def delete_conversation(cid):
    s = get_session()
    c = s.query(Conversation).get(cid)
    if not c:
        return jsonify({"error": "Not found"}), 404
    s.delete(c)
    s.commit()
    return jsonify({"ok": True})

# --- Messages -----------------------------------------------------------
@app.get("/api/messages/<int:cid>")
def list_messages(cid):
    s = get_session()
    c = s.query(Conversation).get(cid)
    if not c:
        return jsonify({"error": "Not found"}), 404
    msgs = [{
        "id": m.id, "role": m.role, "content": m.content,
        "created_at": m.created_at.isoformat()
    } for m in c.messages]
    return jsonify(msgs)

# --- Chat endpoint (text + images) -------------------------------------
@app.post("/api/chat")
def chat():
    """
    JSON body:
    {
      "conversation_id": <int|null>,
      "message": "User text",
      "images": [ {"mime": "image/png", "b64": "<base64>"} ]   # optional
    }
    """
    s = get_session()
    data = request.json or {}
    text = (data.get("message") or "").strip()
    images = data.get("images", [])

    if not text and not images:
        return jsonify({"error": "Empty message"}), 400

    # Get or create conversation
    cid = data.get("conversation_id")
    if cid:
        convo = s.query(Conversation).get(cid)
        if not convo:
            return jsonify({"error": "Conversation not found"}), 404
    else:
        convo = Conversation(title="New Conversation")
        s.add(convo)
        s.flush()  # get convo.id

    # Persist user text message (store only text for now)
    user_text_to_store = text if text else "[image(s) uploaded]"
    m_user = Message(conversation_id=convo.id, role="user", content=user_text_to_store)
    s.add(m_user)
    s.commit()

    # Build history for the API call (string-only from DB)
    history = [
        {"role": m.role, "content": m.content}
        for m in s.query(Message)
                .filter_by(conversation_id=convo.id)
                .order_by(Message.id)
                .all()
    ]

    # Personalization from profile
    prof = ensure_profile(s)
    profile_note = f"User name: {prof.name or 'User'}. Timezone: {prof.timezone or 'Europe/Athens'}. Tone: {prof.tone or 'professional'}."
    if prof.notes:
        profile_note += f" Extra notes: {prof.notes[:300]}"

    system_msg = {
    "role": "system",
    "content": (
        "You are a mentor-style assistant. Use Greek for prose and keep technical terms in English. "
        "Write with clear structure using Markdown. Default to short paragraphs with whitespace. "
        "Use bullet lists when enumerating, tables for comparisons when helpful, and fenced code blocks with language. "
        "Prefer clarity over verbosity; add small headings if it aids scanning. "
        "Preserve privacy; avoid storing sensitive data. "
        + profile_note
    )
}


    # If images are attached, send a multimodal last user turn (text + images)
    user_content_parts = []
    if text:
        user_content_parts.append({"type": "text", "text": text})
    for img in images:
        data_url = f"data:{img.get('mime','image/png')};base64,{img.get('b64','')}"
        user_content_parts.append({"type": "image_url", "image_url": {"url": data_url}})

    api_messages = [system_msg] + history
    if user_content_parts:
        # replace the last history user text with the parts
        if api_messages and api_messages[-1]["role"] == "user":
            api_messages.pop()
        api_messages.append({"role": "user", "content": user_content_parts})

    # Call OpenAI
    try:
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=api_messages,
            temperature=0.4,
        )
        answer = resp.choices[0].message.content
    except Exception as e:
        return jsonify({"error": f"OpenAI error: {str(e)}"}), 500

    # Save assistant message
    m_assistant = Message(conversation_id=convo.id, role="assistant", content=answer)
    s.add(m_assistant)

    # Auto-title on first reply
    if convo.title == "New Conversation":
        convo.title = title_from_first_user_message(history) or "New Conversation"

    convo.updated_at = datetime.utcnow()
    s.commit()

    return jsonify({
        "conversation_id": convo.id,
        "reply": answer
    })

# --- Main ---------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
