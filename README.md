# Moodle Quiz Bot (Manifest V3 Extension & Tampermonkey Userscript)

Browser extension (Chrome/Brave Manifest V3) and optional Tampermonkey userscript for automating Moodle quiz answering, learning verified answers from graded review pages, harvesting study sites, and syncing a shared question bank via GitHub.

## Features

- **Tiered Solver Waterfall**
  1. **Local Question Bank** (indexed in-memory fuzzy lookup + bundled starter `default_bank.json`)
  2. **Answer Key Lookup** (`amauoed.com`)
  3. **Web Search** (DuckDuckGo + Wikipedia snippets across configurable domains)
  4. **FreeLLMAPI / Custom OpenAI-Compatible Endpoint** (auto-resolves `/models` if model is `auto`)
  5. **Gemini** (multi-key automatic rotation + session-persisted 429 cooldowns)
  6. **OpenRouter** (cloud AI, with optional paid web-search plugin strictly gated by `OPENROUTER_WEB_ENABLED`)
  7. **Ollama** (local fallback AI)
  8. **Manual Wait Fallback** (saves manual selections locally to verify on review)
- **Question Types**: Single-choice MCQ, True/False, Multi-answer checkboxes (with partial-credit deduction), Short-answer text, Matching dropdowns (per-row bank lookup + single batch AI call + iterative elimination & 2-row swap deduction), and Vision (lazy image extraction up to `MAX_QUESTION_IMAGES`).
- **Automation Controls**: Auto-Click Next, Auto-Submit on `/mod/quiz/summary.php` (including Moodle confirmation modal), and optional Auto-Reattempt on `/mod/quiz/view.php` (capped per session).
- **Universal Q&A Harvester**: Auto-injects on supported study domains in an isolated Shadow DOM HUD, and can be injected on demand on any other tab via the popup **Harvest This Tab** button.
- **Live Log Side Panel**: Real-time persisted ring-buffered activity log via Chrome Side Panel.
- **GitHub Question Bank Sync**: Conflict-safe pull/merge/push with nested path support and 409/422 re-merge retry.
- **Local Bank Manager**: Search, inspect, delete entries, clear the wrong-answer cache, and import/export `.json` banks from Options.
- **Security & Privacy**:
  - API keys and GitHub tokens are stored only in `chrome.storage.local` (auto-migrated out of `chrome.storage.sync`).
  - Content scripts are scoped to Moodle and explicit study sites rather than injecting globally into banking/email pages.

## Install (Unpacked Extension)

1. Open **Brave** (`brave://extensions`) or **Chrome** (`chrome://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository root directory (containing `manifest.json`).
4. Click the extension icon → **Options & Bank Manager** to configure providers and test connectivity with **Test AI Providers**.

## Tampermonkey Userscript

Build the standalone userscript (requires Node.js 20+):

```bash
npm run build:userscript
```

Install the generated `moodle-quiz-bot.user.js` in Tampermonkey. Use the in-page gear button or Tampermonkey menu command to configure keys and GitHub sync.

## Development & Verification

Zero third-party npm packages are required; tests run on Node's built-in test runner:

```bash
npm run check            # Syntax-check every .js file
npm test                 # Run unit & integration test suite
npm run verify           # Rebuild userscript + syntax check + run all tests
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage`, `unlimitedStorage` | Local question bank, wrong-answer cache, preferences, and local-only secrets |
| `tabs`, `activeTab`, `scripting` | Detect Moodle pages, broadcast updates, and inject harvester on demand |
| `alarms` | MV3-safe 6-hour background update check against GitHub |
| `sidePanel` | Live activity log side panel |
| Explicit `host_permissions` + `optional_host_permissions` | Moodle, study sites, GitHub API, AI providers, and optional custom Moodle/API origins |
