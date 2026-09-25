const tauri = window.__TAURI__;
const invoke = tauri && tauri.core && tauri.core.invoke;

const state = {
  models: [],
  runtime: null,
  history: [],
  sending: false,
};

const $ = (id) => document.getElementById(id);
const titles = {
  chat: ["Local Chat", "Private AI on this device"],
  models: ["Models", "Manage local GGUF models"],
  settings: ["Settings", "Local runtime and hardware"],
};

function setHint(message = "", error = false) {
  const el = $("chatHint");
  el.textContent = message;
  el.classList.toggle("error", error);
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / 1024 ** power).toFixed(power > 2 ? 1 : 0) + " " + units[power];
}
function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem("botconnector.local.history") || "[]");
    state.history = Array.isArray(saved) ? saved.slice(-50) : [];
  } catch {
    state.history = [];
  }
}

function saveHistory() {
  localStorage.setItem("botconnector.local.history", JSON.stringify(state.history.slice(-50)));
}

function renderMessages() {
  const list = $("messages");
  list.querySelectorAll(".message").forEach((node) => node.remove());
  $("emptyChat").style.display = state.history.length ? "none" : "grid";

  for (const item of state.history) {
    const bubble = document.createElement("div");
    bubble.className = "message " + (item.role === "user" ? "user" : "assistant");
    bubble.textContent = item.content;
    list.appendChild(bubble);
  }
  list.scrollTop = list.scrollHeight;
}

function setRuntimeBadge(runtime) {
  const active = Boolean(runtime && runtime.running);
  $("runtimeDot").classList.toggle("online", active);
  $("runtimeLabel").textContent = active ? "Runtime ready" : "Runtime idle";
  const loaded = (runtime && runtime.loadedModels) || [];
  $("loadedModels").textContent = loaded.length ? loaded.join(", ") : "None";
}
async function refreshRuntime() {
  if (!invoke) return;
  try {
    state.runtime = await invoke("runtime_status");
    setRuntimeBadge(state.runtime);
  } catch (error) {
    state.runtime = null;
    setRuntimeBadge(null);
    console.warn("runtime status", error);
  }
}

function renderModelGrid() {
  const grid = $("modelGrid");
  grid.replaceChildren();
  const loaded = new Set((state.runtime && state.runtime.loadedModels) || []);

  if (!state.models.length) {
    const empty = document.createElement("div");
    empty.className = "notice";
    empty.textContent = "No GGUF model is installed in BotConnector Local yet.";
    grid.appendChild(empty);
    return;
  }

  for (const model of state.models) {
    const card = document.createElement("div");
    card.className = "model-card";
    const title = document.createElement("strong");
    title.textContent = model.name;
    const meta = document.createElement("span");
    meta.textContent = humanBytes(model.sizeBytes) + " • " + (model.isMmproj ? "Vision projector" : "GGUF");
    const status = document.createElement("span");
    status.textContent = loaded.has(model.id) ? "Loaded" : "Installed";
    if (loaded.has(model.id)) status.className = "loaded";
    card.append(title, meta, status);
    grid.appendChild(card);
  }
}
function renderModelPicker() {
  const select = $("modelSelect");
  const previous = localStorage.getItem("botconnector.local.model") || select.value;
  select.replaceChildren();
  const chatModels = state.models.filter((model) => !model.isMmproj);

  for (const model of chatModels) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    select.appendChild(option);
  }

  if (chatModels.some((model) => model.id === previous)) select.value = previous;
  select.disabled = !chatModels.length;
  $("sendButton").disabled = !chatModels.length;
}

async function refreshModels() {
  if (!invoke) return;
  try {
    state.models = await invoke("list_models");
    renderModelPicker();
    await refreshRuntime();
    renderModelGrid();
    $("modelsPath").textContent = await invoke("models_path");
    if (!state.models.some((model) => !model.isMmproj)) {
      setHint("Add a GGUF model in Models before chatting.");
    }
  } catch (error) {
    setHint(String(error), true);
  }
}

function assistantText(response) {
  const content = response && response.choices && response.choices[0] &&
    response.choices[0].message && response.choices[0].message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => (item && item.text) || "").filter(Boolean).join("\n");
  }
  return "(No text returned by the local model.)";
}
async function sendMessage(text) {
  if (!invoke || state.sending) return;
  const model = $("modelSelect").value;
  if (!model) {
    setHint("No local model selected.", true);
    return;
  }

  state.sending = true;
  $("sendButton").disabled = true;
  state.history.push({ role: "user", content: text });
  renderMessages();
  saveHistory();
  setHint("Loading local model / generating…");

  try {
    const response = await invoke("chat_completion", {
      payload: {
        model: model,
        messages: state.history.slice(-40),
        stream: false,
      },
    });
    state.history.push({ role: "assistant", content: assistantText(response) });
    saveHistory();
    renderMessages();
    setHint("Local response complete • model unloads after idle timeout.");
    await refreshRuntime();
    renderModelGrid();
  } catch (error) {
    setHint(String(error), true);
  } finally {
    state.sending = false;
    $("sendButton").disabled = !state.models.some((item) => !item.isMmproj);
  }
}
async function loadHardware() {
  if (!invoke) return;
  try {
    const info = await invoke("plugin:hardware|get_system_info");
    $("hardwareInfo").textContent = JSON.stringify(info, null, 2);
  } catch (error) {
    $("hardwareInfo").textContent = "Hardware detection unavailable: " + error;
  }
}

function switchView(name) {
  document.querySelectorAll(".nav").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  $(name + "View").classList.add("active");
  $("viewTitle").textContent = titles[name][0];
  $("viewSubtitle").textContent = titles[name][1];
  if (name === "models") refreshModels();
  if (name === "settings") {
    refreshRuntime();
    loadHardware();
  }
}

function bindEvents() {
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("modelSelect").addEventListener("change", (event) => {
    localStorage.setItem("botconnector.local.model", event.target.value);
  });
  $("composer").addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = $("prompt");
    const text = prompt.value.trim();
    if (!text) return;
    prompt.value = "";
    await sendMessage(text);
  });

  $("prompt").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("composer").requestSubmit();
    }
  });

  $("refreshModels").addEventListener("click", refreshModels);
  $("modelsRefresh").addEventListener("click", refreshModels);

  $("unloadAll").addEventListener("click", async () => {
    if (!invoke) return;
    try {
      await invoke("unload_all");
      await refreshRuntime();
      renderModelGrid();
    } catch (error) {
      setHint(String(error), true);
    }
  });

  $("idleMinutes").addEventListener("change", async (event) => {
    if (!invoke) return;
    try {
      await invoke("set_idle_minutes", { minutes: Number(event.target.value) });
      await refreshRuntime();
    } catch (error) {
      console.warn("idle timeout", error);
    }
  });
}
async function init() {
  loadHistory();
  renderMessages();
  bindEvents();

  if (!invoke) {
    setHint("BotConnector desktop runtime is unavailable in this browser.", true);
    $("runtimeLabel").textContent = "Desktop runtime unavailable";
    return;
  }

  await refreshModels();
  await loadHardware();
}

init();
