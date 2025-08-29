// static/js/app.js
// Client for Flask API: conversations, messages, chat (text + images), profile.

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
  file: document.getElementById("file"), // <input type="file" id="file" accept="image/*" multiple />
};

let state = { conversations: [], activeId: null };

// ---- Fetch helpers ----------------------------------------------------
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

// ---- Conversations ----------------------------------------------------
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
        await newConversation(); // auto-create if none left
      } else if (!state.conversations.find(x => x.id === state.activeId)) {
        state.activeId = state.conversations[0].id; // pick first if active was deleted
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

// ---- Messages ---------------------------------------------------------
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
    const time = new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const html = DOMPurify.sanitize(marked.parse(m.content || ""));
    div.innerHTML = `
      <div class="text">${html}</div>
      <span class="meta">${time}</span>
    `;
    el.messages.appendChild(div);
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

// ---- Chat (text + images) --------------------------------------------
async function sendMessage() {
  const text = el.input.value.trim();
  const images = await collectSelectedImages(); // [{mime,b64}] or []

  if (!text && images.length === 0) return;
  if (!state.activeId) await newConversation();

  // optimistic user text bubble
  if (text) {
    const userDiv = document.createElement("div");
    userDiv.className = "msg user";
    const userHtml = DOMPurify.sanitize(marked.parse(text));
    userDiv.innerHTML = `<div class="text">${userHtml}</div><span class="meta">now</span>`;
    el.messages.appendChild(userDiv);
  }

  // optimistic image bubbles
  if (images.length) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "msg user";
    const imgsHtml = images.map(i => `<img src="data:${i.mime};base64,${i.b64}" alt="image" />`).join("");
    imgWrap.innerHTML = `<div class="text">${imgsHtml}</div><span class="meta">now</span>`;
    el.messages.appendChild(imgWrap);
  }

  el.messages.scrollTop = el.messages.scrollHeight;

  el.input.value = "";
  el.input.disabled = true;
  el.send.disabled = true;

  try {
    const res = await jpost("/api/chat", { conversation_id: state.activeId, message: text, images });
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

async function collectSelectedImages() {
  const out = [];
  const files = el.file ? el.file.files : null;
  if (!files || !files.length) return out;
  for (const f of files) {
    const b64 = await fileToBase64(f);
    out.push({ mime: f.type || "image/png", b64 });
  }
  if (el.file) el.file.value = "";
  return out;
}

// ---- Profile ----------------------------------------------------------
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

// ---- Utils & wiring ---------------------------------------------------
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result || "").toString().split(",")[1] || "");
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

el.newConvo.addEventListener("click", newConversation);
el.send.addEventListener("click", sendMessage);
el.input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendMessage();
});
el.saveProfile.addEventListener("click", saveProfile);
el.forgetProfile.addEventListener("click", forgetProfile);

// Bootstrap
(async function init() {
  await Promise.all([loadConversations(), loadProfile()]);
  if (state.activeId) await loadMessages();
})();
