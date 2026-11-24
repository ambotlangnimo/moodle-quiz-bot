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
    const normalized = {
      question: typeof hit.question === 'string' && hit.question.trim()
        ? hit.question.trim()
        : question,
      answer: hit.answer.trim(),
      course: typeof hit.course === 'string' ? hit.course : 'imported',
      verified: hit.verified === true,
    };
    // Keep an explicit "known wrong" marker so it can be purged on the next write.
    if (hit.wrong === true) normalized.wrong = true;
    hits.push(normalized);
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
async function answerKeyGet(key, options = {}) {
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
  const wrong = (await getWrongAnswers(key)).map((answer) => normText(answer)).filter(Boolean);
  const includeUnverified = options && options.includeUnverified === true;
  return entry[1].filter((hit) => {
    if (!hit || hit.wrong === true) return false;
    if (!includeUnverified && hit.verified !== true) return false;
    const answer = hitAnswerNorm(hit);
    return !answer || !wrong.some((knownWrong) =>
      answer === knownWrong || similarity(answer, knownWrong) >= 0.9
    );
  });
}

function hitAnswerNorm(hit) {
  if (!hit || typeof hit !== 'object' || typeof hit.answer !== 'string') return '';
  return normText(hit.answer);
}

// Verified answers always outrank unverified ones and conflicting guesses are
// purged: as soon as a question has a `verified: true` hit, every hit with a
// different answer is dropped and the verified hit is moved to index 0.
// Hits flagged `wrong: true` never survive a write.
function rankHits(hits) {
  if (!Array.isArray(hits)) return [];
  const verified = [];
  const unverified = [];
  const other = [];
  const seen = new Set();
  for (const hit of hits) {
    if (hit && typeof hit === 'object' && hit.wrong === true) continue;
    const answerNorm = hitAnswerNorm(hit);
    if (!answerNorm) { other.push(hit); continue; }
    if (seen.has(answerNorm)) continue;
    seen.add(answerNorm);
    if (hit.verified === true) verified.push(hit);
    else unverified.push(hit);
  }
  if (!verified.length) return unverified.concat(other);
  const verifiedNorms = verified.map(hitAnswerNorm);
  const kept = unverified.filter((hit) => {
    const answerNorm = hitAnswerNorm(hit);
    // Keep unverified hits that are only a spacing/punctuation variant of a
    // verified answer; everything else is a conflicting guess and is purged.
    return verifiedNorms.some((norm) => norm === answerNorm || similarity(answerNorm, norm) >= 0.9);
  });
  return verified.concat(kept, other);
}

