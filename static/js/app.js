// static/js/app.js
// Client for Flask API: conversations, messages, chat (text + attachments), profile.
// Uses Markdown (marked + DOMPurify). Supports multi-pick uploads queued before Send.

const el = {
  conversations: document.getElementById("conversations"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  newConvo: document.getElementById("new-convo-btn"),
  name: document.getElementById("name"),
  timezone: document.getElementById("timezone"),
  tone: document.getElementById("tone"),
  notes: document.getElementById("notes"),
  saveProfile: document.getElementById("save-profile"),
  forgetProfile: document.getElementById("forget-profile"),
  file: document.getElementById("file"),            // <input type="file" id="file" multiple />
  pending: document.getElementById("pending-files") // <div id="pending-files"></div>
};

let state = { conversations: [], activeId: null };
let pendingFiles = []; // queue of File objects from multiple picks

// ---------------- Fetch helpers ----------------
async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function jdel(url) { const r = await fetch(url, { method: "DELETE" }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function jpost(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text()); return r.json();
}
async function jput(url, body) {
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text()); return r.json();
}

// ---------------- Conversations ----------------
async function loadConversations() {
  state.conversations = await jget("/api/conversations");
  if (!state.activeId && state.conversations.length) state.activeId = state.conversations[0].id;
  renderConversations();
}

function renderConversations() {
  el.conversations.innerHTML = "";
  for (const c of state.conversations) {
    const li = document.createElement("li");
    li.className = "convo-item" + (c.id === state.activeId ? " active" : "");
    li.dataset.id = c.id;

    const title = document.createElement("div");
    title.className = "convo-title";
    title.textContent = c.title || "Untitled";

    const actions = document.createElement("div");
    actions.className = "convo-actions";
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await jdel(`/api/conversations/${c.id}`);
      await loadConversations();
      if (!state.conversations.length) {
        await newConversation();                     // auto-create if none left
      } else if (!state.conversations.find(x => x.id === state.activeId)) {
        state.activeId = state.conversations[0].id;  // pick first if active was deleted
      }
      await loadMessages();
    });
    actions.appendChild(del);

    li.appendChild(title);
    li.appendChild(actions);
    li.addEventListener("click", async () => {
      state.activeId = c.id;
      renderConversations();
      await loadMessages();
    });

    el.conversations.appendChild(li);
  }
}

async function newConversation() {
  const created = await jpost("/api/conversations", {});
  state.activeId = created.id;
  await loadConversations();
  el.messages.innerHTML = "";
}

// ---------------- Messages ----------------
async function loadMessages() {
  if (!state.activeId) return;
  const msgs = await jget(`/api/messages/${state.activeId}`);
  renderMessages(msgs);
}

function renderMessages(msgs) {
  el.messages.innerHTML = "";
  for (const m of msgs) {
    const div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "user" : "assistant");
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const html = DOMPurify.sanitize(marked.parse(m.content || ""));
    div.innerHTML = `
      <div class="text">${html}</div>
      <span class="meta">${time}</span>
    `;
    el.messages.appendChild(div);
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

// --------------- Pending files UI ---------------
function onFilePick() {
  const files = Array.from(el.file?.files || []);
  if (!files.length) return;
  for (const f of files) pendingFiles.push(f); // queue them
  el.file.value = "";                          // allow picking more again
  renderPendingChips();
}

function renderPendingChips() {
  if (!el.pending) return;
  if (!pendingFiles.length) { el.pending.innerHTML = ""; return; }
  el.pending.innerHTML = pendingFiles.map((f, idx) => {
    const isImg = (f.type || "").startsWith("image/");
    const cls = isImg ? "file-chip image" : "file-chip";
    return `<button type="button" class="${cls}" data-idx="${idx}" title="Remove">${escapeHtml(f.name)}<span class="x">✕</span></button>`;
  }).join("");

  // remove handlers
  for (const btn of el.pending.querySelectorAll(".file-chip")) {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.idx);
      pendingFiles.splice(i, 1);
      renderPendingChips();
    });
  }
}

