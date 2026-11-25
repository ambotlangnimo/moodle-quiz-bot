// ─────────────────────────────────────────────────────────────────────────────
//  PROVIDERS — tiered solver waterfall:
//  Local Bank -> amauoed.com -> Web Search -> FreeLLMAPI -> Gemini ->
//  OpenRouter (web optional) -> Ollama
// ─────────────────────────────────────────────────────────────────────────────

const BOOL_TRUE = new Set(['true', '1', 'yes', 't']);
const BOOL_FALSE = new Set(['false', '0', 'no', 'f']);
const FIG_HINTS = ['see fig', 'figure', 'see the diagram', 'refer to the image'];
const BLANK_RE = /[_\-]{3,}/;
const RETRY_VARIANTS = [
  '',
  'Your earlier answer was wrong. Give a DIFFERENT concept.',
  'Your earlier answers were wrong. Answer with the FULL formal name.',
  'Your earlier answers were wrong. Identify the broader topic.',
  'Your earlier answers were wrong. Answer with the most standard textbook term.',
];
const ACRO_RE = /^[A-Z]{2,6}$/;
const STOP_WORDS = new Set([
  'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'the', 'a', 'an',
  'also', 'called', 'which', 'what', 'it', 'its', 'of', 'in', 'on', 'for', 'to',
  'and', 'or', 'be', 'by', 'with', 'as', 'at', 'from', 'not', 'can', 'does',
]);

let _orCooldownUntil = 0;
let _orWebDisabled = false;
let _orDisabled = false;
let _geminiCooldownUntil = 0;
let _geminiDisabled = false;
let _customCooldownUntil = 0;
let _customDisabled = false;

function orCooling() {
  return !String(cfg('OPENROUTER_API_KEY') || '').trim() || _orDisabled || Date.now() / 1000 < _orCooldownUntil;
}
function orTriggerCooldown() {
  _orCooldownUntil = Date.now() / 1000 + (Number(cfg('OPENROUTER_COOLDOWN')) || 180);
}
function geminiCooling() {
  return !String(cfg('GEMINI_API_KEY') || '').trim() || _geminiDisabled || Date.now() / 1000 < _geminiCooldownUntil;
}
function geminiKeyCount() {
  return String(cfg('GEMINI_API_KEY') || '').split(/[\s,;]+/).map((key) => key.trim()).filter(Boolean).length;
}
function customCooling() {
  return !String(cfg('CUSTOM_API_KEY') || '').trim() || _customDisabled || Date.now() / 1000 < _customCooldownUntil;
}
function customTriggerCooldown() {
  _customCooldownUntil = Date.now() / 1000 + (Number(cfg('OPENROUTER_COOLDOWN')) || 180);
}

// Reset session-disabled flags automatically when the user saves a new API key.
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes) return;
    if (changes.OPENROUTER_API_KEY) { _orDisabled = false; _orWebDisabled = false; _orCooldownUntil = 0; }
    if (changes.GEMINI_API_KEY) { _geminiDisabled = false; _geminiCooldownUntil = 0; }
    if (changes.CUSTOM_API_KEY) { _customDisabled = false; _customCooldownUntil = 0; }
  });
}

let _lastProviderFailure = null;
function _recordProviderFailure(name, status, reason) {
  _lastProviderFailure = {
    name: String(name || ''),
    status: Number(status) || 0,
    reason: String(reason || '').trim() || 'unknown error',
    at: Date.now(),
  };
}
function _providerFailure(name, since) {
  const failure = _lastProviderFailure;
  if (!failure || failure.name !== name || failure.at < since) return '';
  return (failure.status ? 'HTTP ' + failure.status + ' - ' : '') + failure.reason;
}
function _skipReason(disabled, until) {
  if (disabled) return 'disabled for this session after a key/credits error';
  const left = Math.ceil(until - Date.now() / 1000);
  return left > 0 ? 'cooling down for ' + left + 's after a recent error' : '';
}

async function bgFetch(action, payload = {}, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(action + ' timed out'));
    }, timeout);
    chrome.runtime.sendMessage({ action, payload, _reqId: id }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error(action + ' returned no response'));
        return;
      }
      if (response.error) {
        const error = new Error(response.error);
        error.status = response.status;
        error.allKeysLimited = response.allKeysLimited === true;
        error.keysTried = response.keysTried || 0;
        error.keyCount = response.keyCount || 0;
        reject(error);
        return;
      }
      if (response._reqId !== id) {
        reject(new Error(action + ' returned a mismatched response'));
        return;
      }
      resolve(response);
    });
  });
}

function _warnOpenRouter(message, quiet) {
  console.warn('[OpenRouter] ' + message);
  if (!quiet && typeof logHUD === 'function') logHUD('warn', 'OpenRouter: ' + message);
}

async function postOpenRouter(messages, opts = {}) {
  if (orCooling()) return null;
  const model = opts.model || cfg('OPENROUTER_MODEL');
  const maxTokens = opts.maxTokens || 64;
  const temperature = opts.temperature ?? 0.1;
  const timeoutSeconds = opts.timeout || 25;
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (opts.plugins) body.plugins = opts.plugins;
  if (!String(cfg('OPENROUTER_API_KEY') || '').trim()) return null;
  const webPlugin = Boolean(opts.plugins && opts.plugins.some((plugin) => plugin.id === 'web'));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await bgFetch('postOpenRouter', { body, timeout: timeoutSeconds * 1000 }, (timeoutSeconds + 5) * 1000);
      if (response.error || [400, 401, 402, 429].includes(response.status)) {
        const error = new Error(typeof response.error === 'string' ? response.error : JSON.stringify(response.error || 'OpenRouter request failed'));
        error.status = response.status;
        throw error;
      }
      return response;
    } catch (error) {
      const status = error.status || Number((error.message.match(/\bHTTP\s+(\d{3})\b/i) || [])[1]) || 0;
      const reason = error.message || 'Unknown OpenRouter error';
      _recordProviderFailure('OpenRouter', status, reason);
      if (status === 401) {
        _orDisabled = true;
        _orWebDisabled = true;
        _warnOpenRouter(`Invalid API key (${reason}); OpenRouter disabled for this session.`, opts.quiet);
        return null;
      }
      if (status === 402) {
        _orDisabled = true;
        _orWebDisabled = true;
        _warnOpenRouter(`Insufficient credits (${reason}); OpenRouter disabled for this session.`, opts.quiet);
        return null;
      }
      if (webPlugin && status === 400) {
        _orWebDisabled = true;
        _warnOpenRouter(`web plugin failed (${reason}); disabling it and falling back to standard OpenRouter.`, opts.quiet);
        return null;
      }
      if (status === 429) {
        if (attempt === 0) {
          _warnOpenRouter(`Rate limited (${reason}); retrying once in 2.5 seconds.`, opts.quiet);
          await new Promise((resolve) => setTimeout(resolve, 2500));
          continue;
        }
        orTriggerCooldown();
        _warnOpenRouter(`Still rate limited (${reason}); cooling down and falling back to local Ollama.`, opts.quiet);
        return null;
      }
      if (status === 503) {
        orTriggerCooldown();
        _warnOpenRouter(`Service unavailable (${reason}); cooling down and falling back to local Ollama.`, opts.quiet);
        return null;
      }
      _warnOpenRouter(reason, opts.quiet);
      return null;
    }
  }
  return null;
}

async function postGemini(messages, opts = {}) {
  if (geminiCooling()) return null;
  const contents = [];
  for (const message of messages) {
    const parts = [];
    const items = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content || '' }];
    for (const item of items) {
      if (item.type === 'image_url') {
        const url = (item.image_url && item.image_url.url) || '';
        const image = url.match(/^data:([^;]+);base64,(.+)$/);
        if (image) parts.push({ inlineData: { mimeType: image[1], data: image[2] } });
      } else if (item.text) {
        parts.push({ text: item.text });
      }
    }
    if (parts.length) contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  try {
    const timeoutSeconds = opts.timeout || 30;
    const response = await bgFetch('postGemini', {
      model: cfg('GEMINI_MODEL'),
      contents,
      generationConfig: { temperature: opts.temperature ?? 0.1, maxOutputTokens: opts.maxTokens || 128 },
      timeout: timeoutSeconds * 1000,
    }, (timeoutSeconds + 5) * 1000);
    return { choices: [{ message: { content: response.text || '' } }] };
  } catch (error) {
    const status = error.status || Number((error.message.match(/\bHTTP\s+(\d{3})\b/i) || [])[1]) || 0;
    const keyCount = geminiKeyCount();
    if (status === 401 || status === 402) _geminiDisabled = true;
    if (status === 429 || status === 503) {
      const base = Number(cfg('GEMINI_KEY_COOLDOWN')) || Number(cfg('OPENROUTER_COOLDOWN')) || 180;
      _geminiCooldownUntil = Date.now() / 1000 + (keyCount > 1 ? Math.min(base, 30) : base);
    }
    const rotated = keyCount > 1 && error.allKeysLimited
      ? ' All ' + keyCount + ' Gemini keys are rate-limited or invalid; rotation resumes automatically.'
      : '';
    const fallback = status === 401 || status === 402
      ? ' Gemini disabled for this session; trying the next fallback.'
      : status === 429 || status === 503
        ? ' Gemini cooling down; trying the next fallback.'
        : '';
    console.warn('[Gemini] ' + error.message + fallback + rotated);
    _recordProviderFailure('Gemini', status, error.message);
    if (!opts.quiet && typeof logHUD === 'function') logHUD('warn', 'Gemini: ' + error.message + fallback + rotated);
    return null;
  }
}

