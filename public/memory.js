// World memory page: shows the locations/characters/events extracted from
// a single world's stories (see extractEntities in src/openrouter.ts) and
// lets the user edit or delete them. Loaded standalone via memory.html?world=<id>
// so the main page can stay focused on creating and reading stories.

const worldId = new URLSearchParams(location.search).get("world");

const el = {
  worldDetailName: document.getElementById("world-detail-name"),
  worldDetailTheme: document.getElementById("world-detail-theme"),
  entityGroups: document.getElementById("entity-groups"),
};

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

loadWorld();
