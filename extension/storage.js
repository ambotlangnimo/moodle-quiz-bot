// ─────────────────────────────────────────────────────────────────────────────
//  STORAGE — promise-mutex serialized read-modify-write cycle
//  chrome.storage.local for answer key cache, wrong cache, search cache.
//  In-memory mirror for hot-path lookups.
// ─────────────────────────────────────────────────────────────────────────────

// ── Promise-mutex serialiser ────────────────────────────────────────────────
let _queue = Promise.resolve();

/**
 * Serialise a read-modify-write cycle end to end.
 * fn receives the current data dict, must return the new data dict (or same).
 */
async function mutex(fn) {
  _queue = _queue.then(fn, fn);
  return _queue;
}

// ── In-memory mirrors ───────────────────────────────────────────────────────
let _answerKeyMem = {};
let _wrongMem = {};
let _searchMem = {};

const STORAGE_KEYS = {
  ANSWER_KEY: 'answerkey_cache',
  WRONG: 'wrong_cache',
  SEARCH: 'search_cache',
};

/**
 * Validate shape of loaded data; drop malformed entries.
 */
function validateAnswerKey(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [rawKey, value] of Object.entries(data)) {
    const key = normText(rawKey);
    if (!key) continue;
    const entry = normalizeAnswerEntry(rawKey, value);
    if (!entry) continue;
    if (!out[key]) {
      out[key] = entry;
      continue;
    }
    const hits = out[key][1];
    for (const hit of entry[1]) {
      if (!hits.some((existing) =>
        normText(existing.question) === normText(hit.question) &&
        normText(existing.answer) === normText(hit.answer)
      )) hits.push(hit);
    }
    out[key][0] = Math.max(out[key][0], entry[0]);
  }
  return out;
}

function normalizeAnswerEntry(question, value) {
  let timestamp = Date.now() / 1000;
  let rawHits;
  if (Array.isArray(value) && value.length === 2 &&
      typeof value[0] === 'number' && Array.isArray(value[1])) {
    timestamp = value[0];
    rawHits = value[1];
  } else if (typeof value === 'string' || (value && typeof value === 'object')) {
    rawHits = [value];
  } else {
    return null;
  }

  const hits = [];
  for (const rawHit of rawHits) {
    const hit = typeof rawHit === 'string' ? { answer: rawHit } : rawHit;
    if (!hit || typeof hit.answer !== 'string' || !hit.answer.trim()) continue;
    hits.push({
      question: typeof hit.question === 'string' && hit.question.trim()
        ? hit.question.trim()
        : question,
      answer: hit.answer.trim(),
      course: typeof hit.course === 'string' ? hit.course : 'imported',
    });
  }
  return [timestamp, hits];
}

function validateWrong(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      out[k] = v.filter((x) => typeof x === 'string');
    }
  }
  return out;
}

function validateSearch(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// ── Load all caches into memory on first access ────────────────────────────
let _loaded = false;
let _loadPromise = null;

function ensureLoaded() {
  if (!_loadPromise) {
    _loadPromise = (async () => {
      await loadConfig();
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.ANSWER_KEY,
        STORAGE_KEYS.WRONG,
        STORAGE_KEYS.SEARCH,
      ]);
      _answerKeyMem = validateAnswerKey(result[STORAGE_KEYS.ANSWER_KEY] || {});
      _wrongMem = validateWrong(result[STORAGE_KEYS.WRONG] || {});
      _searchMem = validateSearch(result[STORAGE_KEYS.SEARCH] || {});
      _loaded = true;
    })();
  }
  return _loadPromise;
}

// ── Dirty tracking: several contexts (worker, tabs, options) share storage, so
//    a flush merges only the keys this context changed instead of overwriting.
const _dirty = { ak: new Set(), wrong: new Set(), search: new Set() };
const _deleted = { ak: new Set(), wrong: new Set(), search: new Set() };

function markKey(kind, key, removed = false) {
  if (!key) return;
  (removed ? _deleted : _dirty)[kind].add(key);
  (removed ? _dirty : _deleted)[kind].delete(key);
}

function overlayPending(kind, base, mem) {
  const out = base && typeof base === 'object' ? { ...base } : {};
  for (const key of _dirty[kind]) if (key in mem) out[key] = mem[key];
  for (const key of _deleted[kind]) delete out[key];
  return out;
}