// `opts.replaceVerified` is for single-answer keys (one matching statement, one
// MCQ prompt): a freshly graded verified answer retires older verified hits that
// now contradict it, so a stale pair can never outrank Moodle's latest result.
async function answerKeyPut(key, hits, course = 'learned-review', opts = {}) {
  await ensureLoaded();
  const verified = !!(opts && opts.verified);
  const replaceVerified = !!(opts && opts.replaceVerified);
  if (typeof hits === 'string') {
    const question = key;
    key = normText(question);
    const answer = hits.replace(/<[^>]+>/g, '').trim();
    if (!key || !answer) return;
    const answerNorm = normText(answer);
    hits = (_answerKeyMem[key]?.[1] || []).slice();
    if (verified && replaceVerified) {
      hits = hits.filter((hit) => !hit || typeof hit !== 'object' ||
        hit.verified !== true || normText(hit.answer) === answerNorm);
    }
    const existing = hits.find((hit) => hit && normText(hit.answer) === answerNorm);
    if (existing) {
      if (verified && !existing.verified) existing.verified = true;
    } else {
      const hit = { question: question.trim(), answer, course };
      if (verified) hit.verified = true;
      hits.push(hit);
    }
    await wrongDeleteFuzzy(key, answerNorm);
  } else if (Array.isArray(hits) && verified) {
    hits = hits.map((hit) => (hit && typeof hit === 'object') ? { ...hit, verified: true } : hit);
  }
  key = normText(key);
  if (!key || !Array.isArray(hits) || !hits.length) return;

  // Verified answers are authoritative: purge them out of the wrong cache so a
  // stale "wrong" record can never outvote what Moodle confirmed on review.
  const verifiedNorms = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object' || hit.verified !== true) continue;
    const answerNorm = hitAnswerNorm(hit);
    if (answerNorm && !verifiedNorms.includes(answerNorm)) verifiedNorms.push(answerNorm);
  }
  for (const answerNorm of verifiedNorms) await wrongDeleteFuzzy(key, answerNorm);

  // Purge unverified hits that the wrong cache already knows are incorrect, then
  // force verified hits to index 0 so lookups always see them first.
  const knownWrong = (await getWrongAnswers(key)).map((item) => normText(item)).filter(Boolean);
  if (knownWrong.length) {
    hits = hits.filter((hit) => {
      if (!hit || typeof hit !== 'object' || hit.verified === true) return true;
      const answerNorm = hitAnswerNorm(hit);
      if (!answerNorm) return true;
      return !knownWrong.some((item) => item === answerNorm || similarity(answerNorm, item) >= 0.9);
    });
  }
  hits = rankHits(hits);
  if (!hits.length) {
    // Everything stored for this question was a known-wrong guess: drop the key
    // instead of keeping a poisoned entry around.
    if (_answerKeyMem[key]) {
      delete _answerKeyMem[key];
      markKey('ak', key, true);
      scheduleFlush();
    }
    return;
  }

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
  const hits = (await answerKeyGet(key, { includeUnverified: true })) || [];
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
  const questions = unwrapBankQuestions(imported);
  if (!questions) {
    throw new Error('Question bank JSON must contain a question map.');
  }
  let added = 0;
  for (const [rawKey, entry] of Object.entries(questions)) {
    if (BANK_META_KEYS.has(rawKey)) continue;
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

// Keys a bank file may carry that are not questions themselves. They must never be
// imported as question entries (a bare map without the `questions` wrapper still
// sometimes ships `updatedAt` alongside the questions).
const BANK_META_KEYS = new Set(['questions', 'updatedAt', 'format', 'version', 'exportedAt']);

/**
 * Extract the question map out of a bank payload.
 *
 * GitHub banks are written either as `{ "questions": { ... }, "updatedAt": "..." }`
 * (the wrapper used by the Python harvester and by this extension's exporter) or as
 * a bare `{ question: [timestamp, hits] }` map. Unwrap before iterating over the
 * question keys. Returns null when the payload is not a question map at all.
 */
function unwrapBankQuestions(bankJson) {
  const entriesMap = (bankJson && typeof bankJson.questions === 'object' && !Array.isArray(bankJson.questions))
    ? bankJson.questions
    : bankJson;
  if (!entriesMap || typeof entriesMap !== 'object' || Array.isArray(entriesMap)) return null;
  return entriesMap;
}

/**
 * Merge a GitHub bank payload into chrome.storage.local (the pull direction).
 *
 * Shared by the options page ("Sync Now") and the service worker (push sync), so
 * both accept every bank shape and count new answers identically.
 * Returns { added, questions }: newly stored answers and the resulting total.
 */
async function mergeRemoteBankIntoLocal(bankJson) {
  const entriesMap = unwrapBankQuestions(bankJson);
  if (!entriesMap) return { added: 0, questions: await answerKeyCount() };

  const pullMap = {};
  for (const [rawKey, value] of Object.entries(entriesMap)) {
    if (!rawKey || BANK_META_KEYS.has(rawKey)) continue;
    const normalized = normalizeAnswerEntry(rawKey, value);
    if (!normalized || !normalized[1].length) continue;
    pullMap[rawKey] = normalized;
  }
  const pulled = await answerKeyImport({ questions: pullMap });
  // Persist right away so the service worker and content scripts see the merged
  // answers without waiting for the 500 ms flush debounce.
  try {
    await flushNow();
  } catch (error) {
    // Merged in memory; the scheduled flush retries the storage write.
  }
  return { added: pulled.added, questions: pulled.questions };
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

async function answerKeyAddWrong(questionText, wrongAnswerOrCombo, courseTag) {
  await ensureLoaded();
  const key = normText(questionText);
  const rawAnswer = String(wrongAnswerOrCombo || '').replace(/<[^>]+>/g, '').trim();
  if (!key || !rawAnswer) return;

  const isCombo = courseTag === 'multiselect-combo' || /\s*\|\|\s*/.test(rawAnswer);
  const combo = isCombo
    ? rawAnswer.split(/\s*\|\|\s*/).map(normText).filter(Boolean).sort()
    : [];
  const wrongAnswer = combo.length
    ? 'MULTISELECT PARTIAL COMBO ' + combo.map((choice) => choice.length + ' ' + choice).join(' ')
    : rawAnswer;
  await wrongSet(key, wrongAnswer);

  if (combo.length) return;
  const answerNorm = normText(rawAnswer);
  const entry = _answerKeyMem[key];
  if (!answerNorm || !entry) return;
  const hits = entry[1].filter((hit) => hitAnswerNorm(hit) !== answerNorm);
  if (hits.length === entry[1].length) return;
  if (hits.length) {
    _answerKeyMem[key] = [entry[0], hits];
    markKey('ak', key);
  } else {
    delete _answerKeyMem[key];
    markKey('ak', key, true);
  }
  scheduleFlush();
}

async function answerKeyGetWrong(questionText) {
  return getWrongAnswers(questionText);
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

// ── Superscript / subscript / Moodle image normalization ────────────────────
//  `cleanDOMToAI` in the reference toolkit turns <sup>/<sub> markup into the
//  real unicode characters so "2<sup>3</sup>" reads exactly like a typed "2³".
//  `unscriptDigits()` then folds both forms back to plain digits for matching,
//  and attempt-specific pluginfile.php URLs collapse into a stable
//  `[moodle-asset:<filename>]` token, so the same item matches across attempts.
const SUP_MAP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ', 'm': 'ᵐ',
  'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ',
};
const SUB_MAP = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'i': 'ᵢ',
  'j': 'ⱼ', 'n': 'ₙ', 'p': 'ₚ',
};

const UNSCRIPT_DIGITS = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

/** Fold unicode superscript/subscript digits (2³, 10₂) back to ASCII digits. */
function unscriptDigits(str) {
  if (!str) return '';
  return String(str).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/g, (ch) => UNSCRIPT_DIGITS[ch] || ch);
}

