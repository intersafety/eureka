const STORAGE_KEY = "intersafetySettings";
const PREVIEW_STYLE_ID = "intersafety-preview-style";
const TOAST_STYLE_ID = "intersafety-toast-style";
const TOAST_ID = "intersafety-toast";

const defaultSettings = {
  enabled: false,
  voiceMode: "off",
  jsonPrompting: false
};

let settings = { ...defaultSettings };
let initialized = false;

const previewState = {
  active: false,
  editable: null,
  originalValue: "",
  originalHTML: "",
  previewValue: "",
  isTextarea: false,
  selectionStart: null,
  selectionEnd: null,
  scrollTop: 0
};

let toastElement = null;
let toastTimer = null;

init();

async function init() {
  if (initialized) {
    return;
  }
  initialized = true;

  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  settings = migrateSettings(stored?.[STORAGE_KEY]);

  injectPreviewStyles();
  injectToastStyles();

  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("keyup", handleKeyup, true);
  window.addEventListener(
    "blur",
    () => {
      clearPreview();
    },
    true
  );
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "sync" || !changes[STORAGE_KEY]) {
    return;
  }
  const { newValue } = changes[STORAGE_KEY];
  settings = migrateSettings(newValue);
}

function handleKeydown(event) {
  if (!settings.enabled) {
    if (event.key === "Shift") {
      clearPreview();
    }
    return;
  }

  if (event.key === "Shift" && !event.repeat) {
    const editable = resolveEventEditable(event.target);
    if (!editable) {
      return;
    }
    const original = readValue(editable);
    if (!original.trim()) {
      return;
    }
    const improved = improvePrompt(original);
    if (!improved.trim() || improved === original) {
      return;
    }
    activatePreview(editable, original, improved);
    return;
  }

  const editable = resolveEventEditable(event.target);

  if (
    event.key === "Enter" &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing
  ) {
    if (previewState.active && previewState.editable === editable) {
      event.preventDefault();
      clearPreview({ commit: true });
      if (editable) {
        dispatchInput(editable);
      }
    }
    return;
  }

  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing
  ) {
    if (!editable) {
      return;
    }
    const original = readValue(editable);
    if (!original.trim()) {
      return;
    }
    const improved = improvePrompt(original);
    if (improved === original) {
      return;
    }

    event.preventDefault();
    processSend(editable, original, improved);
    return;
  }

  if (previewState.active) {
    clearPreview();
  }
}

function handleKeyup(event) {
  if (event.key === "Shift") {
    clearPreview();
  }
}

async function processSend(editable, original, improved) {
  const wasPreviewing = previewState.active && previewState.editable === editable;

  const safetyResult = await runSafetyCheck(improved, original);
  if (safetyResult.status === "blocked") {
    const reason = safetyResult.reason || "Prompt blocked by safety policy.";
    showSafetyToast(reason);
    if (wasPreviewing) {
      clearPreview();
    } else {
      writeValue(editable, original);
      dispatchInput(editable);
    }
    return;
  }

  hideSafetyToast();

  if (wasPreviewing) {
    clearPreview({ commit: true });
  } else {
    writeValue(editable, improved);
  }

  dispatchInput(editable);

  requestAnimationFrame(() => {
    if (!clickSendButton()) {
      dispatchEnter(editable);
    }
  });
}

function activatePreview(editable, original, improved) {
  if (previewState.active && previewState.editable !== editable) {
    clearPreview();
  }

  previewState.active = true;
  previewState.editable = editable;
  previewState.previewValue = improved;
  previewState.isTextarea = editable instanceof HTMLTextAreaElement;
  previewState.selectionStart = null;
  previewState.selectionEnd = null;
  previewState.scrollTop = 0;

  if (previewState.isTextarea) {
    previewState.originalValue = editable.value;
    previewState.scrollTop = editable.scrollTop;
    previewState.selectionStart = editable.selectionStart;
    previewState.selectionEnd = editable.selectionEnd;
    editable.value = improved;
    editable.scrollTop = previewState.scrollTop;
  } else {
    previewState.originalValue = editable.innerText;
    previewState.originalHTML = editable.innerHTML;
    setContentEditableText(editable, improved);
    moveCaretToEnd(editable);
  }

  editable.setAttribute("data-intersafety-preview", "true");
  dispatchInput(editable);
}

function clearPreview(options = {}) {
  const { commit = false } = options;
  if (!previewState.active || !previewState.editable) {
    return;
  }

  const editable = previewState.editable;
  if (!document.contains(editable)) {
    resetPreviewState();
    return;
  }

  editable.removeAttribute("data-intersafety-preview");

  if (previewState.isTextarea) {
    const valueToRestore = commit
      ? previewState.previewValue
      : previewState.originalValue;
    editable.value = valueToRestore;
    editable.scrollTop = previewState.scrollTop;

    if (!commit && previewState.selectionStart !== null && previewState.selectionEnd !== null) {
      editable.setSelectionRange(previewState.selectionStart, previewState.selectionEnd);
    } else {
      const cursor = valueToRestore.length;
      editable.setSelectionRange(cursor, cursor);
    }
  } else {
    if (commit) {
      setContentEditableText(editable, previewState.previewValue);
    } else {
      editable.innerHTML = previewState.originalHTML;
    }
    moveCaretToEnd(editable);
  }

  if (!commit) {
    dispatchInput(editable);
  }

  resetPreviewState();
}

