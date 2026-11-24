# Moodle Quiz Bot — Browser Extension (Manifest V3)

Faithful reimplementation of the Python + Playwright bot as a
Chrome/Brave browser extension. No bundler, no build step, no CDN scripts.

## Install

1. Open **Brave** (or Chrome) and go to `brave://extensions` (or `chrome://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` directory inside this project
5. The extension icon appears in the toolbar

## Configure

1. Right-click the extension icon → **Options**
2. Enter your **OpenRouter API key** (get one free at https://openrouter.ai/keys)
3. Optionally configure **Ollama** (install from https://ollama.ai, run `ollama pull qwen2.5:7b`, then `ollama serve`)
4. Gemini accepts several backup keys (comma/newline separated); a key that hits HTTP 429 / quota is cooled down and the next ready key answers automatically
5. Toggle features on/off as needed
6. Click **Save Settings**

## Usage

1. Log into your Moodle site (the extension injects on `https://amaes.com/*`)
2. Open a quiz
3. Opening a course or quiz page starts background harvesting for individual subject/topic words; the HUD reports HTTP status and matched-card counts
4. Opening a course or grades page also scans `/grade/report/user/index.php` for completed quizzes, fetches each `review.php?attempt=...&showall=1` page and learns every verified answer / eliminated choice (once per course per 6 hours)
5. The **Harvest** HUD button re-runs both harvests for the current course
6. The bot automatically scans for unanswered questions
7. The HUD panel (bottom-right) shows progress, tier used, and answers
8. **Stop** button aborts the loop
9. Each tier is tried in order: Answer Key → Web Search → Gemini → OpenRouter → Ollama
10. If every tier fails, the bot waits for your manual input (with a 5-minute timeout)

## Pre-exam Answer Bank

From the project directory, run the standard-library-only scraper with one or more
queries:

```powershell
python harvest.py --pages 5 "CS6206" "Active Directory"
```

With no query arguments, `harvest.py` reads non-empty lines from `topics.txt`.
The scraper merges results into `ama_bank.json`; open the extension Options page
and select **Import Answer Bank (.json)** to add them to local extension storage.
Use **Export Answer Bank (.json)** to back up or share the bank, including answers
learned from Moodle review pages.

## Question Types Supported

- **MCQ** (single radio button) — answer key → web search → AI
- **Multi-answer** (checkboxes) — key + AI picks, filtered, scored
- **Short answer** (text input) — key → web → AI with retry variants
- **True/False** — judged by AI with bool-specific prompt
- **Matching** (dropdown selects) — one key per sub-statement: verified bank pairs fill first, then a single batch AI request resolves every unanswered row, and graded review rows are learned back as verified pairs. Checkmarks/crosses drive iterative elimination and 2-row swap deduction
- **Math / images** — `<sup>`/`<sub>` markup becomes `2³` / `10₂`, and attempt-specific `pluginfile.php` URLs collapse to a stable `[moodle-asset:file]` token so questions match across attempts

## Tier Order

1. **Answer Key** — local question bank, then `amauoed.com`
2. **Web Search** — DuckDuckGo/Wikipedia snippets and exact option matching
3. **Gemini** — optional free AI fallback
4. **OpenRouter** — cloud AI and optional web-plugin fallback
5. **Ollama** — local fallback AI

## Permissions

| Permission | Why |
|------------|------|
| `storage` | Cache answer keys, wrong answers, search results, settings |
| `tabs` | Read quiz URL to detect attempt/review pages |
| `https://amaes.com/*` | Moodle instance — content script injection |
| `https://amauoed.com/*` | Answer key lookup |
| `https://openrouter.ai/*` | Cloud AI API |
| `http://127.0.0.1:11434/*` | Local Ollama API |

## Rollback

Removing the extension restores the Python + Playwright bot with no other changes.
The extension does NOT modify any files on disk — all cached data (answer keys,
wrong answers, search results) is stored in `chrome.storage.local` and is removed
when the extension is uninstalled.

To uninstall:
1. Go to `brave://extensions` (or `chrome://extensions`)
2. Click **Remove** on the Moodle Quiz Bot entry
3. All stored data is automatically cleared

No residual files, no registry changes, no persisted background processes.