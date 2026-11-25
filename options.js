// ─────────────────────────────────────────────────────────────────────────────
//  options.js — Config UI, provider connectivity test, GitHub sync, and
//  local question bank manager. Uses DEFAULTS / loadConfig / saveConfig from
//  config.js as the single source of truth.
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_MAP = [
  'MOODLE_URL',
  'CUSTOM_API_BASE_URL', 'CUSTOM_API_KEY', 'CUSTOM_MODEL',
  'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_KEY_COOLDOWN',
  'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_VISION_MODEL', 'OPENROUTER_WEB_ENABLED',
  'OLLAMA_URL', 'OLLAMA_MODEL', 'OLLAMA_VISION_MODEL', 'OLLAMA_NUM_CTX',
  'AUTO_SUBMIT', 'AUTO_CLICK_NEXT', 'AUTO_REATTEMPT', 'SCAN_INTERVAL',
  'MANUAL_TIMEOUT', 'MAX_RUN_HOURS', 'MAX_QUESTION_IMAGES', 'WEB_SEARCH_DOMAINS',
  'ANSWER_KEY_ENABLED', 'WEB_SEARCH_ENABLED', 'SHORT_ANSWER_ENABLED',
  'MULTI_ENABLED', 'MATCHING_ENABLED', 'VISION_ENABLED',
  'GITHUB_BANK_OWNER', 'GITHUB_BANK_REPO', 'GITHUB_BANK_PATH', 'GITHUB_SYNC_TOKEN',
];

document.addEventListener('DOMContentLoaded', async () => {
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
  checkForUpdates(false);

  // Secret reveal buttons
  for (const btn of document.querySelectorAll('button[data-reveal]')) {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-reveal'));
      if (!target) return;
      const hidden = target.type === 'password';
      target.type = hidden ? 'text' : 'password';
      btn.textContent = hidden ? 'Hide' : 'Show';
    });
  }

  const settings = await loadConfig();
  await refreshAnswerBankCount();
  await renderBankSearchResults('');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.answerkey_cache || changes.wrong_cache)) {
      refreshAnswerBankCount();
    }
  });

  // Populate all controls from canonical DEFAULTS + stored config.
  for (const key of FIELD_MAP) {
    const el = document.getElementById(key);
    if (!el) continue;
    let value = settings[key] !== undefined ? settings[key] : DEFAULTS[key];
    if (key === 'GITHUB_SYNC_TOKEN' && !value) value = settings.GITHUB_BANK_TOKEN || '';
    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else {
      el.value = value == null ? '' : String(value);
    }
  }

  // Save Settings handler
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;
    try {
      const collected = collectSettings();
      await saveConfig(collected);
      await requestOptionalHostOrigins(collected);
      showSaveFeedback('✓ Settings saved!', false);
    } catch (error) {
      showSaveFeedback((error && error.message) || String(error), true);
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Test AI Providers handler
  const testBtn = document.getElementById('testProvidersBtn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      const container = document.getElementById('providerTestResults');
      if (container) container.textContent = 'Testing configured providers...';
      try {
        await saveConfig(collectSettings());
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'testProviders' }, (resp) => {
            if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
            else resolve(resp || {});
          });
        });
        renderProviderTestResults(response);
      } catch (error) {
        if (container) container.textContent = 'Provider test failed: ' + error.message;
      } finally {
        testBtn.disabled = false;
      }
    });
  }

  // Bank Manager search + wrong-cache clear
  const searchInput = document.getElementById('bankSearchInput');
  const searchBtn = document.getElementById('bankSearchBtn');
  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => renderBankSearchResults(searchInput.value));
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') renderBankSearchResults(searchInput.value);
    });
  }
  const clearWrongBtn = document.getElementById('clearWrongCacheBtn');
  if (clearWrongBtn) {
    clearWrongBtn.addEventListener('click', async () => {
      clearWrongBtn.disabled = true;
      try {
        await wrongClearAll();
        await refreshAnswerBankCount();
        showStatus('Cleared wrong-answer cache.');
      } catch (error) {
        showStatus('Could not clear wrong cache: ' + error.message, true);
      } finally {
        clearWrongBtn.disabled = false;
      }
    });
  }

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
      await refreshAnswerBankCount();
      await renderBankSearchResults(searchInput ? searchInput.value : '');
      showSyncStatus(`Synced ${result.added} new answer(s) from GitHub bank. Stored questions: ${result.questions}.`, false);
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
      await flushNow();
      await refreshAnswerBankCount();
      await renderBankSearchResults(searchInput ? searchInput.value : '');
      showStatus(`Imported ${result.added} answer(s); question bank now has ${result.questions} questions.`);
    } catch (error) {
      showStatus(`Question bank import failed: ${error.message}`, true);
    } finally {
      importFile.value = '';
    }
  });
});

