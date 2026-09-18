// World memory page: shows the locations/characters/events extracted from
// a single world's stories (see extractEntities in src/openrouter.ts) and
// lets the user edit or delete them. Loaded standalone via memory.html?world=<id>
// so the main page can stay focused on creating and reading stories.

const worldId = new URLSearchParams(location.search).get("world");

const el = {
  worldDetailName: document.getElementById("world-detail-name"),
  worldDetailTheme: document.getElementById("world-detail-theme"),
  entityGroups: document.getElementById("entity-groups"),
  chatMessages: document.getElementById("chat-messages"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatSendBtn: document.getElementById("chat-send-btn"),
  chatStatus: document.getElementById("chat-status"),
};

// The entities currently shown, kept around so chat action cards can look
// up a human-readable name for an entity_id instead of just showing "#12".
let currentEntities = [];

// Chat history is kept in memory only (not persisted) - it resets on
// reload, matching the app's convention of storing durable world state in
// the database and letting transient UI state live client-side.
let chatHistory = [];
let chatBusy = false;

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

const ENTITY_TYPES = [
  { type: "location", label: "Locations", icon: "🗺️" },
  { type: "actor", label: "Characters", icon: "🧑" },
  { type: "event", label: "Events", icon: "📜" },
];

async function loadWorld() {
  if (!worldId) {
    el.worldDetailName.textContent = "No world selected";
    el.worldDetailTheme.textContent = "Go back and open a world first.";
    el.chatInput.disabled = true;
    el.chatSendBtn.disabled = true;
    el.chatInput.placeholder = "Open a world first.";
    return;
  }

  try {
    const world = await api(`/api/worlds/${worldId}`);
    el.worldDetailName.textContent = world.name;
    el.worldDetailTheme.textContent = world.theme;
    renderEntities(world);
  } catch (err) {
    el.worldDetailName.textContent = "Couldn't load world";
    el.worldDetailTheme.textContent = err.message;
  }
}

function renderEntities(world) {
  el.entityGroups.innerHTML = "";
  const entities = world.entities || [];
  currentEntities = entities;

  for (const { type, label, icon } of ENTITY_TYPES) {
    const group = document.createElement("div");
    group.className = "entity-group";
    group.innerHTML = `<h4>${icon} ${label}</h4>`;

    const ul = document.createElement("ul");
    ul.className = "entity-list";
    const items = entities.filter((entity) => entity.type === type);
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "entity-empty";
      li.innerHTML = `<small>None yet.</small>`;
      ul.appendChild(li);
    } else {
      for (const entity of items) {
        ul.appendChild(renderEntityItem(entity));
      }
    }
    group.appendChild(ul);
    group.appendChild(renderEntityAddForm(type));

    el.entityGroups.appendChild(group);
  }
}

function renderEntityItem(entity) {
  const li = document.createElement("li");
  li.className = "entity-item";
  renderEntityView(li, entity);
  return li;
}

function renderEntityView(li, entity) {
  li.innerHTML = `
    <strong>${escapeHtml(entity.name)}</strong>
    <p>${escapeHtml(entity.description)}</p>
    <div class="entity-actions">
      <button type="button" class="entity-edit-btn">Edit</button>
      <button type="button" class="entity-delete-btn danger-btn">Delete</button>
    </div>
  `;

  li.querySelector(".entity-edit-btn").addEventListener("click", () => {
    renderEntityEditForm(li, entity);
  });

  li.querySelector(".entity-delete-btn").addEventListener("click", async () => {
    if (!confirm(`Forget "${entity.name}"? It won't be reused in future stories.`)) return;
    await api(`/api/entities/${entity.id}`, { method: "DELETE" });
    await loadWorld();
  });
}

function renderEntityEditForm(li, entity) {
  li.innerHTML = `
    <form class="entity-edit-form">
      <input type="text" class="entity-name-input" value="${escapeAttr(entity.name)}" required />
      <input
        type="text"
        class="entity-desc-input"
        value="${escapeAttr(entity.description)}"
        required
      />
      <div class="entity-actions">
        <button type="submit">Save</button>
        <button type="button" class="entity-cancel-btn">Cancel</button>
      </div>
    </form>
  `;

  li.querySelector(".entity-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = li.querySelector(".entity-name-input").value.trim();
    const description = li.querySelector(".entity-desc-input").value.trim();
    if (!name || !description) return;
    await api(`/api/entities/${entity.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, description }),
    });
    await loadWorld();
  });

  li.querySelector(".entity-cancel-btn").addEventListener("click", () => {
    renderEntityView(li, entity);
  });
}

function renderEntityAddForm(type) {
  const form = document.createElement("form");
  form.className = "entity-add-form";
  form.innerHTML = `
    <input type="text" class="entity-name-input" placeholder="Name" required />
    <input type="text" class="entity-desc-input" placeholder="Description" required />
    <button type="submit">+ Add</button>
  `;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.querySelector(".entity-name-input").value.trim();
    const description = form.querySelector(".entity-desc-input").value.trim();
    if (!name || !description) return;
    await api(`/api/worlds/${worldId}/entities`, {
      method: "POST",
      body: JSON.stringify({ type, name, description }),
    });
    await loadWorld();
  });

  return form;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function entityById(id) {
  return currentEntities.find((e) => e.id === Number(id));
}

function appendChatMessage(role, content) {
  const div = document.createElement("div");
  div.className = `chat-msg chat-msg-${role}`;
  const p = document.createElement("p");
  p.textContent = content;
  div.appendChild(p);
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  return div;
}

function describeAction(action) {
  switch (action.kind) {
    case "create":
      return `➕ Add ${action.type}: "${action.name}"`;
    case "update":
      return `✏️ Update "${entityById(action.entity_id)?.name || `#${action.entity_id}`}"`;
    case "delete":
      return `🗑️ Forget "${entityById(action.entity_id)?.name || `#${action.entity_id}`}"`;
    case "merge": {
      const names = action.entity_ids.map((id) => entityById(id)?.name || `#${id}`).join(", ");
      return `🔀 Merge ${names} into "${action.name}"`;
    }
    default:
      return "Proposed change";
  }
}

