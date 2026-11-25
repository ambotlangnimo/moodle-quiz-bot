// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG — single source of truth for defaults, secret/sync split, and live
//  cross-context updates.
//
//  Non-secret preferences live in chrome.storage.sync; API keys and GitHub
//  tokens live exclusively in chrome.storage.local (migrated automatically
//  from older sync installations so existing users lose nothing).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = Object.freeze({
  // Moodle
  MOODLE_URL: 'https://amaes.com',

  // FreeLLMAPI / Custom OpenAI-compatible endpoint
  CUSTOM_API_BASE_URL: 'https://api.freellmapi.com/v1',
  CUSTOM_API_KEY: '',
  CUSTOM_MODEL: 'auto',

  // GitHub Question Bank
  GITHUB_BANK_OWNER: '',
  GITHUB_BANK_REPO: '',
  GITHUB_BANK_PATH: 'bank.json',
  GITHUB_SYNC_TOKEN: '',
  // Legacy alias kept so older saved settings migrate cleanly.
  GITHUB_BANK_TOKEN: '',

  // OpenRouter
  OPENROUTER_API_KEY: '',
  OPENROUTER_MODEL: 'deepseek/deepseek-v4.1-flash',
  OPENROUTER_VISION_MODEL: '',
  OPENROUTER_COOLDOWN: 180,
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_WEB_ENABLED: false, // web plugin is billed per search; off = much cheaper

  // Gemini (`GEMINI_API_KEY` accepts comma/newline separated backup keys)
  GEMINI_API_KEY: '',
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_KEY_COOLDOWN: 180,

  // Ollama
  OLLAMA_URL: 'http://127.0.0.1:11434',
  OLLAMA_MODEL: 'qwen2.5:7b',
  OLLAMA_VISION_MODEL: '',
  OLLAMA_API_KEY: '',
  OLLAMA_NUM_CTX: 16384,
  OLLAMA_KEEP_ALIVE: '10m',
  OLLAMA_TIMEOUT_MS: 60000,

  // Behaviour
  PAUSE_AFTER_ANSWER: 300,
  PAUSE_AFTER_NEXT: 500,
  AUTO_CLICK_NEXT: true,
  AUTO_SUBMIT: true,
  SCAN_INTERVAL: 300,
  NAV_WAIT_MS: 900,
  MAX_SUBMIT_TRIES: 4,
  AUTO_REATTEMPT: false,

  // Short-answer
  SHORT_ANSWER_ENABLED: true,
  TYPE_DELAY_MS: 8,
  MAX_TEXT_RETRIES: 2,
  TYPE_ON_FAILURE: true,

  // Multi-answer
  MULTI_ENABLED: true,
  MULTI_MAX_PICKS: 4,

  // Matching
  MATCHING_ENABLED: true,
  MATCHING_MIN_MATCHED: 0.6,
  MATCHING_OPTION_FLOOR: 0.45,

  // True/False
  BOOL_QUESTION_MIN_SCORE: 0.55,

  // Vision
  VISION_ENABLED: true,
  MAX_QUESTION_IMAGES: 2,

  // Answer key (amauoed.com)
  ANSWER_KEY_ENABLED: true,
  ANSWER_KEY_TIMEOUT: 4,
  ANSWER_KEY_MIN_SCORE: 0.72,
  ANSWER_KEY_TEXT_MIN_SCORE: 0.82,
  ANSWER_KEY_MATCH_MIN_SCORE: 0.8,
  ANSWER_KEY_MAX_HITS: 4,

  // Web search
  WEB_SEARCH_ENABLED: true,
  WEB_SEARCH_MAX_RESULTS: 3,
  WEB_SEARCH_DOMAINS: 'amauoed.com,studocu.com,coursehero.com,docsity.com',

  // Limits
  MAX_Q_CHARS: 1200,
  WEB_Q_CHARS: 380,
  MAX_RUN_HOURS: 8,
  MANUAL_TIMEOUT: 300,

  // Answer key cache
  CACHE_TTL: 0,
  CACHE_MAX: 50000,

  // Extension specific
  BOT_ENABLED: true,
});

