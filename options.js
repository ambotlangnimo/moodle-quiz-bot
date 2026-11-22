// ─────────────────────────────────────────────────────────────────────────────
//  options.js — Key + model + threshold config UI for Moodle Quiz Bot
// ─────────────────────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (items) => {
      if (chrome.runtime.lastError) resolve({});
      else resolve(items);
    });
  });
}

function saveSettings(values) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.set(values, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

const FIELD_MAP = [
  'CUSTOM_API_BASE_URL', 'CUSTOM_API_KEY', 'CUSTOM_MODEL',
  'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_KEY_COOLDOWN', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_VISION_MODEL',
  'OLLAMA_URL', 'OLLAMA_MODEL', 'OLLAMA_VISION_MODEL', 'OLLAMA_NUM_CTX',
  'AUTO_SUBMIT', 'AUTO_CLICK_NEXT', 'AUTO_REATTEMPT', 'SCAN_INTERVAL',
  'ANSWER_KEY_ENABLED', 'WEB_SEARCH_ENABLED', 'SHORT_ANSWER_ENABLED',
  'MULTI_ENABLED', 'MATCHING_ENABLED', 'VISION_ENABLED',
  'GITHUB_BANK_OWNER', 'GITHUB_BANK_REPO', 'GITHUB_BANK_PATH', 'GITHUB_SYNC_TOKEN',
];

document.addEventListener('DOMContentLoaded', async () => {
  // Extension update banner: version label + "Check for Updates" + 1-click ZIP.
  // Wired before the storage awaits so the section is usable immediately.
  renderVersionLabel(installedVersion());
  const checkUpdateBtn = document.getElementById('checkUpdateBtn');
  if (checkUpdateBtn) checkUpdateBtn.addEventListener('click', () => { checkForUpdates(true); });
  const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');
  if (downloadUpdateBtn) {
    downloadUpdateBtn.href = UPDATE_ZIP_URL;
    downloadUpdateBtn.addEventListener('click', () => {
      showUpdateStatus('ZIP download started — extract it over your extension folder, then click Reload in brave://extensions.', 'ok');
    });
  }
  // Cheap automatic check: the background answers from its 6-hour cache unless forced.
  checkForUpdates(false);

  const settings = await loadSettings();
  await refreshAnswerBankCount();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.answerkey_cache) refreshAnswerBankCount();
  });

  // Set initial values for all FIELD_MAP keys
  for (const key of FIELD_MAP) {
    const el = document.getElementById(key);
    if (!el) continue;
    const value = key === 'GEMINI_MODEL'
      ? (settings[key] && settings[key] !== 'gemini-2.5-flash' ? settings[key] : 'gemini-3.8-flash')
      : settings[key] !== undefined ? settings[key] : getDefault(key);
    if (el.type === 'checkbox') {
      el.checked = value;
    } else {
      el.value = value;
    }
  }

  // Save Settings handler — always shows visible feedback (inline + floating toast).
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;
    try {
      await saveSettings(collectSettings());
      showSaveFeedback('✓ Settings saved!', false);
    } catch (error) {
      showSaveFeedback((error && error.message) || String(error), true);
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Sync Now button handler
  document.getElementById('syncNowBtn').addEventListener('click', async () => {
    const owner = document.getElementById('GITHUB_BANK_OWNER').value.trim();
    const repo = document.getElementById('GITHUB_BANK_REPO').value.trim();
    const path = document.getElementById('GITHUB_BANK_PATH').value.trim() || 'bank.json';
    const token = document.getElementById('GITHUB_SYNC_TOKEN').value.trim();

    if (!owner || !repo) {
      showSyncStatus('Please enter both owner and repo name.', true);
      return;
    }

    showSyncStatus('Syncing...');
    const result = await syncGitHubBank(owner, repo, path, token);
    if (result && result.status === 'ok') {
      showSyncStatus(`Synced ${result.added} new answer(s) from GitHub bank.`, false);
    } else {
      showSyncStatus(result?.error || 'Sync failed.', true);
    }
  });

  document.getElementById('exportQuestionBankBtn').addEventListener('click', exportQuestionBank);
  const importFile = document.getElementById('importQuestionBankFile');
  document.getElementById('importQuestionBankBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      const result = await answerKeyImport(imported);
      await refreshAnswerBankCount();
      showStatus(`Imported ${result.added} answer(s); question bank now has ${result.questions} questions.`);
    } catch (error) {
      showStatus(`Question bank import failed: ${error.message}`, true);
    } finally {
      importFile.value = '';
    }
  });
});

async function syncGitHubBank(owner, repo, path, token) {
  try {
    // 1) Always GET metadata first so we have the current `sha` (required for updates).
    let meta;
    try {
      meta = await gitHubGetFile(owner, repo, path, token);
    } catch (err) {
      return { error: `Network error: ${err.message}` };
    }

    // 2) Merge: start from whatever the remote bank already holds.
    let bankObj = {};
    if (meta.content && typeof meta.content === 'object' && !Array.isArray(meta.content)) {
      bankObj = meta.content;
    }

    // 3) PUT with `sha` (omitted only for a brand-new file), retrying once on a stale sha.
    const commitMsg = 'Moodle Quiz Bot: auto-sync from extension';
    const put = await gitHubPutJson(owner, repo, path, token, bankObj, commitMsg, meta.sha);
    if (!put.ok) {
      return { error: `GitHub PUT failed: ${put.status} ${put.message || ''}` };
    }

    return { status: 'ok', added: 0 };
  } catch (err) {
    return { error: `Sync failed: ${err.message}` };
  }
}