async function postOllama(prompt, opts = {}) {
  const model = opts.model || cfg('OLLAMA_MODEL');
  const numPredict = opts.numPredict || 120;
  const temperature = Number(opts.temperature ?? 0.1) || 0.1;
  const timeoutMs = ollamaTimeoutMs(opts.timeout ? opts.timeout * 1000 : cfg('OLLAMA_TIMEOUT_MS'));
  const numCtx = parseInt(cfg('OLLAMA_NUM_CTX'), 10) || DEFAULTS.OLLAMA_NUM_CTX;
  const rawImages = opts.images || [];
  const images = rawImages.map((img) => (typeof img === 'string' ? img : img && img.base64)).filter(Boolean);
  const payload = {
    model,
    prompt,
    stream: false,
    keep_alive: cfg('OLLAMA_KEEP_ALIVE'),
    options: { temperature, num_ctx: numCtx, num_predict: numPredict },
  };
  if (images.length) payload.images = images;
  try {
    return await bgFetch('postOllama', { payload, timeout: timeoutMs }, timeoutMs + 5000);
  } catch (e) {
    console.warn('[Ollama] ' + e.message);
    _recordProviderFailure('Ollama', e.status, e.message);
    if (!opts.quiet && typeof logHUD === 'function') logHUD('warn', 'Ollama fallback: ' + e.message);
    return null;
  }
}

async function resolveCustomModel() {
  try {
    const response = await bgFetch('resolveCustomModel', {}, 15000);
    return response && typeof response.model === 'string' ? response.model : null;
  } catch (e) {
    console.warn('[CustomAPI] Failed to resolve model from /models:', e.message);
    return null;
  }
}

async function postCustomApi(messages, opts = {}) {
  if (customCooling()) return null;
  const customModel = opts.model || cfg('CUSTOM_MODEL') || 'auto';
  const maxTokens = opts.maxTokens || 64;
  const temperature = opts.temperature ?? 0.1;
  const timeoutSeconds = opts.timeout || 25;
  const baseUrl = cfg('CUSTOM_API_BASE_URL') || 'https://api.freellmapi.com/v1';
  const body = { model: customModel, messages, temperature, max_tokens: maxTokens };
  const isAutoModel = (customModel === 'auto' || !customModel);
  if (!opts.quiet && typeof logHUD === 'function') {
    logHUD('info', 'FreeLLMAPI: querying ' + baseUrl + ' (model: ' + (isAutoModel ? 'auto' : customModel) + ')...');
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await bgFetch('postCustomApi', { body, timeout: timeoutSeconds * 1000 }, (timeoutSeconds + 5) * 1000);
      if (response.error || [400, 401, 402, 429].includes(response.status)) {
        const status = response.status || 0;
        const errorText = response.error ? (typeof response.error === 'string' ? response.error : JSON.stringify(response.error)) : 'Custom API request failed';
        const error = new Error(errorText);
        error.status = status;
        error.body = response.body;
        throw error;
      }
      return response;
    } catch (error) {
      const status = error.status || Number((error.message.match(/\bHTTP\s+(\d{3})\b/i) || [])[1]) || 0;
      const reason = error.message || 'Unknown Custom API error';
      _recordProviderFailure('FreeLLMAPI', status, reason + (error.body ? ' | ' + error.body : ''));
      if (!opts.quiet && typeof logHUD === 'function') {
        logHUD('warn', 'FreeLLMAPI error: HTTP ' + status + ' - ' + reason + (error.body ? ' | ' + error.body : ''));
      }
      if (status === 401 || status === 402) {
        _customDisabled = true;
        console.warn('[CustomAPI] Key/credits error (' + reason + '); disabled for this session.');
        return null;
      }
      if (status === 429) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          continue;
        }
        customTriggerCooldown();
        return null;
      }
      if (status === 503) {
        customTriggerCooldown();
        return null;
      }
      if (isAutoModel && (status === 400 || status === 404)) {
        const resolved = await resolveCustomModel();
        if (resolved) {
          body.model = resolved;
          continue;
        }
      }
      return null;
    }
  }
  return null;
}

// ── Response parsing helpers ────────────────────────────────────────────────
function _excludedNote(list) {
  const arr = [...new Set((list || []).map((x) => String(x || '').trim()).filter(Boolean))];
  return arr.length ? 'Excluded wrong answers (DO NOT choose these): ' + arr.join(', ') : '';
}
function _optionNorm(text) {
  text = unscriptDigits(String(text || '')).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}