const SECRET_CONFIG_KEYS = Object.freeze([
  'CUSTOM_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'OLLAMA_API_KEY',
  'GITHUB_SYNC_TOKEN',
  'GITHUB_BANK_TOKEN',
]);

const SECRET_CONFIG_SET = new Set(SECRET_CONFIG_KEYS);
const PLACEHOLDER_RE = /answer\s*\d+\s*[\.\)]?\s*question\s*\d+/gi;

// In-memory merged config.
let _merged = { ...DEFAULTS };

function _storageGet(area, keys) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage[area]) {
        resolve({});
        return;
      }
      chrome.storage[area].get(keys, (items) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn(`[config] storage.${area} get error:`, chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        resolve(items || {});
      });
    } catch (error) {
      resolve({});
    }
  });
}

function _storageSet(area, values) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage[area]) {
        resolve();
        return;
      }
      chrome.storage[area].set(values, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function _storageRemove(area, keys) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage[area] ||
          typeof chrome.storage[area].remove !== 'function') {
        resolve();
        return;
      }
      chrome.storage[area].remove(keys, () => {
        void (chrome.runtime && chrome.runtime.lastError);
        resolve();
      });
    } catch (error) {
      resolve();
    }
  });
}

/**
 * Load settings from chrome.storage.sync (preferences) + chrome.storage.local
 * (secrets & BOT_ENABLED) and merge with DEFAULTS.
 * Transparently migrates any legacy secrets found in chrome.storage.sync into
 * chrome.storage.local and removes them from sync.
 */
async function loadConfig() {
  const [syncItems, localItems] = await Promise.all([
    _storageGet('sync', null),
    _storageGet('local', [...SECRET_CONFIG_KEYS, 'BOT_ENABLED']),
  ]);

  _merged = { ...DEFAULTS };

  // Apply non-secret preferences from sync.
  for (const [k, v] of Object.entries(syncItems)) {
    if (k in DEFAULTS && !SECRET_CONFIG_SET.has(k) && v !== undefined && v !== null) {
      _merged[k] = v;
    }
  }

  // Apply secrets from local, migrating any legacy values still in sync.
  const secretsToMigrate = {};
  const legacySyncToRemove = [];
  for (const key of SECRET_CONFIG_KEYS) {
    const localVal = localItems[key];
    const syncVal = syncItems[key];
    if (typeof localVal === 'string' && localVal.length > 0) {
      _merged[key] = localVal;
      if (syncVal !== undefined) legacySyncToRemove.push(key);
    } else if (typeof syncVal === 'string' && syncVal.length > 0) {
      _merged[key] = syncVal;
      secretsToMigrate[key] = syncVal;
      legacySyncToRemove.push(key);
    } else if (localVal !== undefined && localVal !== null) {
      _merged[key] = localVal;
    }
  }

  // Legacy token alias: promote GITHUB_BANK_TOKEN -> GITHUB_SYNC_TOKEN if unset.
  if (!_merged.GITHUB_SYNC_TOKEN && _merged.GITHUB_BANK_TOKEN) {
    _merged.GITHUB_SYNC_TOKEN = _merged.GITHUB_BANK_TOKEN;
    secretsToMigrate.GITHUB_SYNC_TOKEN = _merged.GITHUB_BANK_TOKEN;
  }

  // Local BOT_ENABLED wins for instant popup toggles.
  if (localItems.BOT_ENABLED !== undefined) {
    _merged.BOT_ENABLED = localItems.BOT_ENABLED !== false;
  }

  // Normalize deprecated/blank model defaults without locking user overrides.
  const syncMigrations = {};
  const geminiModel = String(_merged.GEMINI_MODEL || '').trim();
  if (!geminiModel || geminiModel === 'gemini-2.5-flash') {
    _merged.GEMINI_MODEL = DEFAULTS.GEMINI_MODEL;
    syncMigrations.GEMINI_MODEL = _merged.GEMINI_MODEL;
  }
  const ollamaUrl = String(_merged.OLLAMA_URL || '').trim();
  const ollamaModel = String(_merged.OLLAMA_MODEL || '').trim();
  if (!ollamaUrl) {
    _merged.OLLAMA_URL = DEFAULTS.OLLAMA_URL;
    syncMigrations.OLLAMA_URL = _merged.OLLAMA_URL;
  }
  if (!ollamaModel || ollamaModel === 'gemma4:e2b') {
    _merged.OLLAMA_MODEL = DEFAULTS.OLLAMA_MODEL;
    syncMigrations.OLLAMA_MODEL = _merged.OLLAMA_MODEL;
  }

  if (Object.keys(secretsToMigrate).length) {
    await _storageSet('local', secretsToMigrate).catch(() => {});
  }
  if (legacySyncToRemove.length) {
    await _storageRemove('sync', legacySyncToRemove);
  }
  if (Object.keys(syncMigrations).length) {
    await _storageSet('sync', syncMigrations).catch(() => {});
  }

  return _merged;
}

