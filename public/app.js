const state = {
  worlds: [],
  activeWorldId: null,
  activeWorld: null,
  activeStory: null,
  voices: [],
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

  readerPanel: document.getElementById("reader-panel"),
  storyTitle: document.getElementById("story-title"),
  storyContent: document.getElementById("story-content"),
  closeReaderBtn: document.getElementById("close-reader-btn"),

  voiceSelect: document.getElementById("voice-select"),
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
    const world = await api(`/api/worlds/${state.activeWorldId}`);
    state.activeWorld = world;
    renderWorldDetail(world);
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
  stopSpeech();
  el.readerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeReader() {
  stopSpeech();
  el.readerPanel.hidden = true;
  state.activeStory = null;
}

el.closeReaderBtn.addEventListener("click", closeReader);

// ---------- Voice narration (Web Speech API, built into the browser) ----------

const synth = window.speechSynthesis;
let utterance = null;

function populateVoices() {
  state.voices = synth.getVoices();
  el.voiceSelect.innerHTML = "";
  state.voices.forEach((voice, i) => {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = `${voice.name} (${voice.lang})`;
    el.voiceSelect.appendChild(option);
  });
}

if (synth) {
  populateVoices();
  synth.addEventListener("voiceschanged", populateVoices);
} else {
  el.voiceSelect.innerHTML = "<option>Speech synthesis not supported</option>";
  el.playBtn.disabled = true;
}

function setPlaybackButtons({ playing, paused }) {
  el.playBtn.disabled = playing && !paused;
  el.pauseBtn.disabled = !playing || paused;
  el.stopBtn.disabled = !playing;
}

el.playBtn.addEventListener("click", () => {
  if (!state.activeStory || !synth) return;

  if (synth.paused) {
    synth.resume();
    setPlaybackButtons({ playing: true, paused: false });
    return;
  }

  stopSpeech();
  const text = `${state.activeStory.title}. ${state.activeStory.content}`;
  utterance = new SpeechSynthesisUtterance(text);
  const selected = state.voices[Number(el.voiceSelect.value)];
  if (selected) utterance.voice = selected;
  utterance.rate = 0.95;
  utterance.pitch = 1;

  utterance.onstart = () => setPlaybackButtons({ playing: true, paused: false });
  utterance.onend = () => setPlaybackButtons({ playing: false, paused: false });
  utterance.onerror = () => setPlaybackButtons({ playing: false, paused: false });

  synth.speak(utterance);
});

el.pauseBtn.addEventListener("click", () => {
  if (!synth) return;
  synth.pause();
  setPlaybackButtons({ playing: true, paused: true });
});

el.stopBtn.addEventListener("click", stopSpeech);

function stopSpeech() {
  if (synth) synth.cancel();
  setPlaybackButtons({ playing: false, paused: false });
}

// ---------- utils ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

loadWorlds();
