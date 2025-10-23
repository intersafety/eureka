const STORAGE_KEY = "intersafetySettings";
const ENVIRONMENT_STORAGE_KEY = "intersafetyEnvironment";

const defaultSettings = {
  enabled: false,
  voiceMode: "off",
  jsonPrompting: false
};

let state = { ...defaultSettings };
let environment = { onChatGPT: false, updatedAt: 0 };
let voiceButtons = [];

document.addEventListener("DOMContentLoaded", async () => {
  await loadState();
  await detectEnvironment();
  bindUI();
  bindRuntimeListeners();
  render();
});

function bindUI() {
  const enabledToggle = getEl("enabledToggle");
  const jsonToggle = getEl("jsonToggle");
  const voiceSwitch = getEl("voiceModeSwitch");
  voiceButtons = Array.from(
    voiceSwitch.querySelectorAll("button.mode-option[data-mode]")
  );

  enabledToggle.addEventListener("change", () => {
    state.enabled = enabledToggle.checked;
    persist();
    render();
    flashStatus(state.enabled ? "Improver engaged" : "Improver resting");
  });

  voiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      if (!mode) {
        return;
      }
      state.voiceMode = mode;
      persist();
      render();
      flashStatus(voiceLabel(state.voiceMode));
    });
  });

  jsonToggle.addEventListener("change", () => {
    state.jsonPrompting = jsonToggle.checked;
    persist();
    render();
    flashStatus(jsonToggle.checked ? "JSON prompting on" : "JSON prompting off");
  });
}

async function loadState() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  const raw = stored?.[STORAGE_KEY] ?? {};
  let voiceMode = typeof raw.voiceMode === "string" ? raw.voiceMode : "off";

  if (!raw.voiceMode) {
    if (raw.naturalVoice) {
      voiceMode = "natural";
    } else if (raw.aiVoice) {
      voiceMode = "ai";
    }
  }

  state = {
    ...defaultSettings,
    ...raw,
    voiceMode
  };
  if (!["off", "natural", "ai"].includes(state.voiceMode)) {
    state.voiceMode = "off";
  }
}

async function detectEnvironment() {
  try {
    const response = await sendRuntimeMessage({ type: "getEnvironment" });
    if (response?.environment) {
      environment = {
        onChatGPT: Boolean(response.environment.onChatGPT),
        updatedAt: response.environment.updatedAt ?? Date.now()
      };
      return;
    }
  } catch (error) {
    console.warn("[InterSafety] Unable to fetch environment:", error);
  }

  try {
    const stored = await chrome.storage.session.get(ENVIRONMENT_STORAGE_KEY);
    const fallback = stored?.[ENVIRONMENT_STORAGE_KEY];
    if (fallback) {
      environment = {
        onChatGPT: Boolean(fallback.onChatGPT),
        updatedAt: fallback.updatedAt ?? Date.now()
      };
      return;
    }
  } catch (error) {
    console.warn("[InterSafety] Unable to read cached environment:", error);
  }
  environment = { onChatGPT: false, updatedAt: Date.now() };
}

function persist() {
  chrome.storage.sync.set({ [STORAGE_KEY]: state });
}

function bindRuntimeListeners() {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "environmentUpdated") {
      return;
    }
    if (!message.environment) {
      return;
    }
    environment = {
      onChatGPT: Boolean(message.environment.onChatGPT),
      updatedAt: message.environment.updatedAt ?? Date.now()
    };
    render();
  });
}

function render() {
  const container = document.querySelector(".container");
  const enabledToggle = getEl("enabledToggle");
  const jsonToggle = getEl("jsonToggle");
  const chip = getEl("statusChip");
  const status = getEl("status");

  enabledToggle.checked = state.enabled;
  jsonToggle.checked = state.jsonPrompting;

  const disabled = !state.enabled;
  jsonToggle.disabled = disabled;
  voiceButtons.forEach((button) => {
    const active = state.voiceMode === button.dataset.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-checked", String(active));
    button.disabled = disabled;
  });
  container.classList.toggle("disabled", disabled);

  document.body.classList.toggle("is-on-chatgpt", environment.onChatGPT);
  document.body.classList.toggle("is-improving", environment.onChatGPT && state.enabled);

  if (!environment.onChatGPT) {
    chip.textContent = state.enabled ? "Awaiting chatgpt.com" : "Off domain";
    status.innerHTML = disabled
      ? "Enable to enhance prompts"
      : "Open chatgpt.com to begin improving";
  } else if (state.enabled) {
    chip.textContent = "Improving chatgpt.com";
    status.innerHTML = `Mode: <strong>${voiceLabel(state.voiceMode)}</strong>${
      state.jsonPrompting ? " · JSON prompting" : ""
    }`;
  } else {
    chip.textContent = "chatgpt.com detected";
    status.textContent = "Toggle the improver to activate on this page";
  }
}

function flashStatus(message) {
  const status = getEl("status");
  status.textContent = message;
  setTimeout(() => {
    render();
  }, 1600);
}

function voiceLabel(mode) {
  switch (mode) {
    case "natural":
      return "Natural voice";
    case "ai":
      return "AI voice";
    default:
      return "Neutral";
  }
}

function getEl(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element with id "${id}"`);
  }
  return el;
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}