function resetPreviewState() {
  previewState.active = false;
  previewState.editable = null;
  previewState.originalValue = "";
  previewState.originalHTML = "";
  previewState.previewValue = "";
  previewState.isTextarea = false;
  previewState.selectionStart = null;
  previewState.selectionEnd = null;
  previewState.scrollTop = 0;
}

function injectPreviewStyles() {
  if (document.getElementById(PREVIEW_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = PREVIEW_STYLE_ID;
  style.textContent = `
    textarea[data-intersafety-preview="true"],
    [contenteditable="true"][data-intersafety-preview="true"] {
      color: rgba(204, 220, 234, 0.65) !important;
      caret-color: rgba(204, 220, 234, 0.45) !important;
    }

    [contenteditable="true"][data-intersafety-preview="true"] * {
      color: inherit !important;
    }
  `;
  const host = document.head || document.documentElement;
  host.appendChild(style);
}

function injectToastStyles() {
  if (document.getElementById(TOAST_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = TOAST_STYLE_ID;
  style.textContent = `
    #${TOAST_ID} {
      position: fixed;
      bottom: 32px;
      right: 32px;
      max-width: 320px;
      padding: 12px 16px;
      border-radius: 12px;
      background: rgba(206, 55, 97, 0.95);
      color: #fff;
      font-size: 13px;
      line-height: 1.45;
      box-shadow: 0 18px 36px rgba(0, 0, 0, 0.35);
      z-index: 2147483647;
      opacity: 0;
      transform: translateY(12px);
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    #${TOAST_ID}.visible {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  const host = document.head || document.documentElement;
  host.appendChild(style);
}

function migrateSettings(raw) {
  const hydrated = {
    ...defaultSettings,
    ...(raw ?? {})
  };

  if (!["off", "natural", "ai"].includes(hydrated.voiceMode)) {
    if (hydrated.naturalVoice) {
      hydrated.voiceMode = "natural";
    } else if (hydrated.aiVoice) {
      hydrated.voiceMode = "ai";
    } else {
      hydrated.voiceMode = "off";
    }
  }

  return {
    enabled: Boolean(hydrated.enabled),
    voiceMode: hydrated.voiceMode,
    jsonPrompting: Boolean(hydrated.jsonPrompting)
  };
}

async function runSafetyCheck(improvedPrompt, originalPrompt) {
  try {
    const response = await sendRuntimeMessage({
      type: "runSafetyCheck",
      prompt: improvedPrompt,
      metadata: {
        originalLength: originalPrompt.length,
        refinedLength: improvedPrompt.length,
        voiceMode: settings.voiceMode,
        jsonPrompting: settings.jsonPrompting
      }
    });

    if (response && typeof response.status === "string") {
      return response;
    }
  } catch (error) {
    console.warn("[InterSafety] Safety check unavailable", error);
  }

  return {
    status: "skipped",
    reason: "Safety check unavailable"
  };
}

function improvePrompt(original) {
  const trimmed = original.trim();
  if (!trimmed) {
    return original;
  }

  let improved = normalizeWhitespace(trimmed);

  const firstBreak = improved.indexOf("\n");
  const firstSegment =
    firstBreak === -1 ? improved : improved.slice(0, firstBreak);
  if (firstSegment && !/[.?!:]$/.test(firstSegment)) {
    improved =
      firstSegment + "." + (firstBreak === -1 ? "" : improved.slice(firstBreak));
  }

  const additions = [];

  if (settings.jsonPrompting) {
    const template = buildJsonTemplate(trimmed);
    addInstruction(
      additions,
      improved,
      "Return only valid JSON with fields `context`, `analysis`, `steps`, and `answer`. Use double quotes and omit trailing commentary."
    );
    addInstruction(
      additions,
      improved,
      `Respond with a structure that mirrors this template, where \`context\` reproduces the exact user prompt:\n\`\`\`json\n${template}\n\`\`\``
    );
  } else {
    addInstruction(
      additions,
      improved,
      "Provide the answer step-by-step with concise reasoning."
    );
    addInstruction(
      additions,
      improved,
      "Highlight the most important takeaways at the end."
    );

    if (settings.voiceMode === "natural") {
      addInstruction(
        additions,
        improved,
        "Use a warm, collaborative tone grounded in current UX and linguistics research on AI giveaways. Avoid mirrored sentence rhythm, stock transitions like 'Overall' or 'In conclusion', and stacked adjective clusters. Do not use the rule of three or em dashes; vary cadence naturally."
      );
    } else if (settings.voiceMode === "ai") {
      addInstruction(
        additions,
        improved,
        "Adopt a precise, analytical AI voice with succinct sentences and explicitly numbered logic."
      );
    }
  }

  if (!additions.length) {
    return improved;
  }

  return improved + "\n\n" + additions.join(" ");
}

function buildJsonTemplate(originalPrompt) {
  const escapedPrompt = escapeForJsonString(originalPrompt.trim());
  return (
    '{\n' +
    `  "context": "${escapedPrompt}",\n` +
    '  "analysis": [],\n' +
    '  "steps": [],\n' +
    '  "answer": ""\n' +
    "}"
  );
}

function escapeForJsonString(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function addInstruction(list, text, addition) {
  if (containsSegment(text, addition)) {
    return;
  }
  if (list.some((existing) => containsSegment(existing, addition))) {
    return;
  }
  list.push(addition);
}

function containsSegment(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function normalizeWhitespace(value) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeEditable(candidate) {
  if (!candidate) {
    return null;
  }
  if (candidate instanceof HTMLTextAreaElement) {
    return candidate;
  }
  if (!(candidate instanceof HTMLElement)) {
    return null;
  }
  let element = candidate;
  if (!element.isContentEditable) {
    element = element.closest('[contenteditable="true"]');
    if (!element) {
      return null;
    }
  }
  if (element.id === "prompt-textarea") {
    return element;
  }
  const descendantPrompt = element.querySelector("#prompt-textarea");
  if (descendantPrompt) {
    return descendantPrompt;
  }
  const ancestorPrompt = element.closest("#prompt-textarea");
  if (ancestorPrompt) {
    return ancestorPrompt;
  }
  return element;
}

function resolveEditable(target) {
  const scope = (target && target.ownerDocument) || document;

  const normalized = normalizeEditable(target);
  if (normalized) {
    return normalized;
  }

  const textarea = scope.querySelector("textarea");
  if (textarea) {
    return textarea;
  }

  const promptArea =
    normalizeEditable(scope.querySelector("#prompt-textarea")) ||
    normalizeEditable(scope.querySelector('[contenteditable="true"]'));

  return promptArea || null;
}

function resolveEventEditable(target) {
  return (
    resolveEditable(target) ||
    resolveEditable(document.activeElement) ||
    resolveEditable(null)
  );
}

function readValue(editable) {
  if (editable instanceof HTMLTextAreaElement) {
    return editable.value;
  }
  return editable.innerText || "";
}

function writeValue(editable, value) {
  if (editable instanceof HTMLTextAreaElement) {
    editable.value = value;
    editable.setSelectionRange(value.length, value.length);
    return;
  }

  setContentEditableText(editable, value);
  moveCaretToEnd(editable);
}

function moveCaretToEnd(editable) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function dispatchInput(editable) {
  const event = new Event("input", { bubbles: true, cancelable: true });
  editable.dispatchEvent(event);
}

function setContentEditableText(editable, value) {
  const root = getEditableRoot(editable);
  if (!root) {
    return;
  }
  if (root instanceof HTMLTextAreaElement) {
    root.value = value;
    return;
  }
  const html = buildParagraphHTML(value);
  root.innerHTML = html;
}

function buildParagraphHTML(value) {
  const normalized = (value ?? "").replace(/\r\n/g, "\n");
  const paragraphs = normalized.split(/\n{2,}/);

  if (!paragraphs.length) {
    return "<p><br></p>";
  }

  return paragraphs
    .map((para) => {
      const lines = para.split("\n");
      const body = lines
        .map((line) => {
          const escaped = escapeHtml(line);
          return escaped.length ? escaped : "<br>";
        })
        .join("<br>");
      const content = body.length ? body : "<br>";
      return `<p>${content}</p>`;
    })
    .join("");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function getEditableRoot(editable) {
  if (!editable) {
    return null;
  }
  if (editable instanceof HTMLTextAreaElement) {
    return editable;
  }
  if (!(editable instanceof HTMLElement)) {
    return null;
  }
  if (editable.id === "prompt-textarea") {
    return editable;
  }
  const descendant = editable.querySelector("#prompt-textarea");
  if (descendant) {
    return descendant;
  }
  const ancestor = editable.closest("#prompt-textarea");
  if (ancestor) {
    return ancestor;
  }
  return editable;
}

function showSafetyToast(message) {
  const toast = ensureToastElement();
  toast.textContent = message;
  toast.classList.add("visible");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    hideSafetyToast();
  }, 5000);
}

function hideSafetyToast() {
  if (!toastElement) {
    return;
  }
  toastElement.classList.remove("visible");
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

function ensureToastElement() {
  if (toastElement && document.contains(toastElement)) {
    return toastElement;
  }

  toastElement = document.createElement("div");
  toastElement.id = TOAST_ID;
  document.body.appendChild(toastElement);
  return toastElement;
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

function dispatchEnter(editable) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true
  });
  editable.dispatchEvent(event);
}

function clickSendButton() {
  const sendButton = document.querySelector('button[data-testid="send-button"]');
  if (!sendButton) {
    return false;
  }
  const disabled =
    sendButton.hasAttribute("disabled") ||
    sendButton.getAttribute("aria-disabled") === "true";
  if (disabled) {
    return false;
  }
  sendButton.click();
  return true;
}