// Moodle rewrites the context/attempt id inside every pluginfile.php URL, so the
// raw src can never match between attempts — the filename is stable. The path
// prefix varies (`/pluginfile.php`, `/2612/pluginfile.php`, ...).
const MOODLE_ASSET_SRC = '(?:https?:\\/\\/[^\\s"\']*?)?\\/pluginfile\\.php\\/\\d+\\/question\\/(?:answer|questiontext|feedback)\\/\\d+(?:\\/\\d+)?\\/([^?#\\s"\']+)';
const MOODLE_ASSET_RE = new RegExp(MOODLE_ASSET_SRC, 'i');
// Full URL form: the `?forcedownload=1` / `#...` tail is attempt noise too.
const MOODLE_ASSET_ANY_RE = new RegExp(MOODLE_ASSET_SRC + '(?:[?#][^\\s"\']*)?', 'gi');

/** Stable `[moodle-asset:<filename>]` token for a Moodle question file URL. */
function moodleAssetToken(src) {
  const text = String(src || '');
  const match = text.match(MOODLE_ASSET_RE);
  if (!match || !match[1]) return '';
  let name = match[1];
  try { name = decodeURIComponent(name); } catch (error) { /* keep the raw name */ }
  return `[moodle-asset:${name}]`;
}

// ── Utility: norm_text port ────────────────────────────────────────────────
function normText(s) {
  s = (s || '').toLowerCase();
  // Attempt-independent image token (URL or already-written token form).
  s = s.replace(MOODLE_ASSET_ANY_RE, ' moodle asset $1 ');
  s = s.replace(/\[\s*moodle\s*-\s*asset\s*:\s*([^\]]+)\]/g, ' moodle asset $1 ');
  // 2³ / 10₂ must fold to 23 / 102 before non-ASCII characters are stripped.
  s = unscriptDigits(s);
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
//  Three GitHub quirks matter here:
//   1. The metadata endpoint must be requested with the JSON media type
//      (`application/vnd.github+json`); requesting `...raw+json` returns the
//      file body instead of the JSON envelope, so `data.sha` is missing and the
//      subsequent PUT fails with 422 "sha wasn't supplied".
//   2. Base64 payloads carry UTF-8 bytes. `atob()` yields one char per byte, so
//      decoding with TextDecoder (and encoding with TextEncoder) keeps `²`,
//      `₂`, emoji, etc. intact instead of producing mojibake.
//   3. GET /contents only inlines `content` for files up to 1 MB. Above that
//      GitHub answers with `"encoding": "none"` and an empty `content`, so the
//      body has to come from the Git blobs API (up to 100 MB) or `download_url`.

