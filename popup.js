// ─────────────────────────────────────────────────────────────────────────────
//  popup.js — the one-click Enable / Disable switch.
//
//  BOT_ENABLED is written to chrome.storage.local (content.js,
//  universal-harvester.js and mascot.js all watch that area, so every open tab
//  hides its HUD / harvester panel / pixel cat the moment the switch flips, no
//  page reload needed) and mirrored to chrome.storage.sync, which is where
//  config.js keeps its canonical settings copy.
// ─────────────────────────────────────────────────────────────────────────────

const toggleButton = document.getElementById('toggleBtn');

// Local first (instant switch), sync as the config.js fallback.
async function readEnabled() {
  try {
    const local = await chrome.storage.local.get('BOT_ENABLED');
    if (local && local.BOT_ENABLED !== undefined) return local.BOT_ENABLED !== false;
  } catch (error) { /* fall through to sync */ }
  try {
    const sync = await chrome.storage.sync.get('BOT_ENABLED');
    return !sync || sync.BOT_ENABLED !== false;
  } catch (error) {
    return true; // storage unavailable: behave like the default (enabled)
  }
}

// Save cleanly: both areas, local first so the live listeners fire right away.
// A failed .sync write (quota, sync disabled) never blocks the toggle.
async function writeEnabled(enabled) {
  await chrome.storage.local.set({ BOT_ENABLED: enabled });
  try {
    await chrome.storage.sync.set({ BOT_ENABLED: enabled });
  } catch (error) {
    console.warn('[popup] BOT_ENABLED sync mirror failed:', error && error.message ? error.message : error);
  }
}

function render(enabled) {
  const on = enabled !== false;
  toggleButton.textContent = on ? 'Disable' : 'Enable';
  toggleButton.className = 'btn' + (on ? ' active' : '');
  toggleButton.title = on
    ? 'Bot is enabled — click to hide the HUD and cat on every tab'
    : 'Bot is disabled — click to bring the HUD and cat back';
  toggleButton.setAttribute('aria-pressed', String(on));
}

toggleButton.addEventListener('click', async () => {
  const next = !(await readEnabled());
  render(next);                                  // optimistic: the UI reacts instantly
  toggleButton.disabled = true;
  try {
    await writeEnabled(next);
  } catch (error) {
    render(!next);                               // roll back on a hard failure
    toggleButton.title = 'Could not save: ' + (error && error.message ? error.message : error);
  } finally {
    toggleButton.disabled = false;
  }
});

// Stay in step if the value changes elsewhere (options page, another popup).
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' && area !== 'sync') return;
    if (!changes || !changes.BOT_ENABLED) return;
    const value = changes.BOT_ENABLED.newValue;
    render(value === undefined ? true : value);
  });
} catch (error) { /* storage events unavailable in this context */ }

document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

readEnabled().then(render);