// Keep the in-memory mirror in sync with writes from other contexts.
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !_loaded) return;
    if (changes[STORAGE_KEYS.ANSWER_KEY]) {
      _answerKeyMem = overlayPending('ak', changes[STORAGE_KEYS.ANSWER_KEY].newValue, _answerKeyMem);
    }
    if (changes[STORAGE_KEYS.WRONG]) {
      _wrongMem = overlayPending('wrong', changes[STORAGE_KEYS.WRONG].newValue, _wrongMem);
    }
    if (changes[STORAGE_KEYS.SEARCH]) {
      _searchMem = overlayPending('search', changes[STORAGE_KEYS.SEARCH].newValue, _searchMem);
    }
  });
}

// ── Debounced cache flush ────────────────────────────────────────────────────
let _flushTimer = null;
const FLUSH_DEBOUNCE_MS = 500;

function scheduleFlush() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(doFlush, FLUSH_DEBOUNCE_MS);
}

async function flushNow() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = null;
  await doFlush();
}
// ── Answer key cache ────────────────────────────────────────────────────────
async function answerKeyGet(key) {
  await ensureLoaded();
  key = normText(key);
  const entry = _answerKeyMem[key];
  if (!entry) return null;
  const ts = entry[0];
  const ttl = cfg('CACHE_TTL');
  const permanent = entry[1].some((hit) => hit && (
    hit.course === 'learned-review' ||
    hit.course === 'imported' ||
    (typeof hit.course === 'string' && hit.course.startsWith('harvested-'))
  ));
  if (ttl > 0 && !permanent && Date.now() / 1000 - ts > ttl) {
    delete _answerKeyMem[key];
    markKey('ak', key, true);
    scheduleFlush();
    return null;
  }
  return entry[1]; // hits array
}

async function answerKeyPut(key, hits, course = 'learned-review') {
  await ensureLoaded();
  if (typeof hits === 'string') {
    const question = key;
    key = normText(question);
    const answer = hits.replace(/<[^>]+>/g, '').trim();
    if (!key || !answer) return;
    hits = (_answerKeyMem[key]?.[1] || []).slice();
    if (!hits.some((hit) => hit && normText(hit.answer) === normText(answer))) {
      hits.push({ question: question.trim(), answer, course });
    }
    await wrongDeleteFuzzy(key, normText(answer));
  }
  key = normText(key);
  if (!key || !Array.isArray(hits) || !hits.length) return;
  _answerKeyMem[key] = [Date.now() / 1000, hits];
  markKey('ak', key);
  evictAnswerKeys();
  scheduleFlush();
}

function evictAnswerKeys() {
  const max = cfg('CACHE_MAX');
  const keys = Object.keys(_answerKeyMem);
  if (keys.length <= max) return;
  keys.sort((a, b) => (_answerKeyMem[a][0] || 0) - (_answerKeyMem[b][0] || 0));
  for (let i = 0; i < keys.length - max; i++) {
    delete _answerKeyMem[keys[i]];
    markKey('ak', keys[i], true);
  }
}

async function saveLocalAnswer(question, answer, course = 'learned-review') {
  const key = normText(question);
  const value = (answer || '').replace(/<[^>]+>/g, '').trim();
  if (!key || !value) return;
  const hits = (await answerKeyGet(key)) || [];
  const answerNorm = normText(value);
  if (!hits.some((hit) => hit && normText(hit.answer) === answerNorm)) {
    hits.push({
      question: (question || '').trim(),
      answer: value,
      course,
    });
  }
  await answerKeyPut(key, hits);
}

