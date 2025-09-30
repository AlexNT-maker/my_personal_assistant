# main.py
# Desktop Chatbot backend — Flask + SQLite + OpenAI

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from datetime import datetime
from dotenv import load_dotenv
from openai import OpenAI
from werkzeug.utils import secure_filename
import os, uuid, base64

# --- Setup --------------------------------------------------------------
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL   = os.getenv("OPENAI_MODEL", "gpt-5-mini") 
assert OPENAI_API_KEY, "OPENAI_API_KEY is missing in .env"

client = OpenAI(api_key=OPENAI_API_KEY)

app = Flask(__name__)
CORS(app)

# uploads
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

TEXT_MIME_PREFIXES = ("text/",)
DOC_MIME = ("application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
PDF_MIME = ("application/pdf",)
CSV_MIME = ("text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

# --- DB -----------------------------------------------------------------
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

class Attachment(Base):
    __tablename__ = "attachments"
    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    filename = Column(String(300), nullable=False)
    mime = Column(String(120), nullable=True)
    path = Column(String(500), nullable=False)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

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
    for m in history:
        if m["role"] == "user":
            text = (m["content"] if isinstance(m["content"], str) else "").strip().splitlines()[0]
            return (text[:40] + "…") if len(text) > 40 else text
    return "New Conversation"

def read_text_file(path, max_chars=8000):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(max_chars)
    except Exception:
        return ""

def read_csv_preview(path, max_rows=50):
    import csv
    rows = []
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for i, row in enumerate(csv.reader(f)):
                rows.append(", ".join(row))
                if i >= max_rows: break
    except Exception:
        return ""
    return "\n".join(rows)

def read_pdf_preview(path, max_pages=5):
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        texts = []
        for page in reader.pages[:max_pages]:
            texts.append(page.extract_text() or "")
        return "\n\n".join(texts)
    except Exception:
        return ""

def read_docx_preview(path, max_chars=8000):
    try:
        import docx
        doc = docx.Document(path)
        text = "\n".join(p.text for p in doc.paragraphs)
        return text[:max_chars]
    except Exception:
        return ""

# --- UI -----------------------------------------------------------------
@app.get("/")
def home():
    return render_template("index.html")

# --- Profile CRUD -------------------------------------------------------
@app.get("/api/profile")
def get_profile():
    s = get_session()
    prof = ensure_profile(s)
    return jsonify({"id": prof.id, "name": prof.name, "timezone": prof.timezone, "tone": prof.tone, "notes": prof.notes})

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
    return jsonify([{"id": c.id, "title": c.title, "updated_at": c.updated_at.isoformat()} for c in convos])

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
    msgs = [{"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()} for m in c.messages]
    return jsonify(msgs)

# --- Upload (multiple files) -------------------------------------------
@app.post("/api/upload")
def upload_files():
    """
    multipart/form-data:
      - conversation_id (optional)
      - files: one or more files (field name 'files')
    Returns: { conversation_id, attachments: [{id, filename, mime, size}] }
    """
    s = get_session()

    cid = request.form.get("conversation_id", type=int)
    if cid:
        convo = s.query(Conversation).get(cid)
        if not convo:
            return jsonify({"error": "Conversation not found"}), 404
    else:
        convo = Conversation(title="New Conversation")
        s.add(convo)
        s.flush()  # get convo.id

    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400

    saved = []
    for f in files:
        if not f or not f.filename:
            continue
        safe_name = secure_filename(f.filename)
        ext = os.path.splitext(safe_name)[1]
        unique = f"{uuid.uuid4().hex}{ext}"
        save_path = os.path.join(UPLOAD_DIR, unique)
        f.save(save_path)
        size = os.path.getsize(save_path)
        att = Attachment(
            conversation_id=convo.id,
            filename=safe_name,
            mime=f.mimetype or "application/octet-stream",
            path=save_path,
            size=size,
        )
        s.add(att)
        s.flush()
        saved.append({"id": att.id, "filename": att.filename, "mime": att.mime, "size": att.size})

    convo.updated_at = datetime.utcnow()
    s.commit()
    return jsonify({"conversation_id": convo.id, "attachments": saved})

# --- Chat (text + attachments) -----------------------------------------
@app.post("/api/chat")
def chat():
    """
    JSON body:
    {
      "conversation_id": <int|null>,
      "message": "User text",
      "attachment_ids": [1,2,3]   # optional
    }
    """
    s = get_session()
    data = request.json or {}
    text = (data.get("message") or "").strip()
    attachment_ids = data.get("attachment_ids", [])

    if not text and not attachment_ids:
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

    # Load attachments (if any)
    attachments = []
    if attachment_ids:
        attachments = s.query(Attachment).filter(
            Attachment.id.in_(attachment_ids),
            Attachment.conversation_id == convo.id
        ).all()

    # Persist user message (text only for now)
    user_text_to_store = text if text else "[attachment(s) uploaded]"
    s.add(Message(conversation_id=convo.id, role="user", content=user_text_to_store))
    s.commit()

    # Build history for API call
    history = [{"role": m.role, "content": m.content}
               for m in s.query(Message).filter_by(conversation_id=convo.id).order_by(Message.id).all()]

    # Personalization
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
            "If you are not sure about something ask for more information."
            "If the mini model that we use is not capable to solve or explain a problem you should tell me to switch to a more skillful model."
            "Explain like you talk to human with explanations not just theory."
            "Try to put a tone of humor in your responses."
            "Try to notice best practices✅, acceptable but not the perfect thing⚠️, and avoid to do❌."
            "Use emojis for more fun conversations."
            "Keep answers within 3–5 short paragraphs unless explicitly asked for more."
            + profile_note
        )
    }

    # Build multimodal user turn from attachments
    user_parts = []
    if text:
        user_parts.append({"type": "text", "text": text})

    extracted_chunks = []
    for att in attachments:
        mime = (att.mime or "").lower()
        if mime.startswith("image/"):
            # pass image as data URL
            try:
                with open(att.path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("utf-8")
                data_url = f"data:{mime};base64,{b64}"
                user_parts.append({"type": "image_url", "image_url": {"url": data_url}})
            except Exception:
                pass
        elif mime.startswith(TEXT_MIME_PREFIXES):
            t = read_text_file(att.path)
            if t: extracted_chunks.append(f"# File: {att.filename}\n{t}")
        elif mime in PDF_MIME:
            t = read_pdf_preview(att.path)
            if t: extracted_chunks.append(f"# PDF: {att.filename}\n{t}")
        elif mime in DOC_MIME:
            t = read_docx_preview(att.path)
            if t: extracted_chunks.append(f"# DOCX: {att.filename}\n{t}")
        elif mime in CSV_MIME:
            t = read_csv_preview(att.path)
            if t: extracted_chunks.append(f"# CSV: {att.filename}\n{t}")

    if extracted_chunks:
        joined = "\n\n---\n\n".join(extracted_chunks)
        user_parts.append({"type": "text", "text": f"Attached file excerpts:\n\n{joined[:12000]}"})

    api_messages = [system_msg] + history
    if user_parts:
        if api_messages and api_messages[-1]["role"] == "user":
            api_messages.pop()
        api_messages.append({"role": "user", "content": user_parts})

    # OpenAI call
    try:
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=api_messages,
            temperature=1,
        )
        answer = resp.choices[0].message.content
    except Exception as e:
        return jsonify({"error": f"OpenAI error: {str(e)}"}), 500

    # Save assistant message
    s.add(Message(conversation_id=convo.id, role="assistant", content=answer))

    if convo.title == "New Conversation":
        convo.title = title_from_first_user_message(history) or "New Conversation"

    convo.updated_at = datetime.utcnow()
    s.commit()

    return jsonify({"conversation_id": convo.id, "reply": answer})

# --- Main ---------------------------------------------------------------
if __name__ == "__main__":
    import threading, webbrowser
    def open_browser():
        webbrowser.open_new("http://127.0.0.1:5000")
    threading.Timer(1.0, open_browser).start()
    app.run(host="127.0.0.1", port=5000, debug=False)
