const STORAGE_KEY = "intersafetySettings";
const ENVIRONMENT_KEY = "intersafetyEnvironment";

const defaultSettings = {
  enabled: false,
  voiceMode: "off",
  jsonPrompting: false
};

const environment = {
  onChatGPT: false,
  url: "",
  updatedAt: Date.now()
};

init();

async function init() {
  await ensureDefaults();
  await refreshEnvironmentFromActiveTab();

  chrome.tabs.onActivated.addListener(async () => {
    await refreshEnvironmentFromActiveTab();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status === "loading" || changeInfo.url) {
      await refreshEnvironmentFromActiveTab();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return;
    }

    switch (message.type) {
      case "getEnvironment":
        sendResponse({ environment: { ...environment } });
        break;
      case "runSafetyCheck":
        handleSafetyCheck(message)
          .then((result) => sendResponse(result))
          .catch((error) => {
            console.warn("[InterSafety] Safety check failed", error);
            sendResponse({
              status: "skipped",
              reason: "Safety check unavailable"
            });
          });
        return true;
      default:
        break;
    }
    return undefined;
  });
}

async function ensureDefaults() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  if (stored && stored[STORAGE_KEY]) {
    return;
  }
  await chrome.storage.sync.set({ [STORAGE_KEY]: defaultSettings });
}

async function refreshEnvironmentFromActiveTab() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = activeTab?.url ?? "";
    const onChatGPT = isChatGPTUrl(url);

    if (environment.onChatGPT === onChatGPT && environment.url === url) {
      return;
    }

    environment.onChatGPT = onChatGPT;
    environment.url = url;
    environment.updatedAt = Date.now();

    await chrome.storage.session.set({ [ENVIRONMENT_KEY]: environment });
    await broadcastEnvironment();
  } catch (error) {
    console.warn("[InterSafety] Unable to refresh environment", error);
  }
}

async function broadcastEnvironment() {
  const payload = { type: "environmentUpdated", environment: { ...environment } };
  chrome.runtime.sendMessage(payload).catch(() => {
    /* No active listeners (popup closed). */
  });
}

function isChatGPTUrl(url) {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("chatgpt.com");
  } catch (_error) {
    return false;
  }
}

async function handleSafetyCheck(message) {
  const { prompt, metadata } = message;
  if (!prompt || typeof prompt !== "string") {
    return {
      status: "skipped",
      reason: "No prompt supplied"
    };
  }

  // Placeholder for future InterSafety API integration.
  return {
    status: "skipped",
    reason: "InterSafety API integration pending",
    metadata: metadata ?? null
  };
}