function _wrongOptionIndices(options, wrongAnswers) {
  const n = new Set((wrongAnswers || []).map((a) => _optionNorm(a)).filter(Boolean));
  if (!n.size) return new Set();
  const idx = [];
  for (let i = 0; i < options.length; i++) if (n.has(_optionNorm(options[i]))) idx.push(i);
  return new Set(idx);
}
function _readBool(raw) {
  const text = (raw || '').trim().toLowerCase();
  if (/\b(true|yes|correct)\b/.test(text)) return true;
  if (/\b(false|no|incorrect)\b/.test(text)) return false;
  return null;
}
function _boolIndex(options, wantTrue) {
  const wanted = wantTrue ? BOOL_TRUE : BOOL_FALSE;
  return options.findIndex((option) => wanted.has((option || '').trim().toLowerCase()));
}
function _isBoolQuestion(options) {
  return options.length === 2 && options.every((option) =>
    BOOL_TRUE.has(option.trim().toLowerCase()) || BOOL_FALSE.has(option.trim().toLowerCase())
  );
}
function _interpretAnswer(raw, options, excluded) {
  if (!raw) return -1;
  const t = raw.trim();
  const n = options.length;
  const e = new Set(excluded || []);
  const el = [];
  for (let i = 0; i < n; i++) if (!e.has(i)) el.push(i);
  const ue = el.length ? el : [...Array(n).keys()];
  const m = t.match(/\b(\d{1,2})\b/);
  if (m) {
    const i = parseInt(m[1], 10) - 1;
    if (i >= 0 && i < n && ue.includes(i)) return i;
  }
  let lm = t.match(/^\s*[\(\[\{]?\s*([A-Za-z])\s*[\)\]\.:\-]/);
  if (!lm) lm = t.match(/^\s*([A-Za-z])\s*$/);
  if (lm) {
    const i = lm[1].toUpperCase().charCodeAt(0) - 65;
    if (i >= 0 && i < n && ue.includes(i)) return i;
  }
  const lw = t.toLowerCase();
  let b = -1;
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (e.has(i)) continue;
    const o = options[i].toLowerCase().trim();
    if (!o) continue;
    if (o === lw) return i;
    let sc = similarity(lw, o);
    if (o.includes(lw) || lw.includes(o)) sc = Math.max(sc, 0.85);
    if (sc > s) { b = i; s = sc; }
  }
  return s >= 0.6 ? b : -1;
}
function _interpretFilteredAnswer(raw, options, originalIndices) {
  const index = _interpretAnswer(raw, options);
  if (index !== -1) return index;
  const match = (raw || '').match(/^\s*(?:option\s*)?(\d{1,2})\s*[.)]?\s*$/i);
  if (!match) return -1;
  const originalIndex = parseInt(match[1], 10) - 1;
  return originalIndices.indexOf(originalIndex);
}
function _interpretMulti(raw, options, excluded) {
  if (!raw) return [];
  const blocked = new Set(excluded || []);
  const picked = new Set();
  for (const match of raw.matchAll(/\b(\d{1,2})\b/g)) {
    const index = parseInt(match[1], 10) - 1;
    if (index >= 0 && index < options.length && !blocked.has(index)) picked.add(index);
  }
  if (!picked.size) {
    for (const match of raw.matchAll(/(?<![A-Za-z])([A-Za-z])(?![A-Za-z])/g)) {
      const index = match[1].toUpperCase().charCodeAt(0) - 65;
      if (index >= 0 && index < options.length && !blocked.has(index)) picked.add(index);
    }
  }
  if (!picked.size) {
    const text = raw.toLowerCase();
    for (let i = 0; i < options.length; i++) {
      if (!blocked.has(i) && options[i] && text.includes(options[i].toLowerCase())) picked.add(i);
    }
  }
  return [...picked].sort((a, b) => a - b);
}
function _domainNote(question) {
  const text = (question || '').toLowerCase();
  if (/\b(computer|network|software|database|program|technical|server|internet|protocol)\b/.test(text)) {
    return 'This is a technical/IT item — use precise technical terminology.';
  }
  if (/\b(history|society|culture|politic|economic|philosoph|psycholog|sociolog|humanit)\b/.test(text)) {
    return 'This is a social/humanities item — use the standard scholarly term.';
  }
  return 'Use the standard textbook term or phrase.';
}
function _cleanTyped(raw, blank) {
  let text = (raw || '').trim().replace(/^```[a-zA-Z]*\s*|\s*```$/g, '').trim().split('\n')[0] || '';
  text = text.replace(/^(answer|ans|correct answer)\s*[:-]\s*/i, '')
    .replace(/^[*\-\u2022]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim()
    .replace(/^["'`*]+|["'`*]+$/g, '')
    .replace(/\s+/g, ' ');
  if (blank) {
    text = text.replace(/\s\([^)]*\)\s*$/, '').trim();
    if (text.length > 40) text = text.replace(/\s*[-–—/]\s*.*$/, '').trim();
  }
  if (text.length > 160) text = text.split(/(?<=[.!?])\s/)[0] || text.slice(0, 160);
  text = text.replace(/[.]$/, '').trim();
  return /^(none|unknown|n\/a)$/i.test(text) ? '' : text;
}
function _echoesQuestion(answer, question) {
  const text = (answer || '').trim();
  if (!/^[A-Z]{2,6}$/.test(text)) return false;
  const initials = (question || '').match(/[A-Za-z]+/g) || [];
  return initials.map((word) => word[0].toUpperCase()).join('').includes(text);
}
function _searchQuery(question) {
  const text = (question || '')
    .replace(/[_-]{2,}/g, ' ')
    .replace(/\b(select one|select one or more|choose\.{0,3}|true or false|answer\s*\d+\s*[.)]?\s*question\s*\d+)\b/gi, ' ');
  const words = (text.match(/[A-Za-z0-9-]+/g) || []).filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  return words.slice(0, 14).join(' ').slice(0, 120) || text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

// ── Web search helpers ──────────────────────────────────────────────────────
async function ollamaWebSearch(query) {
  const clean = _searchQuery(query);
  if (!clean) return '';
  const key = normText(clean);
  const cached = await searchGet(key);
  if (cached) return cached;
  const result = await bgFetch('searchWeb', { query: clean, maxResults: cfg('WEB_SEARCH_MAX_RESULTS') });
  const text = result.text || '';
  if (text) await searchPut(key, text);
  return text;
}

function _snippetKey(question) {
  return 'snip:' + normText(question).slice(0, 180);
}

async function webSnippetLookup(question) {
  const term = (question || '').replace(/\s+/g, ' ').trim();
  if (term.length < 12) return '';
  const key = _snippetKey(term);
  try {
    const cached = await searchGet(key);
    if (cached) return cached;
  } catch (error) { /* cache miss is non-fatal */ }
  const maxChars = Number(cfg('WEB_Q_CHARS')) || 380;
  const query = term.slice(0, maxChars) + ' studocu OR amauoed OR quizlet';
  try {
    const result = await bgFetch('SEARCH_WEB_SNIPPETS', { query, maxResults: 3 }, 5000);
    const snippets = String((result && result.text) || '').trim().slice(0, 1500);
    if (snippets) {
      try { await searchPut(key, snippets); } catch (error) { /* optional */ }
    }
    return snippets;
  } catch (error) {
    console.warn('[providers] Web snippet lookup failed:', error.message);
    return '';
  }
}

// ── Local bank & answer-key lookups ─────────────────────────────────────────
function _normalizeBankHits(value, question) {
  if (value === null || value === undefined) return [];
  let rawHits = value;
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && Array.isArray(value[1])) {
    rawHits = value[1];
  } else if (!Array.isArray(value)) {
    rawHits = [value];
  }
  const hits = [];
  for (const rawHit of rawHits) {
    const hit = typeof rawHit === 'string' ? { answer: rawHit } : rawHit;
    if (!hit || typeof hit.answer !== 'string' || !hit.answer.trim()) continue;
    const normalized = {
      question: typeof hit.question === 'string' && hit.question.trim() ? hit.question : question,
      answer: hit.answer,
      course: hit.course || 'imported',
      verified: hit.verified === true,
    };
    if (hit.wrong === true) normalized.wrong = true;
    hits.push(normalized);
  }
  return hits;
}

function _hitIsWrong(answer, wrong) {
  const value = normText(answer);
  if (!value) return false;
  for (const item of wrong || []) if (value === item || similarity(value, item) >= 0.9) return true;
  return false;
}

function _rankBankHits(hits) {
  const verified = [];
  const rest = [];
  for (const hit of hits || []) (hit && hit.verified === true ? verified : rest).push(hit);
  return verified.concat(rest);
}

async function localBankAnswerHits(question) {
  const key = normText(question);
  if (!key) return null;
  const wrong = (await getWrongAnswers(question)).map((item) => normText(item)).filter(Boolean);
  const clean = (hits) => {
    const kept = (hits || []).filter((hit) =>
      hit && typeof hit.answer === 'string' && hit.answer.trim() &&
      hit.wrong !== true && (hit.verified === true || !_hitIsWrong(hit.answer, wrong))
    );
    return _rankBankHits(kept);
  };
  const direct = await answerKeyGet(key);
  const directHits = clean(_normalizeBankHits(direct, question));
  if (directHits.length) return directHits;

  let bestHits = null;
  if (typeof answerKeyFindFuzzy === 'function') {
    const fuzzy = await answerKeyFindFuzzy(question, 0.80, (storedKey, value) => {
      const hits = clean(_normalizeBankHits(value, storedKey));
      if (!hits.length) return false;
      bestHits = hits;
      return true;
    });
    if (fuzzy && bestHits) return bestHits;
  } else {
    const all = await answerKeyGetAll();
    let bestScore = 0;
    for (const [storedKey, value] of Object.entries(all)) {
      const score = similarity(key, normText(storedKey));
      if (score < 0.80 || score <= bestScore) continue;
      const hits = clean(_normalizeBankHits(value, storedKey));
      if (!hits.length) continue;
      bestHits = hits;
      bestScore = score;
    }
    if (bestHits) return bestHits;
  }
  return direct !== null ? [] : null;
}

async function localBankOptionMatches(question, options) {
  const hits = await localBankAnswerHits(question);
  if (!hits || !options || !options.length) return [];
  const matches = [];
  const used = new Set();
  for (const hit of hits) {
    const answer = normText(hit.answer);
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < options.length; i++) {
      if (used.has(i)) continue;
      const option = normText(options[i]);
      const score = answer && option ? similarity(answer, option) : 0;
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    if (bestIndex !== -1 && bestScore >= 0.75) {
      used.add(bestIndex);
      matches.push({ index: bestIndex, option: options[bestIndex], answer: hit.answer, verified: hit.verified === true, wrong: hit.wrong === true });
    }
  }
  return _rankBankHits(matches);
}

async function _keyHits(question, options) {
  const key = normText(question);
  if (!key) return [];
  const local = await localBankAnswerHits(question);
  if (local !== null) return local;
  if (key.length < 8 || FIG_HINTS.some((hint) => (question || '').toLowerCase().includes(hint))) return [];
  try {
    const result = await bgFetch(
      'getAnswerKey',
      { question: (question || '').slice(0, 300), options: options || [] },
      (cfg('ANSWER_KEY_TIMEOUT') || 4) * 1000 + 5000
    );
    const hits = result.hits || [];
    await answerKeyPut(key, hits);
    return hits;
  } catch (error) {
    console.warn('[providers] Answer-key lookup failed:', error.message);
    if (typeof logHUD === 'function') logHUD('warn', 'Answer-key lookup failed: ' + error.message);
    return [];
  }
}

function _answerOptionScore(answer, options) {
  const value = normText(answer);
  let score = 0;
  for (const option of options || []) {
    const candidate = normText(option);
    if (candidate && value === candidate) score = Math.max(score, 1);
    else if (candidate && (value.includes(candidate) || candidate.includes(value))) score = Math.max(score, 0.85);
  }
  return score;
}

function _bestKeyHit(question, hits, minScore, options) {
  const query = normText(question);
  let best = null;
  let bestQuestionScore = 0;
  let bestRank = -1;
  let bestVerified = false;
  for (const hit of hits || []) {
    const questionScore = similarity(query, normText(hit.question));
    const optionScore = Math.max(hit.optionScore || 0, _answerOptionScore(hit.answer, options));
    const qualifies = questionScore >= minScore || (options && optionScore >= 0.95 && questionScore >= minScore * 0.65);
    if (!qualifies) continue;
    const rank = questionScore + optionScore * 0.15;
    const verified = hit.verified === true;
    const better = verified === bestVerified ? rank > bestRank : verified;
    if (better) { best = hit; bestQuestionScore = questionScore; bestRank = rank; bestVerified = verified; }
  }
  return best && bestQuestionScore >= minScore
    ? best
    : best && options && _answerOptionScore(best.answer, options) >= 0.95 ? best : null;
}

function _pickKeyAnswer(answer, options) {
  const value = normText(answer);
  if (!value) return -1;
  if (BOOL_TRUE.has(value) || BOOL_FALSE.has(value)) {
    const index = _boolIndex(options, BOOL_TRUE.has(value));
    if (index !== -1) return index;
  }
  let best = -1;
  let score = 0;
  for (let i = 0; i < options.length; i++) {
    const candidate = similarity(value, normText(options[i]));
    if (candidate > score) { best = i; score = candidate; }
  }
  return score >= 0.6 ? best : -1;
}

async function keyIndex(question, options, minScore) {
  const hits = (await _keyHits(question, options)).filter((hit) => hit && hit.verified === true);
  const hit = _bestKeyHit(question, hits, minScore === undefined ? cfg('ANSWER_KEY_MIN_SCORE') : minScore, options);
  if (!hit) return -1;
  const answer = normText(hit.answer);
  const wrong = await getWrongAnswers(question);
  if (wrong.some((item) => answer === normText(item) || similarity(answer, normText(item)) >= 0.9)) return -1;
  return _pickKeyAnswer(hit.answer, options);
}

async function keyAnswer(question) {
  const hits = (await _keyHits(question)).filter((hit) => hit && hit.verified === true);
  const hit = _bestKeyHit(question, hits, cfg('ANSWER_KEY_TEXT_MIN_SCORE'));
  if (!hit) return '';
  const answer = _cleanTyped(hit.answer);
  const wrong = await getWrongAnswers(question);
  return wrong.some((item) => normText(item) === normText(answer) || similarity(normText(item), normText(answer)) >= 0.9) ? '' : answer;
}

async function keyMatchAnswer(question) {
  const hits = (await _keyHits(question)).filter((hit) => hit && hit.verified === true);
  const hit = _bestKeyHit(question, hits, cfg('ANSWER_KEY_MATCH_MIN_SCORE'));
  return hit ? _cleanTyped(hit.answer) : '';
}

async function hintText(question) {
  const hits = await _keyHits(question);
  if (!_bestKeyHit(question, hits, 0.35)) return '';
  const lines = hits.slice(0, 3).map((hit) => '- ' + (hit.question || '').slice(0, 200) + '\n  KEY: ' + (hit.answer || ''));
  return 'REFERENCE KEYS from amauoed.com (user-submitted, may be wrong — prefer them only if they fit the question):\n' + lines.join('\n');
}

// ── Single-choice, Boolean & Vision AI callers ──────────────────────────────
async function _askGeminiPrompt(prompt, opts = {}) {
  const response = await postGemini([{ role: 'user', content: prompt }], opts);
  return (response && response.choices?.[0]?.message?.content) || '';
}

function _imageToDataUrl(image) {
  if (!image) return '';
  if (typeof image === 'string') {
    return image.startsWith('data:') ? image : 'data:image/png;base64,' + image;
  }
  if (typeof image === 'object' && image.base64) {
    return `data:${image.mimeType || 'image/png'};base64,${image.base64}`;
  }
  return '';
}

async function askGemini(q, o, ex, oi) {
  if (!cfg('GEMINI_API_KEY')) return -1;
  const options = o.map((option, i) => `${i + 1}. ${option}`).join('\n');
  const prompt = 'You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: ' + q + '\n\nOptions:\n' + options + '\n\nReply with ONLY the number.';
  const raw = await _askGeminiPrompt(prompt, { maxTokens: 64, temperature: 0.2, timeout: 30 });
  return oi ? _interpretFilteredAnswer(raw, o, oi) : _interpretAnswer(raw, o, ex);
}

async function askGeminiVision(q, o, images) {
  if (!cfg('GEMINI_API_KEY') || !images.length) return -1;
  const content = [
    { type: 'text', text: _visionPrompt(q, o) },
    ...images.map(_imageToDataUrl).filter(Boolean).map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
  const response = await postGemini([{ role: 'user', content }], { maxTokens: 64, temperature: 0.1, timeout: 45 });
  const raw = response?.choices?.[0]?.message?.content || '';
  return _interpretAnswer(raw, o, _wrongOptionIndices(o, await getWrongAnswers(q)));
}

async function askGeminiMulti(q, o, excluded, note) {
  if (!cfg('GEMINI_API_KEY')) return [];
  const forbidden = (excluded || []).map((index) => o[index]).filter(Boolean);
  const raw = await _askGeminiPrompt(_multiPrompt(q, o, note, forbidden), { maxTokens: 64, temperature: 0.2, timeout: 30 });
  return _interpretMulti(raw, o, excluded);
}

async function askGeminiText(q, blank, forbidden, temperature, variant, note, force, courseContext) {
  if (!cfg('GEMINI_API_KEY')) return '';
  const raw = await _askGeminiPrompt(_textPrompt(q, forbidden, variant, note, force, courseContext), { maxTokens: 80, temperature: temperature ?? 0.1, timeout: 30, quiet: true });
  return _cleanTyped(raw, blank);
}

async function askBoolClaim(q, o, ex) {
  const prompt = 'Decide whether the statement below is TRUE or FALSE.\nJudge it on the standard definition.\n\nStatement: ' + q + '\n\nReply with ONLY TRUE or FALSE.';
  const excluded = new Set(ex || []);
  const pick = (raw) => {
    const verdict = _readBool(raw);
    if (verdict === null) return -1;
    const index = _boolIndex(o, verdict);
    return index !== -1 && (excluded.size >= o.length || !excluded.has(index)) ? index : -1;
  };
  if (cfg('CUSTOM_API_KEY') && !customCooling()) {
    const r = await postCustomApi([{ role: 'user', content: prompt }], { maxTokens: 32, temperature: 0.1, timeout: 25 });
    const m = r?.choices?.[0]?.message || {};
    const idx = pick((m.content || m.reasoning || '').trim());
    if (idx !== -1) return idx;
  }
  if (cfg('GEMINI_API_KEY')) {
    const idx = pick(await _askGeminiPrompt(prompt, { maxTokens: 32, temperature: 0.1, timeout: 30 }));
    if (idx !== -1) return idx;
  }
  if (cfg('OPENROUTER_API_KEY') && !orCooling()) {
    const r = await postOpenRouter([{ role: 'user', content: prompt }], { maxTokens: 64, temperature: 0.1, timeout: 25 });
    const m = r?.choices?.[0]?.message || {};
    const idx = pick((m.content || m.reasoning || '').trim());
    if (idx !== -1) return idx;
  }
  try {
    const r = await postOllama(prompt, { numPredict: 16, temperature: 0.1, timeout: 30 });
    const idx = pick(r && r.response ? r.response.trim() : '');
    if (idx !== -1) return idx;
  } catch (e) { /* ollama offline */ }
  return -1;
}

async function askOpenRouter(q, o, ex, oi) {
  if (!cfg('OPENROUTER_API_KEY') || orCooling()) return -1;
  const ot = o.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const p = 'You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: ' + q + '\n\nOptions:\n' + ot + '\n\nReply with ONLY the number.';
  try {
    const r = await postOpenRouter([{ role: 'user', content: p }], { maxTokens: 64, temperature: 0.3, timeout: 25 });
    if (!r) return -1;
    const m = r.choices?.[0]?.message || {};
    const t = ((m.content || m.reasoning || '')).trim();
    return oi ? _interpretFilteredAnswer(t, o, oi) : _interpretAnswer(t, o, ex);
  } catch (e) {
    return -1;
  }
}

async function askOpenRouterWeb(q, o, oi) {
  if (!cfg('OPENROUTER_WEB_ENABLED') || !cfg('OPENROUTER_API_KEY') || _orWebDisabled || orCooling()) return -1;
  const webChars = Number(cfg('WEB_Q_CHARS')) || 380;
  const options = o.map((option, index) => `${index + 1}. ${option}`).join('\n');
  const prompt = 'Use web search results to answer this exam question.\n\nQuestion: ' + q.slice(0, webChars) + '\n\nOptions:\n' + options + '\n\nReply with ONLY the option number.';
  const response = await postOpenRouter([{ role: 'user', content: prompt }], {
    plugins: [{ id: 'web', engine: 'exa', max_results: cfg('WEB_SEARCH_MAX_RESULTS'), search_prompt: 'Exact question and answer.' }],
    maxTokens: 100,
    temperature: 0.1,
    timeout: 45,
  });
  if (!response) return -1;
  const message = response.choices?.[0]?.message || {};
  const first = ((message.content || message.reasoning || '').trim().split('\n')[0] || '');
  return oi ? _interpretFilteredAnswer(first, o, oi) : _interpretAnswer(first, o);
}

async function askOllama(q, o, ex, oi) {
  const ot = o.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const p = 'You are an expert tutor answering an exam question accurately.\n\nQuestion: ' + q + '\n\nOptions:\n' + ot + '\n\nReply with ONLY the number.';
  try {
    const r = await postOllama(p, { numPredict: 32, temperature: 0.1, timeout: 60 });
    if (r && r.response) {
      const t = r.response.trim();
      return oi ? _interpretFilteredAnswer(t, o, oi) : _interpretAnswer(t, o, ex);
    }
    return -1;
  } catch (e) {
    return -1;
  }
}

async function askCustomApi(q, o, ex, oi) {
  if (!cfg('CUSTOM_API_KEY') || customCooling()) return -1;
  const ot = o.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const p = 'You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: ' + q + '\n\nOptions:\n' + ot + '\n\nReply with ONLY the number.';
  try {
    const r = await postCustomApi([{ role: 'user', content: p }], { maxTokens: 64, temperature: 0.1, timeout: 25 });
    if (!r) return -1;
    const m = r.choices?.[0]?.message || {};
    const t = ((m.content || m.reasoning || '')).trim();
    return oi ? _interpretFilteredAnswer(t, o, oi) : _interpretAnswer(t, o, ex);
  } catch (e) {
    return -1;
  }
}

function _visionPrompt(q, o) {
  const ot = o.map((x, i) => `${i + 1}. ${x}`).join('\n');
  return 'You are an expert tutor. The question refers to image(s).\n\nQuestion: ' + q + '\n\nOptions:\n' + ot + '\n\nReply with ONLY the number.';
}

async function askOpenRouterVision(q, o, im) {
  if (!(cfg('OPENROUTER_API_KEY') && im.length) || orCooling()) return -1;
  const m = String(cfg('OPENROUTER_VISION_MODEL') || '').trim() || cfg('OPENROUTER_MODEL');
  const c = [
    { type: 'text', text: _visionPrompt(q, o) },
    ...im.map(_imageToDataUrl).filter(Boolean).map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
  try {
    const r = await postOpenRouter([{ role: 'user', content: c }], { model: m, maxTokens: 64, temperature: 0.1, timeout: 45 });
    if (!r) return -1;
    const msg = r.choices?.[0]?.message || {};
    const raw = ((msg.content || msg.reasoning || '')).trim();
    const w = await getWrongAnswers(q);
    return _interpretAnswer(raw, o, _wrongOptionIndices(o, w));
  } catch (e) {
    return -1;
  }
}

async function askOllamaVision(q, o, im) {
  if (!im.length) return -1;
  try {
    const r = await postOllama(_visionPrompt(q, o), {
      model: cfg('OLLAMA_VISION_MODEL') || cfg('OLLAMA_MODEL'),
      numPredict: 40,
      temperature: 0.1,
      images: im,
      timeout: 45,
    });
    if (r && r.response) {
      const w = await getWrongAnswers(q);
      return _interpretAnswer(r.response.trim(), o, _wrongOptionIndices(o, w));
    }
    return -1;
  } catch (e) {
    return -1;
  }
}

async function askVision(q, o, im) {
  if (!(cfg('VISION_ENABLED') && im && im.length)) return -1;
  if (typeof logHUD === 'function') logHUD('info', `Vision lookup (${im.length} image${im.length === 1 ? '' : 's'})...`);
  if (cfg('GEMINI_API_KEY')) {
    const i = await askGeminiVision(q, o, im);
    if (i !== -1) return i;
  }
  if (cfg('OPENROUTER_API_KEY') && !orCooling()) {
    const i = await askOpenRouterVision(q, o, im);
    if (i !== -1) return i;
  }
  const i = await askOllamaVision(q, o, im);
  if (i !== -1) return i;
  return -1;
}

// ── Multi-answer ────────────────────────────────────────────────────────────
function _multiPrompt(q, o, n, f) {
  const ot = o.map((x, i) => (i + 1) + '. ' + x).join('\n');
  let p = '';
  if (f && f.length) p += 'Do NOT pick these, already wrong: ' + [...f].sort().join(', ') + '\n\n';
  if (n) p += n + '\n\n';
  return p + 'You are an expert tutor answering a multiple-answer question. MORE THAN ONE is correct.\n\nQuestion: ' + q + '\n\nOptions:\n' + ot + '\n\nReply with ONLY numbers separated by commas.';
}

function _parsePartialMultiSelectCombo(value) {
  const raw = String(value || '').trim();
  if (/\s*\|\|\s*/.test(raw)) return raw.split(/\s*\|\|\s*/).map(normText).filter(Boolean).sort();
  const marker = normText(value);
  const prefix = 'multiselect partial combo ';
  if (!marker.startsWith(prefix)) return null;
  let rest = marker.slice(prefix.length);
  const choices = [];
  while (rest) {
    const lengthMatch = rest.match(/^(\d+)\s/);
    if (!lengthMatch) return null;
    const length = Number(lengthMatch[1]);
    const start = lengthMatch[0].length;
    if (!Number.isSafeInteger(length) || length < 1 || start + length > rest.length) return null;
    choices.push(rest.slice(start, start + length));
    rest = rest.slice(start + length).trim();
  }
  return choices.sort();
}

function _parseMultiSelectResponse(raw, options, wrongOptions, partialCombos) {
  const text = String(raw || '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch (error) { return []; }
  if (!Array.isArray(parsed)) return [];
  const wrong = (wrongOptions || []).map((value) => normText(value)).filter(Boolean);
  const indexes = [];
  for (const value of parsed) {
    if (typeof value !== 'string') continue;
    const answer = normText(value);
    if (!answer || wrong.some((item) => item === answer || similarity(item, answer) >= 0.9)) continue;
    const index = options.findIndex((option) => normText(option) === answer);
    if (index !== -1 && !indexes.includes(index)) indexes.push(index);
  }
  const selection = indexes.map((index) => normText(options[index])).sort();
  if ((partialCombos || []).some((combo) => combo.length === selection.length && combo.every((choice, index) => choice === selection[index]))) {
    return [];
  }
  const cap = Number(cfg('MULTI_MAX_PICKS')) || 0;
  return cap > 0 && indexes.length > cap ? indexes.slice(0, cap) : indexes;
}

async function askAiMultiSelect(question, options, wrongList) {
  const wrong = Array.isArray(wrongList) ? wrongList : await answerKeyGetWrong(question);
  const partial = wrong.map(_parsePartialMultiSelectCombo).filter(Boolean);
  const wrongOptions = wrong.filter((value) => !normText(value).startsWith('multiselect partial '));
  const prompt = "This is a multiple-answer checkbox question ('Select one or more'). Carefully evaluate EVERY option and return ONLY a JSON array containing ALL correct option strings verbatim (typically 2 to 4 options).\n\nQuestion: " + question + "\n\nOptions:\n" + options.map((option) => '- ' + option).join('\n');
  const context = [];
  if (wrong.length) {
    const formatted = wrong.map((value) => {
      const combo = _parsePartialMultiSelectCombo(value);
      return combo ? combo.join(' || ') : value;
    });
    context.push('Do NOT return these previously failed/partial combinations: ' + formatted.join('; ') + '.');
  }
  if (partial.length) context.push('Previously recorded partial selections (do not repeat an exact combination): ' + partial.map((combo) => '[' + combo.join(', ') + ']').join('; ') + '.');
  if (wrongOptions.length) context.push('Options already confirmed wrong: ' + wrongOptions.join(', ') + '.');
  const requestPrompt = context.length ? prompt + '\n\n' + context.join('\n') : prompt;
  const parse = (raw) => _parseMultiSelectResponse(raw, options, wrongOptions, partial);

  if (cfg('CUSTOM_API_KEY') && !customCooling()) {
    try {
      const response = await postCustomApi([{ role: 'user', content: requestPrompt }], { maxTokens: 220, temperature: 0.1, timeout: 30 });
      const raw = response?.choices?.[0]?.message ? (response.choices[0].message.content || response.choices[0].message.reasoning || '') : '';
      const picks = parse(raw);
      if (picks.length) return picks;
    } catch (error) { _recordProviderFailure('FreeLLMAPI', error.status, error.message); }
  }
  if (cfg('GEMINI_API_KEY')) {
    try {
      const picks = parse(await _askGeminiPrompt(requestPrompt, { maxTokens: 220, temperature: 0.1, timeout: 30 }));
      if (picks.length) return picks;
    } catch (error) { _recordProviderFailure('Gemini', error.status, error.message); }
  }
  if (cfg('OPENROUTER_API_KEY') && !orCooling()) {
    try {
      const response = await postOpenRouter([{ role: 'user', content: requestPrompt }], { maxTokens: 220, temperature: 0.1, timeout: 30 });
      const message = response?.choices?.[0]?.message || {};
      const picks = parse(message.content || message.reasoning || '');
      if (picks.length) return picks;
    } catch (error) { _recordProviderFailure('OpenRouter', error.status, error.message); }
  }
  try {
    const response = await postOllama(requestPrompt, { numPredict: 220, temperature: 0.1, timeout: 45 });
    const picks = parse((response && response.response) || '');
    if (picks.length) return picks;
  } catch (error) { _recordProviderFailure('Ollama', error.status, error.message); }
  return [];
}

async function askOpenRouterMulti(q, o, ex, n) {
  if (!cfg('OPENROUTER_API_KEY') || orCooling()) return [];
  const f = (ex || []).map((i) => o[i]).filter(Boolean);
  try {
    const r = await postOpenRouter([{ role: 'user', content: _multiPrompt(q, o, n, f) }], { maxTokens: 64, temperature: 0.2, timeout: 25 });
    if (!r) return [];
    const m = r.choices?.[0]?.message || {};
    const ra = ((m.content || m.reasoning || '')).trim();
    let p = _interpretMulti(ra, o, ex);
    if (!p.length) p = _interpretMulti(ra, o);
    return p;
  } catch (e) { return []; }
}

async function askOpenRouterWebMulti(q, o, ex) {
  if (!cfg('OPENROUTER_WEB_ENABLED') || !cfg('OPENROUTER_API_KEY') || _orWebDisabled || orCooling()) return [];
  const excluded = (ex || []).map((index) => o[index]).filter(Boolean);
  const prompt = _multiPrompt(q, o, 'Use web search results to select the correct options.', excluded);
  const response = await postOpenRouter([{ role: 'user', content: prompt }], {
    plugins: [{ id: 'web', engine: 'exa', max_results: cfg('WEB_SEARCH_MAX_RESULTS'), search_prompt: 'Exact question and answers.' }],
    maxTokens: 100,
    temperature: 0.1,
    timeout: 45,
  });
  if (!response) return [];
  const message = response.choices?.[0]?.message || {};
  const first = ((message.content || message.reasoning || '').trim().split('\n')[0] || '');
  return _interpretMulti(first, o, ex);
}

async function askOllamaMulti(q, o, ex, n) {
  const f = (ex || []).map((i) => o[i]).filter(Boolean);
  try {
    const r = await postOllama(_multiPrompt(q, o, n, f), { numPredict: 48, temperature: 0.1, timeout: 45 });
    if (r && r.response) {
      const ra = r.response.trim();
      let p = _interpretMulti(ra, o, ex);
      if (!p.length) p = _interpretMulti(ra, o);
      return p;
    }
    return [];
  } catch (e) { return []; }
}

async function askCustomApiMulti(q, o, ex, n) {
  if (!cfg('CUSTOM_API_KEY') || customCooling()) return [];
  const f = (ex || []).map((i) => o[i]).filter(Boolean);
  try {
    const r = await postCustomApi([{ role: 'user', content: _multiPrompt(q, o, n, f) }], { maxTokens: 64, temperature: 0.2, timeout: 25 });
    if (!r) return [];
    const m = r.choices?.[0]?.message || {};
    const ra = ((m.content || m.reasoning || '')).trim();
    let p = _interpretMulti(ra, o, ex);
    if (!p.length) p = _interpretMulti(ra, o);
    return p;
  } catch (e) { return []; }
}

async function askWebMulti(q, o, ex) {
  if (!cfg('WEB_SEARCH_ENABLED')) return [];
  try {
    const searchResults = await ollamaWebSearch(_searchQuery(q));
    if (!searchResults) return [];
    const text = ' ' + _optionNorm(searchResults) + ' ';
    return o.map((option, index) => ({ option, index })).filter(({ option }) => {
      const normalized = _optionNorm(option);
      return normalized.length >= 3 && text.includes(' ' + normalized + ' ');
    }).map(({ index }) => index).filter((index) => !(ex || []).includes(index));
  } catch (error) {
    console.warn('[providers] Non-AI multi-answer search failed:', error.message);
    return [];
  }
}

async function askAiMulti(q, o, im) {
  im = im || [];
  const w = await getWrongAnswers(q);
  const b = new Set(w.map((x) => normText(x)));
  const isWrong = (option) => {
    const on = normText(option);
    if (!on) return false;
    if (b.has(on)) return true;
    for (const x of b) if (similarity(on, x) >= 0.9) return true;
    return false;
  };
  const capPicks = (arr) => {
    const cap = Number(cfg('MULTI_MAX_PICKS')) || 0;
    return cap > 0 && arr.length > cap ? arr.slice(0, cap) : arr;
  };

  const local = await localBankOptionMatches(q, o);
  const localOk = local.filter((match) => match.verified === true && !isWrong(o[match.index]));
  if (localOk.length) return capPicks(localOk.map((match) => match.index));

  const vp = [];
  for (let i = 0; i < o.length; i++) {
    const on = normText(o[i]);
    if (!(b.has(on) || [...b].some((x) => similarity(on, x) >= 0.9))) vp.push(i);
  }
  if (!vp.length) for (let i = 0; i < o.length; i++) vp.push(i);
  const fo = vp.map((i) => o[i]);

  const kp = [];
  if (cfg('ANSWER_KEY_ENABLED')) {
    const ki = await keyIndex(q, fo, 0.72);
    if (ki !== -1) kp.push(ki);
    const e = await keyAnswer(q);
    if (e) {
      for (const i of _interpretMulti(e, fo)) if (!kp.includes(i)) kp.push(i);
    }
  }
  if (cfg('WEB_SEARCH_ENABLED')) {
    const wp = await askWebMulti(q, fo);
    if (wp.length) return capPicks(wp.map((p) => vp[p]).filter((p) => p < vp.length));
  }
  let nt = '';
  if (kp.length) nt = 'Key suggests ' + kp.map((p) => String(p + 1)).join(', ') + '.';
  const exNote = _excludedNote(w);
  if (exNote) nt = (nt ? nt + ' ' : '') + exNote;

  const mapBack = (picks) => capPicks(picks.map((p) => vp[p]).filter((p) => p !== undefined));
  if (cfg('CUSTOM_API_KEY') && !customCooling()) {
    const picks = await askCustomApiMulti(q, fo, null, nt);
    if (picks.length) return mapBack(picks);
  }
  if (cfg('GEMINI_API_KEY')) {
    const picks = await askGeminiMulti(q, fo, null, nt);
    if (picks.length) return mapBack(picks);
  }
  if (cfg('OPENROUTER_WEB_ENABLED') && cfg('OPENROUTER_API_KEY') && !_orWebDisabled && !orCooling()) {
    const webPicks = await askOpenRouterWebMulti(q, fo);
    if (webPicks.length) return mapBack(webPicks);
  }
  if (cfg('OPENROUTER_API_KEY') && !orCooling()) {
    const pk = await askOpenRouterMulti(q, fo, null, nt);
    if (pk.length) return mapBack(pk);
  }
  try {
    const pk = await askOllamaMulti(q, fo, null, nt);
    if (pk.length) return mapBack(pk);
  } catch (e) { /* offline */ }
  if (kp.length) return mapBack(kp);
  return [];
}

async function askWeb(q, o, oi) {
  if (!cfg('WEB_SEARCH_ENABLED')) return -1;
  try {
    const webChars = Number(cfg('WEB_Q_CHARS')) || 380;
    const searchResults = await ollamaWebSearch(_searchQuery((q || '').slice(0, webChars)));
    if (!searchResults) return -1;
    const text = ' ' + _optionNorm(searchResults) + ' ';
    const matches = o.map((option, index) => ({ option, index })).filter(({ option }) => {
      const normalized = _optionNorm(option);
      return normalized.length >= 3 && text.includes(' ' + normalized + ' ');
    });
    if (matches.length !== 1) return -1;
    return matches[0].index;
  } catch (error) {
    console.warn('[providers] Non-AI web search failed:', error.message);
    return -1;
  }
}

// ── Short-answer text ───────────────────────────────────────────────────────
function _textPrompt(q, f, v, n, force, courseContext) {
  const hasBlank = BLANK_RE.test(q);
  const asksAcronym = /\b(?:abbreviation|acronym)\b/i.test(q || '');
  let prompt = '';
  const exNote = _excludedNote(f);
  if (exNote) prompt += exNote + ' ';
  if (f && f.length) {
    const wrong = [...new Set(f)].sort().join(', ');
    prompt += 'Do NOT output any of these previously marked WRONG answers: ' + wrong + '.\n\n';
    prompt += 'CRITICAL: Do NOT answer with: ' + wrong + '.\n\n';
  }
  if (v) prompt += RETRY_VARIANTS[Math.min(v, RETRY_VARIANTS.length - 1)] + '\n\n';
  if (n) prompt = n + '\n\n' + prompt;
  const blankRules = hasBlank
    ? '\nTHE QUESTION HAS A ______ BLANK.\nReturn ONLY the exact concise missing module term (1-3 words). Do not write a full sentence, quotation marks, labels, explanations, or thinking preambles.\n'
    : '\nReturn ONLY the exact concise module term (1-3 words). Never write sentences, labels, explanations, or thinking preambles.\n';
  const acronymRule = asksAcronym
    ? '\nThe question asks for an abbreviation or acronym: output ONLY the uppercase acronym (for example CPU, IDS, or OSI).\n'
    : '';
  const termRule = '\nDo not append filler words such as "Attack" or "Data" unless they are specifically part of the exact term. Examples: "Buffer Overflow", "Phishing", "Integrity", "Software".\n';
  const unknownRule = force ? '- NONE is not allowed.\n' : '- If unknown, reply NONE\n';
  const contextLine = courseContext ? '\nCourse/Subject: ' + courseContext + '\n' : '';
  return prompt + 'You are an expert tutor.\n' + _domainNote(q) + contextLine + '\n' + unknownRule + blankRules + acronymRule + termRule + 'Question: ' + q + '\n\nReply with ONLY the exact answer.';
}

function _conciseTextAnswer(answer, question) {
  const value = String(answer || '').trim();
  if (!value) return '';
  if (/\b(?:abbreviation|acronym)\b/i.test(question || '')) {
    return /^[A-Za-z0-9][A-Za-z0-9./+-]*$/.test(value) ? value.toUpperCase() : '';
  }
  return value.split(/\s+/).length <= 3 ? value : '';
}

async function askOpenRouterText(q, bl, f, t, v, n, force, courseContext) {
  if (!cfg('OPENROUTER_API_KEY') || orCooling()) return '';
  try {
    const r = await postOpenRouter([{ role: 'user', content: _textPrompt(q, f, v, n, force, courseContext) }], { maxTokens: 80, temperature: t ?? 0.1, timeout: 25, quiet: true });
    if (!r) return '';
    const m = r.choices?.[0]?.message || {};
    return _cleanTyped((m.content || m.reasoning || '').trim(), bl);
  } catch (e) {
    _recordProviderFailure('OpenRouter', e.status, e.message);
    return '';
  }
}

async function askOllamaText(q, bl, f, t, v, n, force, courseContext) {
  try {
    const r = await postOllama(_textPrompt(q, f, v, n, force, courseContext), { numPredict: 60, temperature: t ?? 0.1, timeout: 35, quiet: true });
    if (r && r.response) return _cleanTyped(r.response.trim(), bl);
    return '';
  } catch (e) {
    _recordProviderFailure('Ollama', e.status, e.message);
    return '';
  }
}

async function askCustomApiText(q, bl, f, t, v, n, force, courseContext) {
  if (!cfg('CUSTOM_API_KEY') || customCooling()) return '';
  try {
    const r = await postCustomApi([{ role: 'user', content: _textPrompt(q, f, v, n, force, courseContext) }], { maxTokens: 80, temperature: t ?? 0.1, timeout: 25, quiet: true });
    if (!r) return '';
    const m = r.choices?.[0]?.message || {};
    return _cleanTyped((m.content || m.reasoning || '').trim(), bl);
  } catch (e) {
    _recordProviderFailure('FreeLLMAPI', e.status, e.message);
    return '';
  }
}

async function askWebText(q) {
  if (!cfg('WEB_SEARCH_ENABLED')) return '';
  try {
    const question = (q || '').includes('\n\n') ? (q || '').split('\n\n').pop() : q;
    return await ollamaWebSearch(_searchQuery(question));
  } catch (error) {
    console.warn('[providers] Non-AI text search failed:', error.message);
    return '';
  }
}

async function askAiText(q, wrongList) {
  const bl = BLANK_RE.test(q);
  const w = Array.isArray(wrongList) ? wrongList : await answerKeyGetWrong(q);
  const b = new Set(w.map((x) => normText(x)));
  const local = await localBankAnswerHits(q);
  if (local && local.length) {
    const ok = local.find((hit) => hit.verified === true && !b.has(normText(hit.answer)));
    if (ok) return _cleanTyped(ok.answer, bl);
  }
  const chq = (q || '').replace(/[_\-]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  const snippetLookup = webSnippetLookup(chq);
  if (cfg('ANSWER_KEY_ENABLED')) {
    const ka = await keyAnswer(chq);
    if (ka && !b.has(normText(ka))) return ka;
  }
  if (cfg('WEB_SEARCH_ENABLED')) {
    const results = await askWebText(q);
    if (results) q += '\n\nNon-AI web search snippets (reference only):\n' + results.slice(0, 2000);
  }
  const snippets = await snippetLookup;
  if (snippets) {
    q += '\n\nReference search snippets:\n' + snippets + '\n\nBased on the question and reference snippets above, reply ONLY with the exact concise module term (1-3 words), with no explanation.';
  }
  if (cfg('ANSWER_KEY_ENABLED')) {
    const h = await hintText(chq);
    if (h) q += '\n\n' + h;
  }

  const courseContext = getCourseContext();
  let lg = '';
  let nt = '';
  const tp = async (name, fn) => {
    const ep = [...b].some((x) => _echoesQuestion(x, q)) ? 1 : 0;
    for (let r = 0; r < cfg('MAX_TEXT_RETRIES'); r++) {
      const v = Math.min(ep + r, RETRY_VARIANTS.length - 1);
      const temps = [0.1, 0.5, 0.75, 0.95];
      let a = await fn(q, bl, b.size ? [...b] : null, temps[r % 4], v, nt, false, courseContext);
      if (!a) continue;
      a = _conciseTextAnswer(a, q);
      if (!a) {
        if (typeof logHUD === 'function') logHUD('warn', name + ': rejected answer outside the concise 1-3 word format');
        continue;
      }
      if (isConversationalFiller(a) || a.length > 60) {
        if (typeof logHUD === 'function') logHUD('warn', name + ': rejected conversational/long answer (' + a.length + ' chars): ' + a.slice(0, 80));
        continue;
      }
      lg = a;
      if (b.has(normText(a))) { nt = 'Do NOT answer: ' + [...b].sort().join(', ') + '.'; continue; }
      if (_echoesQuestion(a, q) && r < cfg('MAX_TEXT_RETRIES') - 1) { nt = 'The answer echoes the question.'; b.add(normText(a)); continue; }
      return a;
    }
    return '';
  };

  const tlog = (level, message) => { if (typeof logHUD === 'function') logHUD(level, message); };
  const skipNote = (name) => {
    if (name === 'FreeLLMAPI') return _skipReason(_customDisabled, _customCooldownUntil);
    if (name === 'Gemini') return _skipReason(_geminiDisabled, _geminiCooldownUntil);
    if (name === 'OpenRouter') return _skipReason(_orDisabled, _orCooldownUntil);
    return '';
  };
  const askTextProvider = async (name, keyName, fn) => {
    if (keyName && !String(cfg(keyName) || '').trim()) { tlog('warn', name + ' skipped: ' + keyName + ' not set'); return ''; }
    const cooling = skipNote(name);
    if (cooling) { tlog('warn', name + ' skipped: ' + cooling); return ''; }
    tlog('info', 'AI text lookup via ' + name + '...');
    const startedAt = Date.now();
    let answer = '';
    try {
      answer = await tp(name, fn);
    } catch (error) {
      const status = Number(error && (error.status || (String(error.message || '').match(/\bHTTP\s+(\d{3})\b/i) || [])[1])) || 0;
      _recordProviderFailure(name, status, (error && error.message) || String(error));
    }
    if (answer) return answer;
    tlog('warn', name + ' failed: ' + (_providerFailure(name, startedAt) || 'no usable answer returned'));
    return '';
  };

  let answer = await askTextProvider('FreeLLMAPI', 'CUSTOM_API_KEY', askCustomApiText);
  if (answer) return answer;
  answer = await askTextProvider('Gemini', 'GEMINI_API_KEY', askGeminiText);
  if (answer) return answer;
  answer = await askTextProvider('OpenRouter', 'OPENROUTER_API_KEY', askOpenRouterText);
  if (answer) return answer;
  answer = await askTextProvider('Ollama', '', askOllamaText);
  if (answer) return answer;
  try {
    const f = _conciseTextAnswer(await askOllamaText(q, bl, b.size ? [...b] : null, 0.3, RETRY_VARIANTS.length - 1, nt, true, courseContext), q);
    if (f && !b.has(normText(f)) && !isConversationalFiller(f) && f.length <= 60) return f;
  } catch (e) { /* offline */ }
  if (cfg('TYPE_ON_FAILURE') && lg && !b.has(normText(lg)) && !isConversationalFiller(lg) && lg.length <= 60) return lg;
  return '';
}

function getCourseContext() {
  if (typeof document === 'undefined') return '';
  const breadcrumb = document.querySelector('.breadcrumb a[href*="/course/view.php"]');
  const heading = document.querySelector('.page-header-headings h1, h1');
  const parts = [];
  if (breadcrumb && breadcrumb.textContent) parts.push(breadcrumb.textContent.trim());
  if (heading && heading.textContent) parts.push(heading.textContent.trim());
  if (document.title) parts.push(document.title.trim());
  return parts.filter(Boolean).join(' > ').slice(0, 120);
}

function isConversationalFiller(text) {
  const t = (text || '').toLowerCase();
  const phrases = [
    "user's request", 'cannot', 'sorry', 'as an ai', 'i cannot', "i'm unable", 'i am unable',
    "i'm not able", 'i am not able', 'we need', 'please provide', 'let me know', 'happy to help',
    'how can i', 'here is', "here's the", 'the answer is', 'answer:', 'response:', 'explanation:',
  ];
  return phrases.some((p) => t.includes(p));
}

// ── Matching questions (legacy + batch) ─────────────────────────────────────
const _LINE_RE = /^\s*(\d{1,2})\s*[.)-:]?\s*(.+)$/;
const _PROSE_LETTER_RE = /(?<![.\d])(\d{1,2})\s*[.)-:]\s*([A-Z])(?![A-Za-z])/g;

function _parseMapping(raw, options, n, skip, used) {
  used = new Set(used || []);
  const skipped = new Set(skip || []);
  const idxs = new Array(n).fill(-1);
  let matched = 0;
  const letters = {};
  for (let i = 0; i < options.length; i++) letters[String.fromCharCode(65 + i)] = i;
  const take = (i, j) => {
    if (j === -1 || used.has(j) || idxs[i] !== -1) return false;
    idxs[i] = j;
    used.add(j);
    matched++;
    return true;
  };
  for (const rawLine of (raw || '').split('\n')) {
    const line = rawLine.trim().replace(/[*_]/g, '').trim();
    if (!line) continue;
    const match = line.match(_LINE_RE);
    if (!match) continue;
    const i = parseInt(match[1], 10) - 1;
    if (i < 0 || i >= n || idxs[i] !== -1 || skipped.has(i)) continue;
    const rest = match[2].trim().replace(/[*' ]/g, '').trim();
    if (!rest || /^NONE/i.test(rest)) continue;
    let j = -1;
    const token = rest.replace(/[ .)\-:]/g, '').trim();
    if (token.length === 1 && token.toUpperCase() in letters && !used.has(letters[token.toUpperCase()])) {
      j = letters[token.toUpperCase()];
    }
    if (j === -1) {
      let best = -1;
      let score = 0;
      for (let k = 0; k < options.length; k++) {
        if (used.has(k)) continue;
        const candidate = similarity(rest.toLowerCase(), options[k].toLowerCase());
        if (candidate > score) { best = k; score = candidate; }
      }
      if (best !== -1 && score >= 0.45) j = best;
    }
    take(i, j);
  }
  if (matched === 0) {
    let match;
    _PROSE_LETTER_RE.lastIndex = 0;
    while ((match = _PROSE_LETTER_RE.exec(raw || '')) !== null) {
      const i = parseInt(match[1], 10) - 1;
      if (i < 0 || i >= n || skipped.has(i) || idxs[i] !== -1) continue;
      const candidate = letters[match[2]];
      if (candidate !== undefined) take(i, candidate);
    }
  }
  if (matched === 0) {
    const bare = (raw || '').split('\n').map((line) => line.trim().replace(/[*`']/g, '').trim()).filter(Boolean);
    if (bare.length === n) {
      for (let i = 0; i < n; i++) {
        if (skipped.has(i)) continue;
        let best = -1;
        let score = 0;
        for (let k = 0; k < options.length; k++) {
          if (used.has(k)) continue;
          const candidate = similarity(bare[i].toLowerCase(), options[k].toLowerCase());
          if (candidate > score) { best = k; score = candidate; }
        }
        if (best !== -1 && score >= 0.5) take(i, best);
      }
    }
  }
  return { idxs, matched };
}

function _matchingOk(matched, remaining) {
  if (remaining <= 0) return true;
  return matched >= Math.max(1, Math.round(remaining * cfg('MATCHING_MIN_MATCHED')));
}

function _bestOptionIndex(text, options, used) {
  let best = -1;
  let score = 0;
  const t = (text || '').toLowerCase().trim();
  if (!t) return -1;
  for (let k = 0; k < options.length; k++) {
    if (used.has(k)) continue;
    const o = options[k].toLowerCase();
    let s = similarity(t, o);
    if (t === o) s = 1;
    else if (t.includes(o) || o.includes(t)) s = Math.max(s, 0.9);
    if (s > score) { best = k; score = s; }
  }
  return score >= cfg('MATCHING_OPTION_FLOOR') ? best : -1;
}

function _matchingPrompt(header, statements, options, n, locked) {
  const letters = options.map((_, i) => String.fromCharCode(65 + i));
  const items = letters.map((l, i) => l + '. ' + options[i]).join('\n');
  const numbered = statements.map((s, i) => (i + 1) + '. ' + (s || '[blank]')).join('\n');
  let fixed = '';
  if (locked && locked.length) {
    fixed = '\nALREADY ANSWERED:\n' + locked.map(([i, j]) => (i + 1) + '. ' + String.fromCharCode(65 + j)).join('\n') + '\n';
  }
  const head = header ? header + '\n\n' : '';
  return 'You are completing a matching exam question.\n\n' + head + 'STATEMENTS:\n' + numbered + '\n\nITEMS:\n' + items + fixed + '\nReply with exactly ' + n + ' lines using ONLY letters.\n1. B\n2. E\n...';
}

async function askAiMatching(header, statements, options, n, locked, used) {
  used = new Set(used || []);
  const skip = new Set((locked || []).map((x) => x[0]));
  const remaining = n - skip.size;
  let prompt = _matchingPrompt(header, statements, options, n, locked);
  if (cfg('WEB_SEARCH_ENABLED')) {
    try {
      const context = await ollamaWebSearch(_searchQuery([header, ...statements, ...options].join(' ')));
      if (context) prompt += '\n\nNon-AI web search snippets (reference only):\n' + context.slice(0, 2000);
    } catch (error) { console.warn('[providers] Matching web search failed:', error.message); }
  }
  let bestIdxs = null;
  let bestMatched = 0;
  const consider = (idxs, matched) => { if (matched > bestMatched) { bestIdxs = idxs; bestMatched = matched; } };

  if (cfg('CUSTOM_API_KEY') && !customCooling()) {
    try {
      const r = await postCustomApi([{ role: 'user', content: prompt }], { maxTokens: 260, temperature: 0.1, timeout: 30 });
      if (r) {
        const msg = r.choices?.[0]?.message || {};
        const result = _parseMapping((msg.content || msg.reasoning || '').trim(), options, n, skip, used);
        if (_matchingOk(result.matched, remaining)) return result;
        consider(result.idxs, result.matched);
      }
    } catch (e) { /* try next */ }
  }
  if (cfg('GEMINI_API_KEY')) {
    const raw = await _askGeminiPrompt(prompt, { maxTokens: 260, temperature: 0.1, timeout: 30 });
    if (raw) {
      const result = _parseMapping(raw, options, n, skip, used);
      if (_matchingOk(result.matched, remaining)) return result;
      consider(result.idxs, result.matched);
    }
  }
  if (cfg('OPENROUTER_API_KEY') && !orCooling()) {
    try {
      const r = await postOpenRouter([{ role: 'user', content: prompt }], { maxTokens: 260, temperature: 0.1, timeout: 30 });
      if (r) {
        const msg = r.choices?.[0]?.message || {};
        const result = _parseMapping((msg.content || msg.reasoning || '').trim(), options, n, skip, used);
        if (_matchingOk(result.matched, remaining)) return result;
        consider(result.idxs, result.matched);
      }
    } catch (e) { /* try next */ }
  }
  try {
    const r = await postOllama(prompt, { numPredict: 300, temperature: 0.1, timeout: 45 });
    if (r && r.response) {
      const result = _parseMapping(r.response.trim(), options, n, skip, used);
      if (_matchingOk(result.matched, remaining)) return result;
      consider(result.idxs, result.matched);
    }
  } catch (e) { /* offline */ }
  if (bestIdxs !== null && bestMatched > 0) return { idxs: bestIdxs, matched: bestMatched };
  return { idxs: new Array(n).fill(-1), matched: 0 };
}

async function resolveMatching(header, statements, options, n) {
  const idxs = new Array(n).fill(-1);
  const src = new Array(n).fill('');
  const used = new Set();
  let keyed = 0;
  for (let i = 0; i < n; i++) {
    if (!statements[i]) continue;
    const matches = await localBankOptionMatches(statements[i], options);
    const match = matches.find((item) => !used.has(item.index));
    if (!match) continue;
    idxs[i] = match.index;
    src[i] = 'key';
    used.add(match.index);
    keyed++;
  }
  if (cfg('ANSWER_KEY_ENABLED')) {
    for (let i = 0; i < n; i++) {
      if (idxs[i] !== -1 || !statements[i]) continue;
      const ans = await keyMatchAnswer(statements[i]);
      if (!ans) continue;
      const j = _bestOptionIndex(ans, options, used);
      if (j === -1) continue;
      idxs[i] = j;
      src[i] = 'key';
      used.add(j);
      keyed++;
    }
  }
  if (keyed === n) return { idxs, src, keyed, aiMatched: 0 };
  const openBlanks = [];
  for (let i = 0; i < n; i++) if (idxs[i] === -1) openBlanks.push(i);
  const locked = [];
  for (let i = 0; i < n; i++) if (idxs[i] !== -1) locked.push([i, idxs[i]]);
  let aiMatched = 0;
  if (openBlanks.length && used.size < options.length) {
    const res = await askAiMatching(header, statements, options, n, locked, used);
    for (const i of openBlanks) {
      if (res.idxs[i] !== -1 && !used.has(res.idxs[i])) {
        idxs[i] = res.idxs[i];
        src[i] = 'ai';
        used.add(res.idxs[i]);
        aiMatched++;
      }
    }
  }
  const unused = [];
  for (let j = 0; j < options.length; j++) if (!used.has(j)) unused.push(j);
  for (let i = 0; i < n; i++) {
    if (idxs[i] === -1 && unused.length) {
      idxs[i] = unused.shift();
      src[i] = 'elim';
    }
  }
  return { idxs, src, keyed, aiMatched };
}

function _matchingBatchPrompt(rows, options, header) {
  const rowLines = rows.map((row) => 'ROW ' + row.rowIndex + ': ' + (row.subStatement || '[statement unavailable]')).join('\n');
  const itemLines = options.map((option, index) => (index + 1) + '. ' + option).join('\n');
  const headerLine = header ? 'QUESTION: ' + header + '\n' : '';
  return 'You are completing one matching exam question. Each row is a statement with a missing term and must be matched to exactly one item from the shared ITEMS list.\n\n' +
    headerLine +
    'ROWS:\n' + rowLines + '\n\n' +
    'ITEMS:\n' + itemLines + '\n\n' +
    'Rules:\n' +
    '- Reply with one strict JSON object and nothing else (no prose, no markdown fences).\n' +
    '- Keys are ROW numbers as strings; values are the EXACT item text copied character-for-character from ITEMS.\n' +
    '- Assign each item to at most one row and prefer a one-to-one assignment.\n' +
    '- Omit a row when no item clearly fits instead of guessing.\n' +
    '- Some items differ by small words ("information security" vs "also information security"); copy the exact one that fits the statement.\n' +
    '- Example shape: {"1": "first item text", "2": "second item text"}';
}

function _extractJsonObject(raw) {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  const shape = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  try { return shape(JSON.parse(slice)); } catch (error) { /* try repair */ }
  try {
    const repaired = slice.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"');
    return shape(JSON.parse(repaired));
  } catch (error) { return null; }
}

function _batchOptionIndex(value, options, taken) {
  const target = normText(value);
  if (!target) return -1;
  const blocked = taken || new Set();
  const variants = [target];
  const stripped = target.replace(/^(?:also|the)\s+/, '');
  if (stripped && stripped !== target) variants.push(stripped);
  for (const variant of variants) {
    let exactSeen = false;
    for (let index = 0; index < options.length; index++) {
      if (normText(options[index]) !== variant) continue;
      exactSeen = true;
      if (!blocked.has(index)) return index;
    }
    if (exactSeen) return -1;
  }
  for (const variant of variants) {
    for (let index = 0; index < options.length; index++) {
      if (blocked.has(index)) continue;
      const candidate = normText(options[index]);
      if (!candidate) continue;
      if ((candidate.startsWith(variant) || variant.startsWith(candidate)) && similarity(variant, candidate) >= 0.6) return index;
    }
  }
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < options.length; index++) {
    if (blocked.has(index)) continue;
    const score = similarity(target, normText(options[index]));
    if (score > bestScore) { best = index; bestScore = score; }
  }
  const floor = Number(cfg('MATCHING_OPTION_FLOOR')) || 0.45;
  return best !== -1 && bestScore >= Math.max(floor, 0.6) ? best : -1;
}

function _batchAssignments(parsed, rows, options) {
  const allowed = new Set((rows || []).map((row) => String(row.rowIndex)));
  const assignments = {};
  const taken = new Set();
  let matched = 0;
  for (const [rawKey, rawValue] of Object.entries(parsed || {})) {
    const key = String(rawKey).trim().replace(/^row\s*/i, '').replace(/[^0-9]/g, '');
    if (!allowed.has(key) || assignments[key] !== undefined) continue;
    const index = _batchOptionIndex(typeof rawValue === 'string' ? rawValue : (rawValue && rawValue.answer) || '', options, taken);
    if (index === -1) continue;
    assignments[key] = options[index];
    taken.add(index);
    matched++;
  }
  return { assignments, matched };
}

async function resolveMatchingBatch(rows, options, header) {
  const entries = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && Number.isFinite(Number(row.rowIndex)))
    .map((row) => ({ rowIndex: Number(row.rowIndex), subStatement: String(row.subStatement || '').replace(/\s+/g, ' ').trim() }));
  const items = (Array.isArray(options) ? options : [])
    .map((option) => String(option || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const empty = { assignments: {}, matched: 0, source: '' };
  if (!entries.length || items.length < 2) return empty;

  let prompt = _matchingBatchPrompt(entries, items, String(header || '').replace(/\s+/g, ' ').trim().slice(0, 300));
  if (cfg('WEB_SEARCH_ENABLED')) {
    try {
      const context = await ollamaWebSearch(_searchQuery([header, ...entries.map((row) => row.subStatement), ...items].join(' ')));
      if (context) prompt += '\n\nNon-AI web search snippets (reference only):\n' + context.slice(0, 2000);
    } catch (error) { console.warn('[providers] Matching batch web search failed:', error.message); }
  }

  const wanted = entries.length;
  let best = empty;
  const accept = (raw, source) => {
    const parsed = _extractJsonObject(raw);
    if (!parsed) return false;
    const result = _batchAssignments(parsed, entries, items);
    if (result.matched > best.matched) best = { assignments: result.assignments, matched: result.matched, source };
    return _matchingOk(result.matched, wanted);
  };
  const messageOf = (response) => (response && response.choices && response.choices[0] ? (response.choices[0].message || {}) : {});

  if (cfg('CUSTOM_API_KEY') && !customCooling()) {
    try {
      const response = await postCustomApi([{ role: 'user', content: prompt }], { maxTokens: 400, temperature: 0.1, timeout: 30 });
      const message = messageOf(response);
      if (accept(message.content || message.reasoning || '', 'custom')) return best;
    } catch (error) { /* try next */ }
  }
  if (cfg('GEMINI_API_KEY')) {
    const raw = await _askGeminiPrompt(prompt, { maxTokens: 400, temperature: 0.1, timeout: 30 });
    if (accept(raw, 'gemini')) return best;
  }
  if (cfg('OPENROUTER_API_KEY') && !orCooling()) {
    try {
      const response = await postOpenRouter([{ role: 'user', content: prompt }], { maxTokens: 400, temperature: 0.1, timeout: 30 });
      const message = messageOf(response);
      if (accept(message.content || message.reasoning || '', 'openrouter')) return best;
    } catch (error) { /* try next */ }
  }
  try {
    const response = await postOllama(prompt, { numPredict: 500, temperature: 0.1, timeout: 45 });
    if (response && response.response) accept(response.response, 'ollama');
  } catch (error) { /* offline */ }
  return best.matched ? best : empty;
}

// ── Main MCQ waterfall ──────────────────────────────────────────────────────
async function askAi(q, o, im) {
  im = im || [];
  const w = await getWrongAnswers(q);
  const b = new Set(w.map((x) => normText(x)));
  const isWrong = (option) => {
    const on = normText(option);
    if (!on) return false;
    if (b.has(on)) return true;
    for (const x of b) if (similarity(on, x) >= 0.9) return true;
    return false;
  };
  const local = await localBankOptionMatches(q, o);
  const localOk = local.find((match) => !isWrong(o[match.index]));
  if (localOk) return localOk.index;

  const bq = _isBoolQuestion(o);
  const vp = [];
  for (let i = 0; i < o.length; i++) {
    const on = normText(o[i]);
    if (!(b.has(on) || [...b].some((x) => similarity(on, x) >= 0.9))) vp.push({ origIdx: i, opt: o[i] });
  }
  if (!vp.length) for (let i = 0; i < o.length; i++) vp.push({ origIdx: i, opt: o[i] });
  if (vp.length === 1) return vp[0].origIdx;

  const fo = vp.map((p) => p.opt);
  const oi = vp.map((p) => p.origIdx);
  if (cfg('ANSWER_KEY_ENABLED')) {
    const ki = await keyIndex(q, fo, bq ? cfg('BOOL_QUESTION_MIN_SCORE') : cfg('ANSWER_KEY_MIN_SCORE'));
    if (ki !== -1) return vp[ki].origIdx;
  }
  if (cfg('WEB_SEARCH_ENABLED')) {
    const wi = await askWeb(q, fo, oi);
    if (wi !== -1) return vp[wi].origIdx;
  }
  if (bq) {
    const i = await askBoolClaim(q, fo);
    if (i !== -1) return vp[i].origIdx;
  }
  if (im.length) {
    const i = await askVision(q, fo, im);
    if (i !== -1) return vp[i].origIdx;
  }
  let eq = q;
  if (cfg('ANSWER_KEY_ENABLED')) {
    const h = await hintText(q);
    if (h) eq += '\n\n' + h;
  }
  const exNote = _excludedNote(w);
  if (exNote) eq += ' ' + exNote;

  if (cfg('CUSTOM_API_KEY') && !customCooling()) {
    const r = await askCustomApi(eq, fo, null, oi);
    if (r !== -1) return vp[r].origIdx;
  }
  if (cfg('GEMINI_API_KEY')) {
    const r = await askGemini(eq, fo, null, oi);
    if (r !== -1) return vp[r].origIdx;
  }
  if (cfg('OPENROUTER_WEB_ENABLED') && cfg('OPENROUTER_API_KEY') && !_orWebDisabled && !orCooling()) {
    const web = await askOpenRouterWeb(eq, fo, oi);
    if (web !== -1) return vp[web].origIdx;
  }
  if (cfg('OPENROUTER_API_KEY') && !orCooling()) {
    const r = await askOpenRouter(eq, fo, null, oi);
    if (r !== -1) return vp[r].origIdx;
  }
  try {
    const r = await askOllama(eq, fo, null, oi);
    if (r !== -1) return vp[r].origIdx;
  } catch (e) { /* offline */ }
  return -1;
}