// --------------- Upload helper ---------------
async function uploadSelectedFilesEnsureConversation() {
  // Fallback: if queue is empty, read directly from the input
  let filesToSend = pendingFiles.length
    ? pendingFiles
    : Array.from(el.file?.files || []);

  if (filesToSend.length === 0) {
    return { conversation_id: state.activeId, attachments: [] };
  }

  // ensure conversation exists first (upload needs cid)
  if (!state.activeId) {
    const created = await jpost("/api/conversations", {});
    state.activeId = created.id;
    await loadConversations();
  }

  const fd = new FormData();
  fd.append("conversation_id", String(state.activeId));
  for (const f of filesToSend) fd.append("files", f);

  // simple debug (βλέπεις στο DevTools → Network/Console)
  console.log("Uploading", filesToSend.map(f => `${f.name} (${f.type || 'unknown'})`));

  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    console.error("Upload failed:", msg);
    throw new Error(msg);
  }
  const data = await res.json();

  // clear queue & native input
  pendingFiles = [];
  if (el.file) el.file.value = "";
  if (el.pending) el.pending.innerHTML = "";

  return data; // {conversation_id, attachments:[{id, filename, mime, size}]}
}


// --------------- Chat (text + attachments) ---------------
async function sendMessage() {
  const text = el.input.value.trim();

  // 1) Upload any queued files & ensure conversation
  const uploadInfo = await uploadSelectedFilesEnsureConversation();
  const attachmentIds = (uploadInfo.attachments || []).map(a => a.id);

  if (!text && attachmentIds.length === 0) return;
  if (!state.activeId) state.activeId = uploadInfo.conversation_id;

  // 2) optimistic user text bubble
  if (text) {
    const userDiv = document.createElement("div");
    userDiv.className = "msg user";
    const userHtml = DOMPurify.sanitize(marked.parse(text));
    userDiv.innerHTML = `<div class="text">${userHtml}</div><span class="meta">now</span>`;
    el.messages.appendChild(userDiv);
  }

  // 3) optimistic preview for uploaded files (chips with filenames)
  if (uploadInfo.attachments && uploadInfo.attachments.length) {
    const wrap = document.createElement("div");
    wrap.className = "msg user";
    const chips = uploadInfo.attachments.map(a => {
      const isImg = (a.mime || "").startsWith("image/");
      const cls = isImg ? "file-chip image" : "file-chip";
      return `<span class="${cls}">${escapeHtml(a.filename)}</span>`;
    }).join("");
    wrap.innerHTML = `<div class="text">${chips}</div><span class="meta">now</span>`;
    el.messages.appendChild(wrap);
  }

  el.messages.scrollTop = el.messages.scrollHeight;

  // 4) lock UI, call /api/chat
  el.input.value = "";
  el.input.disabled = true;
  el.send.disabled = true;

  try {
    const res = await jpost("/api/chat", {
      conversation_id: state.activeId,
      message: text,
      attachment_ids: attachmentIds
    });
    const botDiv = document.createElement("div");
    botDiv.className = "msg assistant";
    const botHtml = DOMPurify.sanitize(marked.parse(res.reply || ""));
    botDiv.innerHTML = `<div class="text">${botHtml}</div><span class="meta">now</span>`;
    el.messages.appendChild(botDiv);
    el.messages.scrollTop = el.messages.scrollHeight;
    await loadConversations();
  } catch (e) {
    alert("Chat error: " + e.message);
  } finally {
    el.input.disabled = false;
    el.send.disabled = false;
    el.input.focus();
  }
}

// ---------------- Profile ----------------
async function loadProfile() {
  const p = await jget("/api/profile");
  el.name.value = p.name || "";
  el.timezone.value = p.timezone || "";
  el.tone.value = p.tone || "";
  el.notes.value = p.notes || "";
}

async function saveProfile() {
  await jput("/api/profile", {
    name: el.name.value.trim() || null,
    timezone: el.timezone.value.trim() || null,
    tone: el.tone.value.trim() || null,
    notes: el.notes.value.trim() || null,
  });
  await loadProfile();
}

async function forgetProfile() {
  await jdel("/api/profile");
  await loadProfile();
}

// ---------------- Utils & wiring ----------------
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

el.newConvo.addEventListener("click", newConversation);
el.send.addEventListener("click", sendMessage);
el.input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendMessage();
});
el.saveProfile.addEventListener("click", saveProfile);
el.forgetProfile.addEventListener("click", forgetProfile);
if (el.file) el.file.addEventListener("change", onFilePick);

// Bootstrap
(async function init() {
  await Promise.all([loadConversations(), loadProfile()]);
  if (state.activeId) await loadMessages();
})();
