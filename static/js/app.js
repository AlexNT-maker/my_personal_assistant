// Minimal client for our Flask API.

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
      el.messages.innerHTML = "";
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
    div.innerHTML = `
      <div class="text">${escapeHtml(m.content)}</div>
      <span class="meta">${time}</span>
    `;
    el.messages.appendChild(div);
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

// ---- Chat -------------------------------------------------------------
async function sendMessage() {
  const text = el.input.value.trim();
  if (!text) return;
  if (!state.activeId) await newConversation();

  // optimistic user bubble
  const userDiv = document.createElement("div");
  userDiv.className = "msg user";
  userDiv.innerHTML = `<div class="text">${escapeHtml(text)}</div><span class="meta">now</span>`;
  el.messages.appendChild(userDiv);
  el.messages.scrollTop = el.messages.scrollHeight;

  el.input.value = "";
  el.input.disabled = true;
  el.send.disabled = true;

  try {
    const res = await jpost("/api/chat", { conversation_id: state.activeId, message: text });
    const botDiv = document.createElement("div");
    botDiv.className = "msg assistant";
    botDiv.innerHTML = `<div class="text">${escapeHtml(res.reply)}</div><span class="meta">now</span>`;
    el.messages.appendChild(botDiv);
    el.messages.scrollTop = el.messages.scrollHeight;
    await loadConversations(); // refresh titles/order
  } catch (e) {
    alert("Chat error: " + e.message);
  } finally {
    el.input.disabled = false;
    el.send.disabled = false;
    el.input.focus();
  }
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

(async function init() {
  await Promise.all([loadConversations(), loadProfile()]);
  if (state.activeId) await loadMessages();
})();