function actionDetail(action) {
  if (action.kind === "delete") return "";
  const parts = [];
  if (action.name) parts.push(`<strong>${escapeHtml(action.name)}</strong>`);
  if (action.description) parts.push(escapeHtml(action.description));
  return parts.join("<br>");
}

// Applies one chat-proposed action via the existing entity endpoints - the
// chat route itself never writes to the database, so this is the only path
// that actually changes a world's memory as a result of a chat action.
async function applyChatAction(action) {
  if (action.kind === "create") {
    await api(`/api/worlds/${worldId}/entities`, {
      method: "POST",
      body: JSON.stringify({ type: action.type, name: action.name, description: action.description }),
    });
  } else if (action.kind === "update") {
    const entity = entityById(action.entity_id);
    await api(`/api/entities/${action.entity_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: action.name ?? entity?.name,
        description: action.description ?? entity?.description,
      }),
    });
  } else if (action.kind === "delete") {
    await api(`/api/entities/${action.entity_id}`, { method: "DELETE" });
  } else if (action.kind === "merge") {
    const [targetId, ...restIds] = action.entity_ids;
    await api(`/api/entities/${targetId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: action.name, description: action.description }),
    });
    for (const id of restIds) {
      await api(`/api/entities/${id}`, { method: "DELETE" });
    }
  }
}

function renderActionCard(action) {
  const card = document.createElement("div");
  card.className = "chat-action-card";
  const detail = actionDetail(action);
  card.innerHTML = `
    <span class="chat-action-label">${escapeHtml(describeAction(action))}</span>
    ${action.reason ? `<p class="chat-action-reason"><em>${escapeHtml(action.reason)}</em></p>` : ""}
    ${detail ? `<p class="chat-action-detail">${detail}</p>` : ""}
    <div class="chat-action-buttons">
      <button type="button" class="chat-apply-btn">Apply</button>
      <button type="button" class="chat-dismiss-btn">Dismiss</button>
    </div>
  `;

  card.querySelector(".chat-apply-btn").addEventListener("click", async () => {
    const buttons = card.querySelector(".chat-action-buttons");
    const applyBtn = card.querySelector(".chat-apply-btn");
    const dismissBtn = card.querySelector(".chat-dismiss-btn");
    applyBtn.disabled = true;
    dismissBtn.disabled = true;
    try {
      await applyChatAction(action);
      card.classList.add("applied");
      buttons.innerHTML = "<span>✅ Applied</span>";
      await loadWorld();
    } catch (err) {
      applyBtn.disabled = false;
      dismissBtn.disabled = false;
      alert(err.message || "Failed to apply that change.");
    }
  });

  card.querySelector(".chat-dismiss-btn").addEventListener("click", () => {
    card.remove();
  });

  return card;
}

el.chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (chatBusy || !worldId) return;

  const message = el.chatInput.value.trim();
  if (!message) return;

  appendChatMessage("user", message);
  el.chatInput.value = "";
  chatBusy = true;
  el.chatSendBtn.disabled = true;
  el.chatStatus.textContent = "Thinking...";
  el.chatStatus.classList.remove("error");

  try {
    const result = await api(`/api/worlds/${worldId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, history: chatHistory }),
    });
    chatHistory.push({ role: "user", content: message });
    chatHistory.push({ role: "assistant", content: result.reply });

    const assistantEl = appendChatMessage("assistant", result.reply);
    if (Array.isArray(result.actions) && result.actions.length) {
      const actionsWrap = document.createElement("div");
      actionsWrap.className = "chat-actions";
      for (const action of result.actions) {
        actionsWrap.appendChild(renderActionCard(action));
      }
      assistantEl.appendChild(actionsWrap);
    }
    el.chatStatus.textContent = "";
  } catch (err) {
    appendChatMessage("error", err.message || "Something went wrong.");
    el.chatStatus.textContent = "";
  } finally {
    chatBusy = false;
    el.chatSendBtn.disabled = false;
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }
});

loadWorld();