async function answerKeyImport(imported) {
  await ensureLoaded();
  const questions = imported && imported.questions && typeof imported.questions === 'object'
    ? imported.questions
    : imported;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new Error('Question bank JSON must contain a question map.');
  }
  let added = 0;
  for (const [rawKey, entry] of Object.entries(questions)) {
    const key = normText(rawKey);
    const normalized = normalizeAnswerEntry(rawKey, entry);
    if (!key || !normalized) continue;
    const existing = _answerKeyMem[key] || [normalized[0], []];
    const hits = existing[1].slice();
    const seen = new Set(hits.filter((hit) => hit && hit.answer).map((hit) =>
      `${normText(hit.question || rawKey)}|${normText(hit.answer)}`));
    for (const hit of normalized[1]) {
      const signature = `${normText(hit.question || rawKey)}|${normText(hit.answer)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      hits.push(hit);
      added++;
    }
    if (hits.length) {
      _answerKeyMem[key] = [Math.max(existing[0] || 0, normalized[0]), hits];
      markKey('ak', key);
    }
  }
  evictAnswerKeys();
  scheduleFlush();
  return { added, questions: Object.keys(_answerKeyMem).length };
}

async function answerKeyDelete(key) {
  await ensureLoaded();
  delete _answerKeyMem[key];
  markKey('ak', key, true);
  scheduleFlush();
}

async function answerKeyDeleteFuzzy(qNorm) {
  await ensureLoaded();
  for (const storedKey of Object.keys(_answerKeyMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      delete _answerKeyMem[storedKey];
      markKey('ak', storedKey, true);
    }
  }
  scheduleFlush();
}

// ── Wrong cache ─────────────────────────────────────────────────────────────
async function wrongGetAll(qNorm) {
  await ensureLoaded();
  const combined = [];
  for (const [storedKey, values] of Object.entries(_wrongMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      for (const v of values) {
        if (typeof v === 'string' && v.trim()) combined.push(v);
      }
    }
  }
  const seen = new Set();
  return combined.filter((v) => {
    const n = normText(v);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

async function wrongSet(key, values) {
  await ensureLoaded();
  if (typeof values === 'string') {
    key = normText(key);
    const answer = normText(values);
    if (!key || !answer) return;
    values = [...(_wrongMem[key] || []), answer];
  } else {
    key = normText(key);
  }
  if (!key) return;
  _wrongMem[key] = [...new Set(values)];
  markKey('wrong', key);
  scheduleFlush();
}

async function getWrongAnswers(question) {
  const key = normText(question);
  return key ? wrongGetAll(key) : [];
}

async function learnWrong(question, answer) {
  const key = normText(question);
  const value = normText(answer);
  if (!key || !value) return;
  await answerKeyDeleteFuzzy(key);
  const previous = await wrongGetAll(key);
  if (!previous.some((item) => normText(item) === value)) {
    previous.push(value);
  }
  await wrongSet(key, previous);
}

async function learnCorrect(question, answer) {
  const key = normText(question);
  const value = (answer || '').replace(/<[^>]+>/g, '').trim();
  if (!key || !value) return;
  await saveLocalAnswer(question, value);
  await wrongDeleteFuzzy(key, normText(value));
}

async function wrongDeleteFuzzy(qNorm, answerNorm) {
  await ensureLoaded();
  for (const storedKey of Object.keys(_wrongMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      const filtered = _wrongMem[storedKey].filter((item) => normText(item) !== answerNorm);
      if (filtered.length === _wrongMem[storedKey].length) continue;
      if (filtered.length) {
        _wrongMem[storedKey] = filtered;
        markKey('wrong', storedKey);
      } else {
        delete _wrongMem[storedKey];
        markKey('wrong', storedKey, true);
      }
    }
  }
  scheduleFlush();
}

async function answerKeyGetAll() {
  await ensureLoaded();
  return { ..._answerKeyMem };
}

async function answerKeyCount() {
  await ensureLoaded();
  return Object.keys(_answerKeyMem).length;
}

async function wrongDeleteKey(key) {
  await ensureLoaded();
  delete _wrongMem[key];
  markKey('wrong', key, true);
  scheduleFlush();
}

async function searchGet(key) {
  await ensureLoaded();
  return _searchMem[key] || null;
}

async function searchPut(key, text) {
  await ensureLoaded();
  _searchMem[key] = text;
  markKey('search', key);
  scheduleFlush();
}

// ── Bundled starter bank (default_bank.json) ───────────────────────────────
//    Imported once per extension version; import is merge-only and idempotent.
async function seedDefaultBank(force = false) {
  const version = chrome.runtime.getManifest().version;
  const flag = await chrome.storage.local.get('default_bank_version');
  if (!force && flag.default_bank_version === version) return null;
  const response = await fetch(chrome.runtime.getURL('default_bank.json'));
  if (!response.ok) throw new Error(`default_bank.json HTTP ${response.status}`);
  const result = await answerKeyImport(await response.json());
  await flushNow();
  await chrome.storage.local.set({ default_bank_version: version });
  return result;
}

// ── Utility: norm_text port ────────────────────────────────────────────────
function normText(s) {
  s = (s || '').toLowerCase();
  s = s.replace(/^(question\s*)?\d+[.)]\s*/, '');
  s = s.replace(/\bselect one\b|\bchoose\.\.\.|\btrue or false\b/g, '');
  s = s.replace(/[_\-]{2,}/g, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ── Simple string similarity (bigram Dice) ────────────────────────────────
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.substring(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const m1 = bigrams(a);
  const m2 = bigrams(b);
  let intersection = 0;
  for (const [bg, c1] of m1) {
    const c2 = m2.get(bg) || 0;
    intersection += Math.min(c1, c2);
  }
  const total = [...m1.values()].reduce((s, c) => s + c, 0) +
                [...m2.values()].reduce((s, c) => s + c, 0);
  return total === 0 ? 0 : (2 * intersection) / total;
}

// ── GitHub Contents API helpers ─────────────────────────────────────────────
//  Shared by the service worker (background.js) and the options page
//  (options.js), both of which include this file.
//
//  The metadata endpoint must be requested with the JSON media type
//  (`application/vnd.github+json`); requesting `...raw+json` returns the file
//  body instead of the JSON envelope, so `data.sha` is missing and the
//  subsequent PUT fails with 422 "sha wasn't supplied".

/** Decode a base64 payload (as returned by the Contents API) into a UTF-8 string. */
function b64ToUtf8(b64) {
  const binary = atob((b64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** Encode a UTF-8 string into base64 (btoa alone throws on non-Latin1 input). */
function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Read a file from a GitHub repo via the Contents API.
 * Returns { sha, content, missing } where `content` is the parsed JSON object
 * (null when absent or unparsable) and `missing` is true on 404.
 * Throws for other API/network failures.
 */
async function gitHubGetFile(owner, repo, path, token) {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?t=${Date.now()}`;
  const resp = await fetch(url, { headers, cache: 'no-store' });
  if (resp.status === 404) return { sha: null, content: null, missing: true };
  if (!resp.ok) throw new Error(`GitHub API error: ${resp.status}`);
  const data = await resp.json();
  let content = null;
  if (data && typeof data.content === 'string' && data.content) {
    try {
      content = JSON.parse(b64ToUtf8(data.content));
    } catch (e) {
      content = null; // Malformed JSON: treat as empty and overwrite.
    }
  }
  return { sha: (data && data.sha) || null, content, missing: false };
}

/**
 * Create or update a JSON file via the Contents API.
 * Always sends the current `sha` when updating (omit only for a brand-new
 * file). If the server rejects the stale sha with 409/422, re-fetch the latest
 * sha once and retry. Returns { ok, status, message }.
 */
async function gitHubPutJson(owner, repo, path, token, data, message, sha) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const content = utf8ToB64(JSON.stringify(data, null, 2));

  const doPut = (fileSha) => {
    const payload = { message, content };
    if (fileSha) payload.sha = fileSha; // Omit only when creating a new file.
    return fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
  };

  let resp = await doPut(sha);
  if (resp.status === 409 || resp.status === 422) {
    // Stale sha: re-fetch the latest metadata once and retry the PUT.
    let latestSha = null;
    try {
      latestSha = (await gitHubGetFile(owner, repo, path, token)).sha;
    } catch (e) {
      latestSha = null;
    }
    resp = await doPut(latestSha);
  }

  if (resp.ok) return { ok: true, status: resp.status, message: '' };
  let apiMessage = '';
  try {
    apiMessage = (await resp.json()).message || '';
  } catch (e) {
    // Non-JSON error body; keep the generic message.
  }
  return { ok: false, status: resp.status, message: apiMessage };
}

function doFlush() {
  _flushTimer = null;
  return mutex(async () => {
    const pending = ['ak', 'wrong', 'search'].some((kind) => _dirty[kind].size || _deleted[kind].size);
    if (!pending) return;
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ANSWER_KEY,
      STORAGE_KEYS.WRONG,
      STORAGE_KEYS.SEARCH,
    ]);
    // Synchronous merge section: no await between merge and set().
    _answerKeyMem = overlayPending('ak', validateAnswerKey(stored[STORAGE_KEYS.ANSWER_KEY] || {}), _answerKeyMem);
    _wrongMem = overlayPending('wrong', validateWrong(stored[STORAGE_KEYS.WRONG] || {}), _wrongMem);
    _searchMem = overlayPending('search', validateSearch(stored[STORAGE_KEYS.SEARCH] || {}), _searchMem);
    for (const kind of ['ak', 'wrong', 'search']) {
      _dirty[kind].clear();
      _deleted[kind].clear();
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.ANSWER_KEY]: _answerKeyMem,
      [STORAGE_KEYS.WRONG]: _wrongMem,
      [STORAGE_KEYS.SEARCH]: _searchMem,
    });
  });
}