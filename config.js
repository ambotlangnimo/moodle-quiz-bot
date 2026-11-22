// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG — defaults + chrome.storage.sync overlay
//  Ported verbatim from bot.py + answerkey.py environment variables.
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

  // OpenRouter
  OPENROUTER_API_KEY: '',
  OPENROUTER_MODEL: 'deepseek/deepseek-v4.1-flash',
  OPENROUTER_VISION_MODEL: '',
  OPENROUTER_COOLDOWN: 180,
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_WEB_ENABLED: false, // web plugin is billed per search; off = much cheaper

  // Gemini
  GEMINI_API_KEY: '',
  GEMINI_MODEL: 'gemini-3.8-flash',

  // Ollama
  OLLAMA_URL: 'http://127.0.0.1:11434',
  OLLAMA_MODEL: 'qwen2.5:7b',
  OLLAMA_VISION_MODEL: '',
  OLLAMA_API_KEY: '',
  OLLAMA_NUM_CTX: 4096,
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

const PLACEHOLDER_RE = /answer\s*\d+\s*[\.\)]?\s*question\s*\d+/gi;

// In-memory merged config.
let _merged = { ...DEFAULTS };

/**
 * Load settings from chrome.storage.sync and merge with defaults.
 * Called once at startup by background.js and content.js.
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (items) => {
      if (chrome.runtime.lastError) {
        console.warn('[config] storage.sync error:', chrome.runtime.lastError.message);
        resolve({ ...DEFAULTS });
        return { ...DEFAULTS };
      }
      _merged = { ...DEFAULTS };
      for (const [k, v] of Object.entries(items)) {
        if (k in DEFAULTS && v !== undefined && v !== null) {
          _merged[k] = v;
        }
      }
      const geminiModel = String(_merged.GEMINI_MODEL || '').trim();
      if (!geminiModel || geminiModel === 'gemini-2.5-flash') {
        _merged.GEMINI_MODEL = 'gemini-3.8-flash';
        chrome.storage.sync.set({ GEMINI_MODEL: _merged.GEMINI_MODEL });
      }
      const ollamaUrl = String(_merged.OLLAMA_URL || '').trim();
      const ollamaModel = String(_merged.OLLAMA_MODEL || '').trim();
      const ollamaUpdates = {};
      if (!ollamaUrl) {
        _merged.OLLAMA_URL = DEFAULTS.OLLAMA_URL;
        ollamaUpdates.OLLAMA_URL = _merged.OLLAMA_URL;
      }
      if (!ollamaModel || ollamaModel === 'gemma4:e2b') {
        _merged.OLLAMA_MODEL = DEFAULTS.OLLAMA_MODEL;
        ollamaUpdates.OLLAMA_MODEL = _merged.OLLAMA_MODEL;
      }
      if (Object.keys(ollamaUpdates).length) chrome.storage.sync.set(ollamaUpdates);
      resolve(_merged);
    });
  });
}

/**
 * Save a set of config keys to storage.sync.
 */
async function saveConfig(updates) {
  return new Promise((resolve) => {
    const filtered = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k in DEFAULTS) {
        filtered[k] = v;
        _merged[k] = v;
      }
    }
    chrome.storage.sync.set(filtered, () => {
      resolve();
    });
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