// Request optional host permission when user configures a custom Moodle or API origin.
async function requestOptionalHostOrigins(settings) {
  if (!chrome.permissions || typeof chrome.permissions.request !== 'function') return;
  const origins = [];
  for (const field of ['MOODLE_URL', 'CUSTOM_API_BASE_URL']) {
    const raw = String(settings[field] || '').trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
          !parsed.hostname.endsWith('amaes.com') &&
          parsed.hostname !== 'api.freellmapi.com') {
        origins.push(parsed.origin + '/*');
      }
    } catch (error) { /* ignore invalid URL */ }
  }
  if (!origins.length) return;
  try {
    await chrome.permissions.request({ origins });
  } catch (error) { /* user declined or permission already granted */ }
}

function renderProviderTestResults(response) {
  const container = document.getElementById('providerTestResults');
  if (!container) return;
  container.textContent = '';
  if (response && response.error) {
    const badge = document.createElement('span');
    badge.className = 'provider-badge fail';
    badge.textContent = response.error;
    container.appendChild(badge);
    return;
  }
  const results = (response && response.results) || {};
  const labels = { custom: 'FreeLLMAPI', gemini: 'Gemini', openrouter: 'OpenRouter', ollama: 'Ollama' };
  for (const [key, label] of Object.entries(labels)) {
    const item = results[key];
    if (!item) continue;
    const badge = document.createElement('span');
    badge.className = 'provider-badge ' + (item.ok ? 'ok' : (item.status === 'not_configured' ? '' : 'fail'));
    badge.textContent = `${label}: ${item.detail}`;
    container.appendChild(badge);
  }
}

async function renderBankSearchResults(query) {
  const container = document.getElementById('bankResults');
  if (!container) return;
  const items = await answerKeySearch(query, 40);
  container.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'bank-item';
    empty.textContent = query ? 'No banked questions matched your search.' : 'Local question bank is empty.';
    container.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'bank-item';
    const body = document.createElement('div');
    body.className = 'bank-item-body';
    const firstHit = item.hits[0] || {};
    const qEl = document.createElement('div');
    qEl.className = 'bank-q';
    qEl.textContent = firstHit.question || item.key;
    const aEl = document.createElement('div');
    aEl.className = 'bank-a';
    aEl.textContent = item.hits.map((h) => (h.verified ? '✓ ' : '') + h.answer).join(' | ');
    const metaEl = document.createElement('div');
    metaEl.className = 'bank-meta';
    metaEl.textContent = `Source: ${firstHit.course || 'unknown'} • ${item.hits.length} hit(s)`;
    body.append(qEl, aEl, metaEl);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-secondary btn-small';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      await answerKeyDelete(item.key);
      await flushNow();
      await refreshAnswerBankCount();
      await renderBankSearchResults(document.getElementById('bankSearchInput')?.value || '');
    });
    row.append(body, delBtn);
    frag.appendChild(row);
  }
  container.appendChild(frag);
}

async function syncGitHubBank(owner, repo, path, token) {
  try {
    let meta;
    try {
      meta = await gitHubGetFile(owner, repo, path, token);
    } catch (err) {
      return { error: `Network error: ${err.message}` };
    }
    if (meta.missing) return { error: `No question bank found at ${path} in ${owner}/${repo}.` };
    if (!meta.content || typeof meta.content !== 'object' || Array.isArray(meta.content)) {
      const detail = meta.parseError
        ? `: ${meta.parseError}`
        : (meta.content ? ': expected a JSON object at the top level' : '');
      return { error: `Could not parse ${path} as question-bank JSON${detail}` };
    }
    const pulled = await mergeRemoteBankIntoLocal(meta.content);
    return {
      status: 'ok', added: pulled.added, questions: pulled.questions,
      sha: meta.sha, size: meta.size, source: meta.source,
    };
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
  if (!counter) return;
  const [qCount, wCount] = await Promise.all([answerKeyCount(), wrongCount()]);
  counter.textContent = `Stored questions: ${qCount} • Wrong-answer records: ${wCount}`;
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

// ── Extension update checker ────────────────────────────────────────────────
const UPDATE_ZIP_URL = 'https://github.com/ambotlangnimo/moodle-quiz-bot/archive/refs/heads/main.zip';

function installedVersion() {
  try { return chrome.runtime.getManifest().version || '0.0.0'; } catch (error) { return '0.0.0'; }
}

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

function collectSettings() {
  const values = {};
  for (const key of FIELD_MAP) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') {
      values[key] = el.checked;
    } else if (el.type === 'number') {
      const num = Number(el.value);
      values[key] = el.value !== '' && Number.isFinite(num) ? num : DEFAULTS[key];
    } else {
      values[key] = el.value;
    }
  }
  return values;
}

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
