// ─────────────────────────────────────────────────────────────────────────────
//  popup.js — Enable/Disable toggle, on-demand tab harvester injection,
//  side panel launcher, and Options shortcut.
// ─────────────────────────────────────────────────────────────────────────────

const toggleButton = document.getElementById('toggleBtn');
const harvestTabButton = document.getElementById('harvestTabBtn');
const logButton = document.getElementById('logBtn');
const optionsButton = document.getElementById('optionsBtn');
const statusEl = document.getElementById('popupStatus');

function setPopupStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#f87171' : '#4ade80';
}

async function readEnabled() {
  try {
    const local = await chrome.storage.local.get('BOT_ENABLED');
    if (local && local.BOT_ENABLED !== undefined) return local.BOT_ENABLED !== false;
  } catch (error) { /* fall through to sync */ }
  try {
    const sync = await chrome.storage.sync.get('BOT_ENABLED');
    return !sync || sync.BOT_ENABLED !== false;
  } catch (error) {
    return true;
  }
}

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
  render(next);
  toggleButton.disabled = true;
  try {
    await writeEnabled(next);
  } catch (error) {
    render(!next);
    setPopupStatus('Could not save: ' + (error && error.message ? error.message : error), true);
  } finally {
    toggleButton.disabled = false;
  }
});

// On-demand harvester injection for any non-study tab (uses activeTab + scripting).
if (harvestTabButton) {
  harvestTabButton.addEventListener('click', async () => {
    harvestTabButton.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== 'number') {
        setPopupStatus('No active tab found.', true);
        return;
      }
      if (!/^https?:\/\//i.test(String(tab.url || ''))) {
        setPopupStatus('Cannot inject on browser internal pages.', true);
        return;
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['config.js', 'storage.js', 'universal-harvester.js'],
      });
      setPopupStatus('Harvester opened on this tab.');
    } catch (error) {
      setPopupStatus('Inject failed: ' + (error && error.message ? error.message : error), true);
    } finally {
      harvestTabButton.disabled = false;
    }
  });
}

if (logButton) {
  logButton.addEventListener('click', async () => {
    try {
      const win = await chrome.windows.getCurrent();
      if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && win && typeof win.id === 'number') {
        await chrome.sidePanel.open({ windowId: win.id });
        window.close();
      } else {
        setPopupStatus('Side panel not supported in this browser.', true);
      }
    } catch (error) {
      setPopupStatus('Could not open side panel: ' + error.message, true);
    }
  });
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' && area !== 'sync') return;
    if (!changes || !changes.BOT_ENABLED) return;
    const value = changes.BOT_ENABLED.newValue;
    render(value === undefined ? true : value);
  });
} catch (error) { /* storage events unavailable */ }

optionsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

readEnabled().then(render);