const GITHUB_API_ROOT = 'https://api.github.com';

/** Decode a Base64 payload (Contents API / Git blob API) into a UTF-8 string. */
function decodeBase64Utf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Encode a UTF-8 string into Base64 (btoa alone throws on non-Latin1 input). */
function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str == null ? '' : String(str));
  const CHUNK = 0x8000; // String.fromCharCode.apply() has an argument-count limit
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Legacy names kept so older call sites keep working.
function b64ToUtf8(b64) { return decodeBase64Utf8(b64); }
function utf8ToB64(text) { return encodeBase64Utf8(text); }

/** Common GitHub headers: JSON media type plus the token when one is set. */
function gitHubHeaders(token, accept) {
  const headers = { Accept: accept || 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

/** Pull the human-readable message out of a failed GitHub response body. */
async function gitHubErrorDetail(resp) {
  try {
    const text = (await resp.text()).trim();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      const message = parsed && (parsed.message || parsed.error);
      return String(message || text.slice(0, 300)).trim();
    } catch (error) {
      return text.slice(0, 300);
    }
  } catch (error) {
    return '';
  }
}

/**
 * Read the raw text behind a Contents API metadata response.
 * Inline Base64 is used when GitHub sends it; files over 1 MB (`encoding:
 * "none"`) are read from the Git blobs API, with `download_url` as a fallback.
 * Every failure reason is collected so the caller can surface it verbatim.
 */
async function gitHubReadFileText(owner, repo, token, meta) {
  if (meta.contentB64) {
    return { text: decodeBase64Utf8(meta.contentB64), source: 'contents' };
  }

  const failures = [];

  if (meta.sha) {
    try {
      const blobUrl = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(meta.sha)}`;
      const blobResp = await fetch(blobUrl, { headers: gitHubHeaders(token), cache: 'no-store' });
      if (!blobResp.ok) {
        const detail = await gitHubErrorDetail(blobResp);
        failures.push(`Git blob fetch failed: HTTP ${blobResp.status}${detail ? ' — ' + detail : ''}`);
      } else {
        const blob = await blobResp.json();
        if (blob && typeof blob.content === 'string' && blob.content) {
          return blob.encoding === 'base64'
            ? { text: decodeBase64Utf8(blob.content), source: 'blob' }
            : { text: blob.content, source: 'blob' };
        }
        failures.push('Git blob response contained no content');
      }
    } catch (error) {
      failures.push(`Git blob fetch failed: ${error.message}`);
    }
  }

  if (meta.downloadUrl) {
    try {
      // raw.githubusercontent.com serves the file as text; the token is still
      // required for private repositories.
      const rawResp = await fetch(meta.downloadUrl, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        cache: 'no-store',
      });
      if (!rawResp.ok) {
        failures.push(`raw download failed: HTTP ${rawResp.status}`);
      } else {
        return { text: await rawResp.text(), source: 'download_url' };
      }
    } catch (error) {
      failures.push(`raw download failed: ${error.message}`);
    }
  }

  throw new Error(failures.join('; ') || `GitHub returned no file content for ${meta.sha || 'this file'}`);
}

/**
 * Read a JSON file from a GitHub repo via the Contents API.
 *
 * Returns { sha, content, missing, parseError, size, source }:
 *  - `content` is the parsed JSON object (null when absent or unparsable)
 *  - `parseError` carries the exact JSON.parse/HTTP/decoding failure, never
 *    masked as "unparsable"
 *  - `missing` is true on 404 and `source` records where the body came from
 *    ('contents' | 'blob' | 'download_url' | 'empty' | 'error' | 'missing')
 *
 * Throws only when the metadata request itself fails (non-404 HTTP error).
 */
async function gitHubGetFile(owner, repo, path, token) {
  const url = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?t=${Date.now()}`;
  const resp = await fetch(url, { headers: gitHubHeaders(token), cache: 'no-store' });
  if (resp.status === 404) {
    return { sha: null, content: null, missing: true, parseError: '', size: 0, source: 'missing' };
  }
  if (!resp.ok) {
    const detail = await gitHubErrorDetail(resp);
    const failure = new Error(`GitHub API error: HTTP ${resp.status}${detail ? ' — ' + detail : ''}`);
    failure.status = resp.status;
    failure.detail = detail;
    throw failure;
  }

  const data = (await resp.json()) || {};
  const meta = {
    sha: data.sha || null,
    size: Number(data.size) || 0,
    encoding: data.encoding || '',
    contentB64: typeof data.content === 'string' ? data.content : '',
    downloadUrl: data.download_url || '',
  };

  let text = '';
  let source = 'empty';
  try {
    const read = await gitHubReadFileText(owner, repo, token, meta);
    text = read.text;
    source = read.source;
  } catch (error) {
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: error.message, size: meta.size, source: 'error',
    };
  }

  if (!text.trim()) {
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: `GitHub returned an empty body (size ${meta.size} bytes, read from ${source})`,
      size: meta.size, source,
    };
  }

  try {
    return {
      sha: meta.sha, content: JSON.parse(text), missing: false,
      parseError: '', size: meta.size, source,
    };
  } catch (error) {
    const preview = text.trim().slice(0, 80).replace(/\s+/g, ' ');
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: `${error.message} (${text.length} chars from ${source}, starts with "${preview}")`,
      size: meta.size, source,
    };
  }
}

/**
 * Create or update a JSON file via the Contents API.
 * Always sends the current `sha` when updating (omit only for a brand-new
 * file). If the server rejects the stale sha with 409/422, re-fetch the latest
 * sha once and retry. Returns { ok, status, message }.
 */
async function gitHubPutJson(owner, repo, path, token, data, message, sha) {
  const headers = gitHubHeaders(token);
  headers['Content-Type'] = 'application/json';
  const url = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  // UTF-8 aware: multi-byte characters (², ₂, emoji) survive the round trip.
  const content = encodeBase64Utf8(JSON.stringify(data, null, 2));

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
  const apiMessage = await gitHubErrorDetail(resp);
  const hint = resp.status === 413 ? ' (file is too large for the Contents API)' : '';
  return { ok: false, status: resp.status, message: `${apiMessage}${hint}`.trim() };
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