const state = {
  worlds: [],
  activeWorldId: null,
  activeWorld: null,
  activeStory: null,
};

const el = {
  worldForm: document.getElementById("world-form"),
  worldName: document.getElementById("world-name"),
  worldTheme: document.getElementById("world-theme"),
  worldList: document.getElementById("world-list"),

  detailPanel: document.getElementById("detail-panel"),
  worldDetailName: document.getElementById("world-detail-name"),
  worldDetailTheme: document.getElementById("world-detail-theme"),
  deleteWorldBtn: document.getElementById("delete-world-btn"),

  generateForm: document.getElementById("generate-form"),
  storyNote: document.getElementById("story-note"),
  generateBtn: document.getElementById("generate-btn"),
  generateStatus: document.getElementById("generate-status"),
  storyList: document.getElementById("story-list"),
  entityGroups: document.getElementById("entity-groups"),

  readerPanel: document.getElementById("reader-panel"),
  storyTitle: document.getElementById("story-title"),
  storyContent: document.getElementById("story-content"),
  closeReaderBtn: document.getElementById("close-reader-btn"),

  narrationNote: document.getElementById("narration-note"),
  storyAudio: document.getElementById("story-audio"),
  playBtn: document.getElementById("play-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  stopBtn: document.getElementById("stop-btn"),
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

function formatDate(iso) {
  try {
    return new Date(iso + "Z").toLocaleString();
  } catch {
    return iso;
  }
}

// ---------- Worlds ----------

async function loadWorlds() {
  state.worlds = await api("/api/worlds");
  renderWorldList();
}

function renderWorldList() {
  el.worldList.innerHTML = "";
  for (const world of state.worlds) {
    const li = document.createElement("li");
    li.className = "world-item" + (world.id === state.activeWorldId ? " active" : "");
    li.innerHTML = `<strong>${escapeHtml(world.name)}</strong><small>${escapeHtml(
      world.theme
    )}</small>`;
    li.addEventListener("click", () => selectWorld(world.id));
    el.worldList.appendChild(li);
  }
}

async function selectWorld(id) {
  state.activeWorldId = id;
  const world = await api(`/api/worlds/${id}`);
  state.activeWorld = world;
  renderWorldList();
  renderWorldDetail(world);
}

function renderWorldDetail(world) {
  el.detailPanel.hidden = false;
  el.worldDetailName.textContent = world.name;
  el.worldDetailTheme.textContent = world.theme;
  el.generateStatus.textContent = "";
  el.generateStatus.classList.remove("error");

  el.storyList.innerHTML = "";
  for (const story of world.stories) {
    const li = document.createElement("li");
    li.className = "story-item";
    li.innerHTML = `<strong>${escapeHtml(story.title)}</strong><small>${formatDate(
      story.created_at
    )}</small>`;
    li.addEventListener("click", () => openStory(story));
    el.storyList.appendChild(li);
  }
  if (world.stories.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = `<small>No stories yet. Generate the first one!</small>`;
    el.storyList.appendChild(li);
  }

  renderEntities(world);
}

// ---------- World memory (locations, characters, events) ----------
//
// After each story is generated, the server asks the model to extract any
// new locations/characters/events it introduced (see extractEntities in
// src/openrouter.ts) and saves them here. They're fed back into future
// story generation for this world so it stays consistent, and the user can
// freely edit or delete anything they don't want kept.

const ENTITY_TYPES = [
  { type: "location", label: "Locations", icon: "🗺️" },
  { type: "actor", label: "Characters", icon: "🧑" },
  { type: "event", label: "Events", icon: "📜" },
];

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
    await refreshActiveWorld();
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
    await refreshActiveWorld();
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
    await api(`/api/worlds/${state.activeWorldId}/entities`, {
      method: "POST",
      body: JSON.stringify({ type, name, description }),
    });
    await refreshActiveWorld();
  });

  return form;
}

