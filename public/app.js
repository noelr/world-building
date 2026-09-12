const state = {
  worlds: [],
  activeWorldId: null,
  activeWorld: null,
  activeStory: null,
  voices: [],
  narrationMode: null, // "ai" | "device"
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

  voiceSelectWrap: document.getElementById("voice-select-wrap"),
  voiceSelect: document.getElementById("voice-select"),
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
// when the story is created (see src/tts.ts) and stored alongside it - not
// synthesized on the listener's device. If that generation failed for a
// given story, we fall back to the browser's built-in Web Speech API so
// playback still works.

const synth = window.speechSynthesis;

function setUpNarration(story) {
  stopPlayback();
  el.narrationNote.classList.remove("error");
  let canPlay = true;

  if (story.audio_data) {
    state.narrationMode = "ai";
    el.voiceSelectWrap.hidden = true;
    el.narrationNote.hidden = true;
    el.storyAudio.src = `data:audio/${story.audio_format || "mp3"};base64,${story.audio_data}`;
  } else {
    state.narrationMode = "device";
    el.storyAudio.removeAttribute("src");
    if (story.audio_error) {
      el.narrationNote.hidden = false;
      el.narrationNote.classList.add("error");
      el.narrationNote.textContent = `AI narration unavailable (${story.audio_error}). Using your device's voice instead.`;
    } else {
      el.narrationNote.hidden = true;
    }
    if (synth) {
      el.voiceSelectWrap.hidden = false;
    } else {
      el.voiceSelectWrap.hidden = true;
      el.narrationNote.hidden = false;
      el.narrationNote.classList.add("error");
      el.narrationNote.textContent =
        "No AI narration and no speech synthesis support in this browser.";
      canPlay = false;
    }
  }

  setPlaybackButtons({ playing: false, paused: false });
  el.playBtn.disabled = !canPlay;
}

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
}

function setPlaybackButtons({ playing, paused }) {
  el.playBtn.disabled = playing && !paused;
  el.pauseBtn.disabled = !playing || paused;
  el.stopBtn.disabled = !playing;
}

el.playBtn.addEventListener("click", () => {
  if (!state.activeStory) return;

  if (state.narrationMode === "ai") {
    el.storyAudio.play();
    return;
  }

  if (!synth) return;
  if (synth.paused) {
    synth.resume();
    setPlaybackButtons({ playing: true, paused: false });
    return;
  }

  synth.cancel();
  const text = `${state.activeStory.title}. ${state.activeStory.content}`;
  const utterance = new SpeechSynthesisUtterance(text);
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
  if (state.narrationMode === "ai") {
    el.storyAudio.pause();
    return;
  }
  if (!synth) return;
  synth.pause();
  setPlaybackButtons({ playing: true, paused: true });
});

el.stopBtn.addEventListener("click", stopPlayback);

el.storyAudio.addEventListener("play", () => setPlaybackButtons({ playing: true, paused: false }));
el.storyAudio.addEventListener("pause", () => setPlaybackButtons({ playing: true, paused: true }));
el.storyAudio.addEventListener("ended", () => setPlaybackButtons({ playing: false, paused: false }));

function stopPlayback() {
  if (synth) synth.cancel();
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

loadWorlds();