/**
 * Save a set of config keys: secrets go exclusively to chrome.storage.local,
 * preferences go to chrome.storage.sync. Throws if storage writes fail.
 */
async function saveConfig(updates) {
  const syncUpdates = {};
  const localUpdates = {};
  const syncSecretsToRemove = [];

  for (const [k, v] of Object.entries(updates || {})) {
    if (!(k in DEFAULTS)) continue;
    _merged[k] = v;
    if (SECRET_CONFIG_SET.has(k)) {
      localUpdates[k] = v;
      syncSecretsToRemove.push(k);
    } else {
      syncUpdates[k] = v;
      if (k === 'BOT_ENABLED') localUpdates[k] = v;
    }
  }

  if (Object.keys(localUpdates).length) {
    await _storageSet('local', localUpdates);
  }
  if (Object.keys(syncUpdates).length) {
    await _storageSet('sync', syncUpdates);
  }
  if (syncSecretsToRemove.length) {
    await _storageRemove('sync', syncSecretsToRemove);
  }
}

// Keep every context's in-memory `_merged` config synchronized live when
// Options, popup, or another tab updates settings or API keys.
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!changes || (area !== 'sync' && area !== 'local')) return;
    for (const [key, change] of Object.entries(changes)) {
      if (!(key in DEFAULTS)) continue;
      if (area === 'local' && !SECRET_CONFIG_SET.has(key) && key !== 'BOT_ENABLED') continue;
      if (area === 'sync' && SECRET_CONFIG_SET.has(key)) continue;
      const next = change ? change.newValue : undefined;
      _merged[key] = next !== undefined && next !== null ? next : DEFAULTS[key];
    }
  });
}

/**
 * Get a single config value (synchronous, from in-memory copy).
 */
function cfg(key) {
  return _merged[key];
}

/**
 * Get all config.
 */
function getAllConfig() {
  return { ..._merged };
}

/**
 * Ollama timeout in ms: accepts seconds (< 1000) or ms, never below 30 s.
 */
function ollamaTimeoutMs(value) {
  let ms = Number(value) || Number(_merged.OLLAMA_TIMEOUT_MS) || 60000;
  if (ms < 1000) ms *= 1000;
  return Math.max(ms, 30000);
}

/**
 * True when `hostname` matches the configured MOODLE_URL host or amaes.com.
 */
function moodleAllowedHost(hostname) {
  const host = String(hostname || '').toLowerCase().trim();
  if (!host) return false;
  if (host === 'amaes.com' || host.endsWith('.amaes.com')) return true;
  try {
    const configured = new URL(String(_merged.MOODLE_URL || DEFAULTS.MOODLE_URL)).hostname.toLowerCase();
    if (!configured) return false;
    return host === configured || host.endsWith('.' + configured);
  } catch (error) {
    return false;
  }
}