async function refreshActiveWorld() {
  if (!state.activeWorldId) return;
  const world = await api(`/api/worlds/${state.activeWorldId}`);
  state.activeWorld = world;
  renderWorldDetail(world);
}

el.worldForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el.worldName.value.trim();
  const theme = el.worldTheme.value.trim();
  if (!name || !theme) return;

  const world = await api("/api/worlds", {
    method: "POST",
    body: JSON.stringify({ name, theme }),
  });
  el.worldForm.reset();
  await loadWorlds();
  await selectWorld(world.id);
});

el.deleteWorldBtn.addEventListener("click", async () => {
  if (!state.activeWorldId) return;
  if (!confirm(`Delete "${state.activeWorld.name}" and all of its stories?`)) return;
  await api(`/api/worlds/${state.activeWorldId}`, { method: "DELETE" });
  state.activeWorldId = null;
  state.activeWorld = null;
  el.detailPanel.hidden = true;
  closeReader();
  await loadWorlds();
});

// ---------- Stories ----------

el.generateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.activeWorldId) return;

  const note = el.storyNote.value.trim();
  el.generateBtn.disabled = true;
  el.generateStatus.classList.remove("error");
  el.generateStatus.textContent = "Dreaming up a story... this can take a few seconds.";

  try {
    const story = await api(`/api/worlds/${state.activeWorldId}/stories`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
    el.storyNote.value = "";
    el.generateStatus.textContent = "Story ready!";
    await refreshActiveWorld();
    openStory(story);
  } catch (err) {
    el.generateStatus.textContent = err.message;
    el.generateStatus.classList.add("error");
  } finally {
    el.generateBtn.disabled = false;
  }
});

function openStory(story) {
  state.activeStory = story;
  el.readerPanel.hidden = false;
  el.storyTitle.textContent = story.title;
  el.storyContent.textContent = story.content;
  setUpNarration(story);
  el.readerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeReader() {
  stopPlayback();
  el.readerPanel.hidden = true;
  state.activeStory = null;
}

el.closeReaderBtn.addEventListener("click", closeReader);

// ---------- Voice narration ----------
//
// Stories are narrated with a real AI voice, generated once via OpenRouter
// when the story is created (see src/tts.ts) and stored alongside it.

function setUpNarration(story) {
  stopPlayback();
  el.narrationNote.classList.remove("error");

  if (story.audio_data) {
    el.narrationNote.hidden = true;
    el.storyAudio.src = `data:audio/${story.audio_format || "mp3"};base64,${story.audio_data}`;
  } else {
    el.storyAudio.removeAttribute("src");
    el.narrationNote.hidden = false;
    el.narrationNote.classList.add("error");
    el.narrationNote.textContent = story.audio_error
      ? `AI narration unavailable (${story.audio_error}).`
      : "AI narration unavailable for this story.";
  }

  // Recomputes playBtn.disabled from el.storyAudio.src, which reflects the
  // branch just taken above (empty string when the src attribute was removed).
  setPlaybackButtons({ playing: false, paused: false });
}

function setPlaybackButtons({ playing, paused }) {
  el.playBtn.disabled = (playing && !paused) || !el.storyAudio.src;
  el.pauseBtn.disabled = !playing || paused;
  el.stopBtn.disabled = !playing;
}

el.playBtn.addEventListener("click", () => {
  if (!state.activeStory) return;
  el.storyAudio.play();
});

el.pauseBtn.addEventListener("click", () => {
  el.storyAudio.pause();
});

el.stopBtn.addEventListener("click", stopPlayback);

el.storyAudio.addEventListener("play", () => setPlaybackButtons({ playing: true, paused: false }));
el.storyAudio.addEventListener("pause", () => setPlaybackButtons({ playing: true, paused: true }));
el.storyAudio.addEventListener("ended", () => setPlaybackButtons({ playing: false, paused: false }));

function stopPlayback() {
  el.storyAudio.pause();
  el.storyAudio.currentTime = 0;
  setPlaybackButtons({ playing: false, paused: false });
}

// ---------- utils ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

loadWorlds();
