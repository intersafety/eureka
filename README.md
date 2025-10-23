# Project Eureka

Goal: Chrome Extension to tap onto intersafety APIs for:
- Better Prompt generation
- Safe Prompt Generation

## InterSafety: Eureka MVP

The `extension/` directory contains the first working version of the Chrome extension. It improves prompts on `chatgpt.com` by adding lightweight guidance each time you press <kbd>Enter</kbd> while the improver is enabled.

### Features
- Toggle the prompt improver on/off from the popup dropdown.
- Pop-up automatically shifts into an "improving" colorway while you're on chatgpt.com with the improver enabled.
- Optional voice switch: Natural Voice (research-backed human tone) or AI Voice (analytical tone).
- Optional JSON Prompting toggle asks for a JSON response that includes the original prompt in a `context` field.
- Hold <kbd>Shift</kbd> to preview the polished prompt directly in the chat box (rendered in light grey); tap <kbd>Shift</kbd>+<kbd>Enter</kbd> to keep the refined draft in place without sending, and press <kbd>Enter</kbd> to auto-submit.
- Background service worker tracks whether the active tab is `chatgpt.com` and broadcasts status to the popup.
- Prior to dispatch, the content script asks the background safety stub for a go/no-go (ready for future InterSafety API integration).
- Automatically cleans prompt whitespace and appends the selected guidance moments before ChatGPT receives the message.

### Architecture & pipeline
1. **capture**: content script listens for <kbd>Enter</kbd> presses and intercepts the outgoing prompt when the improver is enabled.
2. **preprocess**: the prompt is normalized (whitespace trims, leading instruction punctuation) before refinement.
3. **refine**: Natural/AI voice heuristics and clarity prompts are appended according to popup settings.
4. **format-json**: when JSON prompting is toggled on, the final instruction includes a schema with the original prompt in the `context` field.
5. **safety-check** *(planned)*: background service worker currently returns a stub response; ready to proxy the InterSafety API.
6. **dispatch**: refined text replaces the textarea/ProseMirror content, React events are fired, and the send button is triggered.

### Load the extension in Chrome
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right switch).
3. Click **Load unpacked** and select the `extension/` folder in this repository.
4. Pin the extension if you want quick access to the popup.

### Using the improver
- Open `chatgpt.com`, type in the message field, and press <kbd>Enter</kbd>.
- When the improver toggle is **on**, your prompt is refined right before it is submitted.
- Natural Voice / AI Voice append tone guidance to the prompt (only one can be active).
- JSON Prompting rewrites the final instruction to request a JSON response.
- Hold <kbd>Shift</kbd> for a preview overlay; hit <kbd>Shift</kbd>+<kbd>Enter</kbd> while previewing to lock the refined draft, or release <kbd>Shift</kbd> to revert.
- Standard <kbd>Shift</kbd>+<kbd>Enter</kbd> newlines continue to work when the preview is inactive.

## Roadmap
- Connect to InterSafety APIs for deeper prompt safety checks.
- Apply a streaming or sliding-window analysis while typing (see [sliding window techniques](https://medium.com/@rishu__2701/mastering-sliding-window-techniques-48f819194fd7)).
- Add a final moderation pass powered by InterSafety once the API is integrated.