async function exportQuestionBank() {
  try {
    const questions = await answerKeyGetAll();
    await refreshAnswerBankCount();
    const blob = new Blob([JSON.stringify({
      format: 'moodle-quiz-bot-question-bank',
      version: 1,
      exportedAt: new Date().toISOString(),
      questions,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'moodle-quiz-question-bank.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus(`Exported ${Object.keys(questions).length} questions.`);
  } catch (error) {
    showStatus(`Question bank export failed: ${error.message}`, true);
  }
}

async function refreshAnswerBankCount() {
  const counter = document.getElementById('answerBankCount');
  if (counter) counter.textContent = `Stored questions: ${await answerKeyCount()}`;
}

function showStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.className = isError ? 'error' : 'success';
  status.textContent = message;
  status.style.display = 'block';
  setTimeout(() => { status.style.display = 'none'; }, 5000);
}

function showSyncStatus(message, isError = false) {
  const el = document.getElementById('syncStatus');
  el.style.color = isError ? '#d63851' : '#4c1';
  el.textContent = message;
  setTimeout(() => { el.textContent = ''; }, 5000);
}

// ── Extension update checker (1-click ZIP download) ─────────────────────────
const UPDATE_ZIP_URL = 'https://github.com/ambotlangnimo/moodle-quiz-bot/archive/refs/heads/main.zip';

function installedVersion() {
  try { return chrome.runtime.getManifest().version || '0.0.0'; } catch (error) { return '0.0.0'; }
}

// Ask the service worker for the GitHub status. force=true skips its 6-hour cache.
function requestUpdateCheck(force) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: 'CHECK_EXTENSION_UPDATE', force: !!force }, (response) => {
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else if (!response) resolve({ error: 'Background worker did not answer' });
        else resolve(response);
      });
    } catch (error) {
      resolve({ error: (error && error.message) || String(error) });
    }
  });
}

function showUpdateStatus(message, tone) {
  const el = document.getElementById('updateStatus');
  if (!el) return;
  el.textContent = message;
  el.className = tone || '';
}

function renderVersionLabel(version) {
  const el = document.getElementById('extVersion');
  if (el) el.textContent = 'Installed: v' + (version || installedVersion());
}

async function checkForUpdates(force) {
  const button = document.getElementById('checkUpdateBtn');
  const download = document.getElementById('downloadUpdateBtn');
  if (button) { button.disabled = true; button.textContent = 'Checking…'; }
  showUpdateStatus('Checking GitHub for a newer version…', '');

  const result = await requestUpdateCheck(force);
  if (button) { button.disabled = false; button.textContent = 'Check for Updates'; }

  const current = result.currentVersion || installedVersion();
  renderVersionLabel(current);

  if (result.error) {
    showUpdateStatus('Could not check for updates: ' + result.error, 'error');
    return result;
  }

  const latest = String(result.latestVersion || current).replace(/^v/i, '');
  if (result.updateAvailable) {
    showUpdateStatus('Update available: v' + latest + ' is on GitHub (installed v' + current + ').', 'warn');
    if (download) {
      download.href = result.downloadUrl || UPDATE_ZIP_URL;
      download.classList.add('show');
    }
  } else {
    showUpdateStatus('You are up to date (v' + latest + ').', 'ok');
    if (download) download.classList.remove('show');
  }
  return result;
}

// Gather the current values of all configurable fields.
function collectSettings() {
  const values = {};
  for (const key of FIELD_MAP) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') {
      values[key] = el.checked;
    } else if (el.type === 'number') {
      const num = Number(el.value);
      values[key] = el.value !== '' && Number.isFinite(num) ? num : el.value;
    } else {
      values[key] = el.value;
    }
  }
  return values;
}

// Recent save feedback: green "✓ Settings saved!" on success, red error on failure.
let _saveInlineTimer = null;
let _saveToastTimer = null;

function showSaveFeedback(message, isError = false) {
  const color = isError ? '#fca5a5' : '#22c55e';
  const background = isError ? '#7f1d1d' : '#065f46';

  const inline = document.getElementById('save-status');
  if (inline) {
    inline.textContent = message;
    inline.style.color = isError ? '#d63851' : '#22c55e';
    if (_saveInlineTimer) clearTimeout(_saveInlineTimer);
    _saveInlineTimer = setTimeout(() => { inline.textContent = ''; }, 3000);
  }

  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = message;
    toast.style.color = color;
    toast.style.background = background;
    toast.classList.add('show');
    if (_saveToastTimer) clearTimeout(_saveToastTimer);
    _saveToastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3000);
  }
}

function getDefault(key) {
  const defaults = {
    CUSTOM_API_BASE_URL: 'https://api.freellmapi.com/v1',
    CUSTOM_API_KEY: '',
    CUSTOM_MODEL: 'auto',
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-3.8-flash',
    GEMINI_KEY_COOLDOWN: 180,
    OPENROUTER_API_KEY: '', OPENROUTER_MODEL: 'deepseek/deepseek-v4.1-flash', OPENROUTER_VISION_MODEL: '',
    OLLAMA_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'qwen2.5:7b', OLLAMA_VISION_MODEL: '', OLLAMA_NUM_CTX: 16384,
    AUTO_SUBMIT: true, AUTO_CLICK_NEXT: true, AUTO_REATTEMPT: false, SCAN_INTERVAL: 300,
    ANSWER_KEY_ENABLED: true, WEB_SEARCH_ENABLED: true, SHORT_ANSWER_ENABLED: true,
    MULTI_ENABLED: true, MATCHING_ENABLED: true, VISION_ENABLED: true,
  };
  return defaults[key];
}