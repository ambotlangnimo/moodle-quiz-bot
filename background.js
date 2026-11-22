// ─────────────────────────────────────────────────────────────────────────────
//  background.js — Service Worker: API proxy only
//  Exposes: provider proxies, answer-key search, and course answer harvesting
//  No loop state held here.
// ─────────────────────────────────────────────────────────────────────────────

importScripts('config.js', 'storage.js', 'providers.js');

// Track active ports for keepalive
const ports = new Set();
const activeCourseHarvests = new Map();
let _isHarvesting = false;
let harvestQueue = Promise.resolve();
const HARVEST_STOP_WORDS = new Set([
  'a', 'an', 'and', 'of', 'the', 'for', 'in', 'its', 'to', 'with',
  'introduction', 'principles', 'applications', 'fundamentals',
]);
// Gemini API key rotation state. `GEMINI_API_KEY` accepts comma/newline/space
// separated backup keys; a key that answers HTTP 429 (or a quota 403) is put on
// cooldown and the next ready key handles the request, so one exhausted free key
// never takes Gemini out of the fallback chain.
const _geminiKeyState = new Map(); // key -> { limitedUntil, invalidUntil }
let _geminiKeyCursor = 0;
chrome.runtime.onConnect.addListener((port) => {
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!ports.size) setTimeout(() => {}, 20000);
  handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ error: error.message, _reqId: message._reqId }));
  return true;
});

function stripHtml(text) {
  return (text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAnswerKeyHtml(html, maxHits) {
  const hits = [];
  const seen = new Set();
  const blocks = html.split('class="card mb-2 bg-secondary"');
  for (let i = 1; i < blocks.length && hits.length < maxHits; i++) {
    const block = blocks[i];
    const questionMatch = block.match(/class="mb-2">([\s\S]*?)<\/div>/);
    const answerMatch = block.match(/<strong>\s*([\s\S]*?)\s*<span class="chip bg-success">Correct/);
    const courseMatch = block.match(/chip bg-primary[^>]*>([\s\S]*?)<\/div>/);
    if (!(questionMatch && answerMatch)) continue;
    const answer = stripHtml(answerMatch[1]).replace(/\s*Correct\s*$/i, '').trim();
    if (!answer || seen.has(answer.toLowerCase())) continue;
    seen.add(answer.toLowerCase());
    hits.push({
      question: stripHtml(questionMatch[1]),
      answer,
      course: courseMatch ? stripHtml(courseMatch[1]) : '',
    });
  }
  return hits;
}

function decodeHtmlEntities(text) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    copy: '©', hellip: '…', ldquo: '“', lsquo: '‘', mdash: '—',
    ndash: '–', rdquo: '”', reg: '®', rsquo: '’', trade: '™',
  };
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] || entity;
    const code = name[1].toLowerCase() === 'x'
      ? parseInt(name.slice(2), 16)
      : Number(name.slice(1));
    try {
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    } catch (error) {
      return entity;
    }
  });
}

function parseHarvestCards(html) {
  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);
  const stack = [];
  const hits = [];
  let cardDepth = null;
  let questionDepth = null;
  let answerDepth = null;
  let answerStopped = false;
  let question = [];
  let answer = [];

  const finishCard = () => {
    const questionText = question.join('').replace(/\s+/g, ' ').trim();
    const answerText = answer.join('').replace(/\s+/g, ' ').trim();
    if (questionText && answerText) hits.push({ question: questionText, answer: answerText });
    cardDepth = null;
    questionDepth = null;
    answerDepth = null;
    answerStopped = false;
    question = [];
    answer = [];
  };
  const startTag = (tag, attributes) => {
    const depth = stack.length;
    const classes = new Set((attributes.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])
      .slice(1).find(Boolean)?.split(/\s+/) || []);
    if (tag === 'div' && classes.has('card') && classes.has('bg-secondary')) {
      if (cardDepth !== null) finishCard();
      cardDepth = depth;
      question = [];
      answer = [];
      questionDepth = null;
      answerDepth = null;
      answerStopped = false;
    } else if (cardDepth !== null) {
      if (tag === 'div' && classes.has('mb-2') && questionDepth === null) questionDepth = depth;
      if (tag === 'strong' && answerDepth === null) answerDepth = depth;
      if (tag === 'span' && classes.has('chip') && classes.has('bg-success')) answerStopped = true;
    }
    if (!voidTags.has(tag)) stack.push(tag);
  };
  const endTag = (tag) => {
    let index = stack.length - 1;
    while (index >= 0 && stack[index] !== tag) index--;
    if (index < 0) return;
    if (cardDepth !== null) {
      if (index === questionDepth) questionDepth = null;
      if (index === answerDepth) answerDepth = null;
      if (index === cardDepth) finishCard();
    }
    stack.length = index;
  };
  const tokens = (html || '').match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+|</gi) || [];
  for (const token of tokens) {
    if (token.startsWith('<!--') || /^<!/i.test(token)) continue;
    if (!token.startsWith('<')) {
      if (cardDepth === null) continue;
      const data = decodeHtmlEntities(token);
      if (questionDepth !== null && stack.length > questionDepth) question.push(data);
      if (answerDepth !== null && !answerStopped && stack.length > answerDepth) answer.push(data);
      continue;
    }
    const closing = token.match(/^<\/\s*([a-z][\w:-]*)/i);
    if (closing) {
      endTag(closing[1].toLowerCase());
      continue;
    }
    const opening = token.match(/^<\s*([a-z][\w:-]*)\b([\s\S]*?)\/?>$/i);
    if (!opening) continue;
    const tag = opening[1].toLowerCase();
    const attributes = opening[2];
    startTag(tag, attributes);
    if (/\/\s*>$/.test(token)) endTag(tag);
  }
  if (cardDepth !== null) finishCard();
  return hits;
}

function buildHarvestKeywords(values) {
  const keywords = [];
  const seen = new Set();
  for (const value of values) {
    if (isGenericHarvestTitle(value)) continue;
    const words = cleanHarvestTitle(value).toLowerCase()
      .replace(/&/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/);
    for (const word of words) {
      if (word.length < 4 || HARVEST_STOP_WORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      keywords.push(word);
      if (keywords.length === 15) return keywords;
    }
  }
  return keywords;
}

function cleanHarvestTitle(value) {
  return stripHtml(value)
    .replace(/\bUGRD-[A-Z0-9-]+\b/gi, ' ')
    .replace(/\bSEMESTRALEXAM\s+\d{4}[A-Z]?\b/gi, ' ')
    .replace(/\s*(?:[-–—]\s*)?\b\d{4}[A-Z]?\s*$/i, ' ')
    .replace(/\s*[|–—]\s*Moodle\s*$/i, '')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/^\s*[-:|–—]+\s*|\s*[-|]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericHarvestTitle(value) {
  const raw = String(value || '');
  const title = cleanHarvestTitle(raw);
  const normalized = normText(title);
  return !normalized ||
    /^\s*UGRD-[A-Z0-9-]+\s*$/i.test(raw) ||
    /^(?:(?:quiz|seatwork|assignment)\s+)?(?:prelim|midterm|final)\s+exam(?:\s+\d+)?$/.test(normalized) ||
    /^(?:quiz|seatwork|assignment)(?:\s+\d+)?$/.test(normalized) ||
    /^2612s?$/.test(normalized);
}

function courseTopicsFromHtml(html) {
  const topics = [];
  const seen = new Set();
  const pattern = /<([a-z0-9]+)[^>]*class=["'][^"']*\b(?:sectionname|activityname)\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(html || '')) !== null && topics.length < 5) {
    const topic = cleanHarvestTitle(match[2]);
    const key = normText(topic);
    if (!key || isGenericHarvestTitle(topic) || seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
  }
  return topics;
}

async function fetchCourseDetails(courseUrl) {
  let url;
  try {
    url = new URL(courseUrl);
  } catch (error) {
    throw new Error('A valid Moodle course URL is required to resolve the subject title.');
  }
  // .includes() so term-prefixed course paths (e.g. /2612/course/view.php) are accepted.
  if (!/(^|\.)amaes\.com$/i.test(url.hostname) || !url.pathname.includes('/course/view.php')) {
    throw new Error('Refusing to fetch an untrusted course URL.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let html;
  try {
    const response = await fetch(url.href, { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error(`Moodle course page HTTP ${response.status}`);
    html = await response.text();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Moodle course page lookup timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const header = html.match(/<[^>]*class=["'][^"']*\bpage-header-headings\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i);
  const heading = ((header && header[1] || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)) ||
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const title = cleanHarvestTitle(heading ? heading[1] : '');
  return { title: isGenericHarvestTitle(title) ? '' : title, topics: courseTopicsFromHtml(html) };
}

function sendHarvestProgress(sender, level, text) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') return;
  chrome.tabs.sendMessage(tabId, { type: 'AUTO_HARVEST_PROGRESS', level, text }, () => {
    void chrome.runtime.lastError;
  });
}

async function fetchHarvestPage(keyword, page) {
  const url = `https://amauoed.com/search?query=${encodeURIComponent(keyword)}&page=${page}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AmaBot/1.0)' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`AMAES search HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return { status: response.status, hits: parseHarvestCards(await response.text()) };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`AMAES search timed out for "${keyword}" page ${page}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCourseHarvestInfo(message, courseId, sender) {
  const stored = await chrome.storage.local.get(['courseTitlesMap', 'courseTopicsMap']);
  const titleMap = stored.courseTitlesMap && typeof stored.courseTitlesMap === 'object'
    ? stored.courseTitlesMap
    : {};
  const topicMap = stored.courseTopicsMap && typeof stored.courseTopicsMap === 'object'
    ? stored.courseTopicsMap
    : {};
  let title = cleanHarvestTitle(message.courseTitle || message.courseKey || '');
  if (isGenericHarvestTitle(title)) title = '';
  if (!title && !isGenericHarvestTitle(titleMap[courseId])) {
    title = cleanHarvestTitle(titleMap[courseId]);
  }

  const topics = [];
  const seen = new Set();
  const addTopic = (value) => {
    const topic = cleanHarvestTitle(value);
    const key = normText(topic);
    if (!key || isGenericHarvestTitle(topic) || seen.has(key)) return;
    seen.add(key);
    topics.push(topic);
  };
  const suppliedTopics = Array.isArray(message.moduleTopics)
    ? message.moduleTopics
    : Array.isArray(message.keywords) ? message.keywords : [];
  for (const topic of Array.isArray(topicMap[courseId]) ? topicMap[courseId] : []) addTopic(topic);
  for (const topic of suppliedTopics) addTopic(topic);

  if ((!title || !topics.length) && message.courseUrl) {
    try {
      const details = await fetchCourseDetails(message.courseUrl);
      if (details.title) title = details.title;
      topics.length = 0;
      seen.clear();
      for (const topic of details.topics) addTopic(topic);
      for (const topic of Array.isArray(topicMap[courseId]) ? topicMap[courseId] : []) addTopic(topic);
      for (const topic of suppliedTopics) addTopic(topic);
      if (title) {
        if (courseId) titleMap[courseId] = title;
        if (courseId) topicMap[courseId] = topics.slice(0, 5);
        if (courseId) await chrome.storage.local.set({ courseTitlesMap: titleMap, courseTopicsMap: topicMap });
      }
    } catch (error) {
      if (!title) throw error;
      sendHarvestProgress(sender, 'warn', `Could not load course topics: ${error.message}`);
    }
  }

  if (!title || isGenericHarvestTitle(title)) {
    throw new Error('Could not resolve a real subject title; generic quiz titles are not harvested.');
  }
  if (courseId) {
    titleMap[courseId] = title;
    if (topics.length) topicMap[courseId] = topics.slice(0, 5);
    await chrome.storage.local.set({ courseTitlesMap: titleMap, courseTopicsMap: topicMap });
  }

  const keywords = buildHarvestKeywords([title, ...topics, ...(Array.isArray(message.keywords) ? message.keywords : [])]);
  return { title, courseKey: normText(title), keywords };
}

async function runCourseHarvest(courseId, courseKey, keywords, force, sender) {
  const stored = await chrome.storage.local.get('harvestedCourses');
  const harvestedCourses = stored.harvestedCourses && typeof stored.harvestedCourses === 'object'
    ? stored.harvestedCourses
    : {};
  const harvestKey = courseId || courseKey;
  const title = keywords[0] || courseKey;
  if (!force && harvestedCourses[harvestKey]) {
    sendHarvestProgress(sender, 'info', `Course already harvested: ${title}`);
    return { skipped: true, courseId: harvestKey };
  }

  sendHarvestProgress(sender, 'info', `Auto-harvesting answers for ${title}`);
  let added = 0;
  let failed = false;
  for (let keywordIndex = 0; keywordIndex < keywords.length; keywordIndex++) {
    const keyword = keywords[keywordIndex];
    let keywordCards = 0;
    let lastStatus = 'not requested';
    let keywordFailed = false;
    for (let page = 1; page <= 15; page++) {
      let result;
      try {
        result = await fetchHarvestPage(keyword, page);
      } catch (error) {
        failed = true;
        keywordFailed = true;
        lastStatus = error.status || 'network error';
        sendHarvestProgress(
          sender,
          'warn',
          `Harvest "${keyword}" page ${page}: HTTP ${lastStatus}, 0 matched cards; ${error.message}`
        );
        break;
      }
      const { status, hits } = result;
      lastStatus = status;
      keywordCards += hits.length;
      sendHarvestProgress(sender, 'info', `Harvest "${keyword}" page ${page}: HTTP ${status}, ${hits.length} matched card(s)`);
      if (!hits.length) break;
      for (const hit of hits) {
        const key = normText(hit.question);
        const answerNorm = normText(hit.answer);
        if (!key || !answerNorm) continue;
        const existing = await answerKeyGet(key);
        if (!existing || !existing.some((item) => item && normText(item.answer) === answerNorm)) {
          added++;
        }
        await answerKeyPut(hit.question, hit.answer, 'harvested-amauoed');
      }
      if (page < 15) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    sendHarvestProgress(sender, keywordFailed ? 'warn' : 'info', `Harvested ${keywordCards} answers for "${keyword}" (HTTP ${lastStatus})`);
    if (keywordIndex < keywords.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!failed) {
    harvestedCourses[harvestKey] = {
      timestamp: Date.now(),
      keywords,
      answers: added,
    };
    await chrome.storage.local.set({ harvestedCourses });
  }
  sendHarvestProgress(
    sender,
    failed ? 'warn' : 'info',
    failed
      ? `Auto-harvested ${added} answers for ${title}; some searches failed and will be retried next time.`
      : `Auto-harvested ${added} answers for ${title}`
  );
  return failed ? { error: `Some searches failed for ${title}`, added } : { added, courseId: harvestKey, courseKey };
}

function autoHarvestCourse(message, sender) {
  const courseId = String(message.courseId || '').trim();
  const requestKey = courseId || normText(message.courseKey || message.courseTitle || '');
  if (!requestKey) return Promise.resolve({ error: 'Course ID or subject title is required for harvesting.' });
  if (activeCourseHarvests.has(requestKey)) return activeCourseHarvests.get(requestKey);
  const force = message.force === true;
  const task = harvestQueue.then(async () => {
    if (_isHarvesting) return { skipped: true, busy: true };
    _isHarvesting = true;
    try {
      const stored = await chrome.storage.local.get('harvestedCourses');
      const harvestedCourses = stored.harvestedCourses && typeof stored.harvestedCourses === 'object'
        ? stored.harvestedCourses
        : {};
      if (!force && harvestedCourses[requestKey]) {
        sendHarvestProgress(sender, 'info', `Course already harvested: ${cleanHarvestTitle(message.courseTitle || message.courseKey || requestKey)}`);
        return { skipped: true, courseId: requestKey };
      }
      const resolved = await resolveCourseHarvestInfo(message, courseId, sender);
      return await runCourseHarvest(courseId, resolved.courseKey, resolved.keywords, force, sender);
    } finally {
      _isHarvesting = false;
    }
  });
  harvestQueue = task.then(() => undefined, () => undefined);
  activeCourseHarvests.set(requestKey, task);
  const clearActive = () => {
    if (activeCourseHarvests.get(requestKey) === task) activeCourseHarvests.delete(requestKey);
  };
  task.then(clearActive, clearActive);
  return task;
}

function fallbackQuestionQuery(question) {
  const filler = new Set(['a','an','and','are','as','at','be','by','for','from','in','into','is','it','of','on','or','that','the','this','to','was','were','which','with']);
  const clauses = (question || '')
    .replace(/[_-]{2,}/g, ' ')
    .split(/[;.!?]+/)
    .map((clause) => clause.split(/\s+/).filter((word) => word && !filler.has(word.toLowerCase())).join(' ').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let core = clauses[0] || '';
  if (core.length > 120) {
    const start = Math.floor((core.length - 120) / 2);
    core = core.slice(start, start + 120);
  }
  return core;
}

function scoreAnswerKeyHit(hit, options) {
  const answer = (hit.answer || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  let score = 0;
  for (const option of options || []) {
    const candidate = (option || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!candidate) continue;
    if (answer === candidate) score = Math.max(score, 1);
    else if (answer.includes(candidate) || candidate.includes(answer)) score = Math.max(score, 0.85);
  }
  return score;
}

/* ── Extension update checker ────────────────────────────────────────────────
   Friends who load this folder as an unpacked extension get told about newer
   builds published on GitHub. One plain fetch of the repo's manifest.json, a
   semantic-version compare against chrome.runtime.getManifest().version, and
   the answer is cached in storage.local for six hours so a waking service
   worker can never hammer raw.githubusercontent.com. */
const UPDATE_REPO_URL = 'https://github.com/ambotlangnimo/moodle-quiz-bot';
const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/ambotlangnimo/moodle-quiz-bot/main/manifest.json';
const UPDATE_DOWNLOAD_URL = 'https://github.com/ambotlangnimo/moodle-quiz-bot/archive/refs/heads/main.zip';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const UPDATE_FETCH_TIMEOUT_MS = 8000;
const UPDATE_CACHE_KEY = 'EXTENSION_UPDATE_STATUS';
let _updateCheckInFlight = null;

async function fetchLatestVersionFromGitHub() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = JSON.parse(await response.text());
    const version = String((json && json.version) || '').trim();
    if (!version) throw new Error('Remote manifest has no version field');
    return version;
  } finally {
    clearTimeout(timer);
  }
}

function readUpdateCache() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(UPDATE_CACHE_KEY, (items) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve((items && items[UPDATE_CACHE_KEY]) || null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

function writeUpdateCache(value) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [UPDATE_CACHE_KEY]: value }, () => {
        void chrome.runtime.lastError; // storage failures are never fatal here
        resolve();
      });
    } catch (error) {
      resolve();
    }
  });
}

// Normalised shape handed to content.js / options.js. `error` only appears when
// the GitHub lookup itself failed, so callers can tell "up to date" from "offline".
function updateResultFor(result) {
  const current = result.currentVersion || installedVersion();
  const latest = String(result.latestVersion || current).replace(/^v/i, '') || current;
  return {
    updateAvailable: !!result.updateAvailable,
    latestVersion: latest,
    currentVersion: current,
    downloadUrl: result.downloadUrl || UPDATE_DOWNLOAD_URL,
    repoUrl: UPDATE_REPO_URL,
    checkedAt: result.checkedAt || 0,
    ...(result.error ? { error: result.error } : {}),
  };
}

function broadcastUpdateAvailable(result) {
  try {
    chrome.tabs.query({ url: ['https://*.amaes.com/*'] }, (tabs) => {
      if (chrome.runtime.lastError) return;
      for (const tab of tabs || []) {
        if (!tab || tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: 'EXTENSION_UPDATE_AVAILABLE',
          updateAvailable: true,
          latestVersion: result.latestVersion,
          currentVersion: result.currentVersion,
          downloadUrl: result.downloadUrl,
          repoUrl: result.repoUrl,
        }, () => { void chrome.runtime.lastError; });
      }
    });
  } catch (error) { /* page closed mid-broadcast: ignore */ }
}

function installedVersion() {
  try {
    return String(chrome.runtime.getManifest().version || '0.0.0').trim();
  } catch (error) {
    return '0.0.0';
  }
}

// "v3.0.1-beta+7" -> [3, 0, 1]; anything non-numeric counts as 0.
function versionParts(value) {
  const clean = String(value || '').trim().replace(/^v/i, '');
  const core = clean.split(/[+-]/)[0] || '';
  return core.split('.').map((part) => {
    const num = parseInt(part.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(num) ? num : 0;
  });
}

// Semantic comparison: true only when `remote` is strictly newer than `local`.
function isNewerVersion(remote, local) {
  const a = versionParts(remote);
  const b = versionParts(local);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function runExtensionUpdateCheck() {
  const current = installedVersion();
  const result = {
    updateAvailable: false,
    latestVersion: current,
    currentVersion: current,
    downloadUrl: UPDATE_DOWNLOAD_URL,
    repoUrl: UPDATE_REPO_URL,
    checkedAt: 0,
  };
  try {
    const latest = await fetchLatestVersionFromGitHub();
    result.latestVersion = latest.replace(/^v/i, '');
    result.updateAvailable = isNewerVersion(latest, current);
    result.checkedAt = Date.now(); // only successful lookups reset the 6-hour window
  } catch (error) {
    result.error = (error && error.message) || String(error);
  }
  await writeUpdateCache(result);
  const publicResult = updateResultFor(result);
  if (publicResult.updateAvailable) broadcastUpdateAvailable(publicResult);
  return publicResult;
}

// force = true bypasses the cache ("Check for Updates" in the options page).
function getExtensionUpdateStatus(force) {
  if (force) return runExtensionUpdateCheck();
  if (_updateCheckInFlight) return _updateCheckInFlight;
  _updateCheckInFlight = (async () => {
    const cached = await readUpdateCache();
    if (cached && cached.checkedAt && Date.now() - cached.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
      return { ...updateResultFor(cached), fromCache: true };
    }
    return runExtensionUpdateCheck();
  })().finally(() => { _updateCheckInFlight = null; });
  return _updateCheckInFlight;
}

// One automatic check every 6 hours (the storage cache keeps that window honest
// when MV3 suspends this worker in between) plus a fresh one on install/startup.
try {
  chrome.runtime.onInstalled.addListener(() => { getExtensionUpdateStatus(false).catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { getExtensionUpdateStatus(false).catch(() => {}); });
} catch (error) { /* older runtimes: the CHECK_EXTENSION_UPDATE handler still works */ }
setInterval(() => { runExtensionUpdateCheck().catch(() => {}); }, UPDATE_CHECK_INTERVAL_MS);

async function handleMessage(message, sender) {
  await configReady;
  const action = message.action || message.type;
  const payload = message.payload || (action === 'AUTO_HARVEST' ? message : {});
  const { _reqId } = message;

  switch (action) {
    case 'AUTO_HARVEST':
      return await autoHarvestCourse(payload, sender);

    case 'postOpenRouter': {
      const { body, timeout } = payload;
      const headers = {
        'Authorization': `Bearer ${cfg('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://moodle-quiz-bot.local',
        'X-Title': 'Moodle Quiz Bot',
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout || 25000);
      try {
        const response = await fetch(cfg('OPENROUTER_API_URL'), {
          method: 'POST', headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.status === 429) return { _reqId, status: 429, error: 'Rate limited (HTTP 429)' };
        if (response.status === 401) return { _reqId, status: 401, error: 'Invalid API key (HTTP 401)' };
        if (response.status === 402) return { _reqId, status: 402, error: 'Insufficient credits (HTTP 402)' };
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return { _reqId, status: response.status, error: `HTTP ${response.status}: ${text.slice(0, 300)}` };
        }
        const json = await response.json();
        return { _reqId, ...json };
      } catch (err) {
        clearTimeout(timer);
        return { _reqId, error: err.name === 'AbortError' ? 'Request timeout' : err.message };
      }
    }

    case 'postGemini': {
      const { contents, generationConfig, timeout } = payload;
      const keys = String(cfg('GEMINI_API_KEY') || '')
        .split(/[\s,;]+/)
        .map((key) => key.trim())
        .filter(Boolean);
      if (!keys.length) return { _reqId, error: 'Gemini API key is missing' };
      const configuredModel = String(payload.model || cfg('GEMINI_MODEL') || '').trim();
      const model = !configuredModel || configuredModel === 'gemini-2.5-flash'
        ? 'gemini-3.8-flash'
        : configuredModel;
      if (model !== cfg('GEMINI_MODEL')) await saveConfig({ GEMINI_MODEL: model });

      const now = Date.now();
      const cooldownMs = (Number(cfg('GEMINI_KEY_COOLDOWN')) ||
        Number(cfg('OPENROUTER_COOLDOWN')) || 180) * 1000;
      const order = [];
      for (let offset = 0; offset < keys.length; offset++) {
        order.push((_geminiKeyCursor + offset) % keys.length);
      }

      let tried = 0;
      let lastStatus = 0;
      let lastError = '';
      for (const keyIndex of order) {
        const key = keys[keyIndex];
        const state = _geminiKeyState.get(key) || {};
        if ((state.limitedUntil && state.limitedUntil > now) ||
            (state.invalidUntil && state.invalidUntil > now)) continue;
        tried += 1;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout || 30000);
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents, generationConfig }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (response.ok) {
            const json = await response.json();
            const text = (json.candidates?.[0]?.content?.parts || [])
              .map((part) => part.text || '')
              .join('')
              .trim();
            _geminiKeyCursor = (keyIndex + 1) % keys.length;
            return { _reqId, text, keyIndex: keyIndex + 1, keyCount: keys.length };
          }
          const body = await response.text().catch(() => '');
          lastStatus = response.status;
          lastError = `Gemini HTTP ${response.status}: ${body.slice(0, 300)}`;
          const quota = response.status === 429 || response.status === 503 ||
            (response.status === 403 && /quota|rate/i.test(body));
          const invalid = response.status === 401 ||
            (response.status === 400 && /api[ _-]?key not valid|invalid api key/i.test(body));
          if (quota) {
            _geminiKeyState.set(key, { ...state, limitedUntil: now + cooldownMs });
            continue;
          }
          if (invalid) {
            _geminiKeyState.set(key, { ...state, invalidUntil: now + 24 * 60 * 60 * 1000 });
            continue;
          }
          return { _reqId, status: response.status, error: lastError, keyIndex: keyIndex + 1, keyCount: keys.length };
        } catch (err) {
          clearTimeout(timer);
          if (err.name === 'AbortError') {
            return {
              _reqId,
              error: 'Gemini request timeout',
              keyIndex: keyIndex + 1,
              keyCount: keys.length,
            };
          }
          lastStatus = err.status || 0;
          lastError = err.message;
          continue;
        }
      }

      const cooling = keys.length - tried;
      return {
        _reqId,
        status: lastStatus || 429,
        error: tried === 0
          ? `All ${keys.length} Gemini API key(s) are cooling down or invalid`
          : `All Gemini API key(s) failed (${tried} tried${cooling ? `, ${cooling} cooling down` : ''}): ${lastError || 'rate limited'}`,
        allKeysLimited: true,
        keysTried: tried,
        keyCount: keys.length,
      };
    }

    case 'postOllama': {
      const { payload: ollamaPayload, timeout: ollamaTimeout } = payload;
      const url = `${cfg('OLLAMA_URL')}/api/generate`;
      const ollamaOptions = ollamaPayload.options || {};
      const numericPayload = {
        ...ollamaPayload,
        options: {
          ...ollamaOptions,
          temperature: Number(ollamaOptions.temperature) || 0.1,
          num_ctx: parseInt(cfg('OLLAMA_NUM_CTX'), 10) || 16384,
        },
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ollamaTimeout || 60000);
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (cfg('OLLAMA_API_KEY')) headers['Authorization'] = `Bearer ${cfg('OLLAMA_API_KEY')}`;
        const response = await fetch(url, {
          method: 'POST', headers,
          body: JSON.stringify(numericPayload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return { _reqId, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }
        const json = await response.json();
        return { _reqId, ...json };
      } catch (err) {
        clearTimeout(timer);
        return { _reqId, error: err.name === 'AbortError' ? 'Ollama request timeout' : err.message };
      }
    }

    case 'postCustomApi': {
      const { body, timeout } = payload;
      const customApiKey = cfg('CUSTOM_API_KEY');
      const customApiBaseUrl = cfg('CUSTOM_API_BASE_URL');
      if (!customApiBaseUrl) return { _reqId, error: 'Custom API base URL is not configured' };
      const baseUrl = customApiBaseUrl.replace(/\/$/, '');
      const url = `${baseUrl}/chat/completions`;
      const headers = {
        'Content-Type': 'application/json',
      };
      if (customApiKey) {
        headers['Authorization'] = `Bearer ${customApiKey}`;
      }
      const isAutoModel = !body.model || body.model === 'auto';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout || 25000);
      try {
        let response = await fetch(url, {
          method: 'POST', headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.status === 429) return { _reqId, status: 429, error: 'Rate limited (HTTP 429)' };
        if (response.status === 401) return { _reqId, status: 401, error: 'Invalid API key (HTTP 401)' };
        if (response.status === 402) return { _reqId, status: 402, error: 'Insufficient credits (HTTP 402)' };
        if (!response.ok && isAutoModel && (response.status === 400 || response.status === 404)) {
          const modelUrl = `${baseUrl}/models`;
          try {
            const modelResponse = await fetch(modelUrl, { headers, timeout: 10000 });
            if (modelResponse.ok) {
              const modelData = await modelResponse.json();
              const models = modelData?.data || modelData?.models || [];
              let resolvedModel = null;
              for (const m of models) {
                const id = m.id || m.name || m.model;
                if (id && typeof id === 'string') {
                  resolvedModel = id;
                  break;
                }
              }
              if (resolvedModel) {
                body.model = resolvedModel;
                const retryController = new AbortController();
                const retryTimer = setTimeout(() => retryController.abort(), timeout || 25000);
                response = await fetch(url, {
                  method: 'POST', headers,
                  body: JSON.stringify(body),
                  signal: retryController.signal,
                });
                clearTimeout(retryTimer);
              }
            }
          } catch (modelErr) {
            console.warn('[postCustomApi] Failed to resolve model from /models:', modelErr.message);
          }
        }
        if (response.status === 429) return { _reqId, status: 429, error: 'Rate limited (HTTP 429)' };
        if (response.status === 401) return { _reqId, status: 401, error: 'Invalid API key (HTTP 401)' };
        if (response.status === 402) return { _reqId, status: 402, error: 'Insufficient credits (HTTP 402)' };
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return { _reqId, status: response.status, error: `HTTP ${response.status}: ${text.slice(0, 300)}` };
        }
        const json = await response.json();
        return { _reqId, ...json };
      } catch (err) {
        clearTimeout(timer);
        return { _reqId, error: err.name === 'AbortError' ? 'Request timeout' : err.message };
      }
    }

    async function syncGitHubBank(owner, repo, path, token) {
      try {
        // 1) Always GET metadata first so we have the current `sha` (required for updates).
        let meta;
        try {
          meta = await gitHubGetFile(owner, repo, path, token);
        } catch (err) {
          return { error: `Network error: ${err.message}` };
        }

        // 2) Pull first: bank.json may be a bare question map or wrapped in
        //    { "questions": { ... }, "updatedAt": "..." }. Unwrap it and merge every
        //    remote question into chrome.storage.local so those answers are usable
        //    locally before the push below.
        const remote = meta.content && typeof meta.content === 'object' && !Array.isArray(meta.content)
          ? meta.content
          : {};
        const pulled = await mergeRemoteBankIntoLocal(remote);

        // 3) Merge the remote bank with locally learned (verified) answers.
        const wrapper = (remote.questions && typeof remote.questions === 'object' && !Array.isArray(remote.questions))
          ? remote
          : null;
        const questions = wrapper ? { ...wrapper.questions } : { ...remote };

        // Read the freshest local answers directly from storage (all contexts share it).
        await flushNow();
        const stored = await chrome.storage.local.get(STORAGE_KEYS.ANSWER_KEY);
        const local = validateAnswerKey(stored[STORAGE_KEYS.ANSWER_KEY] || {});
        const signature = (key, hit) => normText(hit.question || key) + '|' + normText(hit.answer);
        // normalized question text -> key spelling already used on GitHub, so merging
        // never adds a second (lower-cased) copy of a question the bank already holds.
        const remoteKeyByNorm = new Map();
        for (const rawKey of Object.keys(questions)) {
          if (BANK_META_KEYS.has(rawKey)) continue;
          remoteKeyByNorm.set(normText(rawKey), rawKey);
        }

        for (const [key, entry] of Object.entries(local)) {
          if (!key || !Array.isArray(entry) || !Array.isArray(entry[1])) continue;
          const wanted = entry[1].filter((hit) => hit && hit.answer && (
            hit.verified === true ||
            hit.course === 'learned-review' ||
            hit.course === 'imported' ||
            (typeof hit.course === 'string' && hit.course.startsWith('harvested-'))
          )).map((hit) => ({
            question: hit.question || key,
            answer: hit.answer,
            course: hit.course || 'learned-review',
            verified: true,
          }));
          if (!wanted.length) continue;

          const targetKey = remoteKeyByNorm.get(key) || key;
          const existing = questions[targetKey] ? normalizeAnswerEntry(targetKey, questions[targetKey]) : null;
          const hits = existing ? existing[1].slice() : [];
          const seen = new Set(hits.map((hit) => signature(targetKey, hit)));
          for (const hit of wanted) {
            const sig = signature(targetKey, hit);
            if (seen.has(sig)) continue;
            seen.add(sig);
            hits.push(hit);
          }
          if (hits.length) {
            const ts = Math.max(existing ? existing[0] : 0, entry[0] || 0, Date.now() / 1000);
            questions[targetKey] = [ts, hits];
            remoteKeyByNorm.set(key, targetKey);
          }
        }

        const bankObj = wrapper
          ? { ...wrapper, questions, updatedAt: new Date().toISOString() }
          : questions;

        // 4) PUT with `sha` (omitted only for a brand-new file), retrying once on a stale sha.
        const commitMsg = 'Moodle Quiz Bot: auto-sync from extension';
        const put = await gitHubPutJson(owner, repo, path, token, bankObj, commitMsg, meta.sha);
        if (!put.ok) {
          return { error: `GitHub PUT failed: ${put.status} ${put.message || ''}` };
        }

        return {
          status: 'ok',
          added: pulled.added,
          pushed: Object.keys(questions).filter((key) => !BANK_META_KEYS.has(key)).length,
        };
      } catch (err) {
        return { error: `Sync failed: ${err.message}` };
      }
    }

case 'getAnswerKey': {
  const { question, options = [] } = payload;
  const maxHits = cfg('ANSWER_KEY_MAX_HITS') || 4;
  const search = async (term) => {
    const url = `https://amauoed.com/search?query=${encodeURIComponent(term.slice(0, 300))}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (cfg('ANSWER_KEY_TIMEOUT') || 4) * 1000);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AmaBot/1.0)' },
        signal: controller.signal,
      });
      return response.ok ? parseAnswerKeyHtml(await response.text(), maxHits) : [];
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let hits = await search((question || '').slice(0, 300));
    if (!hits.length) {
      const fallback = fallbackQuestionQuery(question);
      if (fallback && fallback.toLowerCase() !== (question || '').toLowerCase()) {
        hits = await search(fallback);
      }
    }
    return {
      _reqId,
      hits: hits.map((hit) => ({ ...hit, optionScore: scoreAnswerKeyHit(hit, options) }))
        .sort((a, b) => b.optionScore - a.optionScore),
    };
  } catch (err) {
    return { _reqId, hits: [] };
  }
    }

    case 'SEARCH_WEB_SNIPPETS': {
      // Fast, best-effort DuckDuckGo scrape used by askAiText() as a last hint
      // source for short-answer questions missing from both the local bank and
      // amauoed.com. Hard 4 s cap; any failure (network error, abort/timeout,
      // anti-bot page, empty HTML) resolves with text: '' so the AI stage in
      // providers.js runs exactly as it did before — nothing is ever thrown
      // back at the caller.
      const { query, maxResults } = payload;
      const term = String(query || '').replace(/\s+/g, ' ').trim();
      if (!term) return { _reqId, text: '' };
      const limit = Math.min(Math.max(Number(maxResults) || 3, 1), 5);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(term.slice(0, 400))}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuizStudyBot/1.0)' },
          signal: controller.signal,
        });
        if (!response.ok) return { _reqId, text: '' };
        const html = await response.text();
        const snippets = [];
        const seen = new Set();
        const snippetRe = /<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/gi;
        for (const match of html.matchAll(snippetRe)) {
          if (snippets.length >= limit) break;
          const snippet = stripHtml(match[1]).slice(0, 400).trim();
          if (!snippet || seen.has(snippet)) continue;
          seen.add(snippet);
          snippets.push(`${snippets.length + 1}. ${snippet}`);
        }
        return { _reqId, text: snippets.join('\n') };
      } catch {
        return { _reqId, text: '' };
      } finally {
        clearTimeout(timer);
      }
    }

    case 'searchWeb': {
      const { query, maxResults } = payload;
  const limit = maxResults || 3;
  const snippets = [];
      try {
    const searchQuery = `site:amauoed.com OR site:quizlet.com OR site:studocu.com ${query}`;
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    const ddgController = new AbortController();
    const ddgTimer = setTimeout(() => ddgController.abort(), 8000);
    try {
      const ddgResponse = await fetch(ddgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuizStudyBot/1.0)' },
        signal: ddgController.signal,
      });
      if (ddgResponse.ok) {
        const html = await ddgResponse.text();
        const blocks = html.split(/<div[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>/i).slice(1);
        for (const block of blocks) {
          if (snippets.length >= limit) break;
          const titleMatch = block.match(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
          const snippetMatch = block.match(/<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
          const title = titleMatch ? stripHtml(titleMatch[1]) : '';
          const snippet = snippetMatch ? stripHtml(snippetMatch[1]).slice(0, 900) : '';
          if (snippet) snippets.push(`Title: ${title}\nContent: ${snippet}`);
        }
      }
    } catch (err) {
      console.warn('[searchWeb] DuckDuckGo search failed:', err.message);
    } finally {
      clearTimeout(ddgTimer);
    }

        const encoded = encodeURIComponent(query);
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&utf8=1&format=json`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let response;
        try {
          response = await fetch(wikiUrl, {
            headers: { 'User-Agent': 'QuizStudyBot/1.0' },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (response.ok) {
          const json = await response.json();
          for (const item of (json.query?.search || []).slice(0, limit)) {
            if (snippets.length >= limit * 2) break;
            const title = (item.title || '').trim();
            const snippet = stripHtml(item.snippet || '').slice(0, 900);
            if (snippet) snippets.push(`Title: ${title}\nContent: ${snippet}`);
          }
        }
        return { _reqId, text: snippets.join('\n\n---\n\n') };
      } catch (err) {
        return { _reqId, text: snippets.join('\n\n---\n\n') };
      }
    }

    case 'checkOllama': {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(`${cfg('OLLAMA_URL')}/api/tags`, { signal: controller.signal });
        clearTimeout(timer);
        return { _reqId, ok: response.ok };
      } catch (err) {
        return { _reqId, ok: false };
      }
    }

    case 'SYNC_GITHUB_BANK': {
      const owner = String(cfg('GITHUB_BANK_OWNER') || '').trim();
      const repo = String(cfg('GITHUB_BANK_REPO') || '').trim();
      const bankPath = String(cfg('GITHUB_BANK_PATH') || 'bank.json').trim() || 'bank.json';
      const token = String(cfg('GITHUB_SYNC_TOKEN') || '').trim();
      if (!owner || !repo) return { _reqId, status: 'skipped' };
      const result = await syncGitHubBank(owner, repo, bankPath, token);
      return { _reqId, ...result };
    }

    case 'CHECK_EXTENSION_UPDATE': {
      // Cached for 6 hours unless the caller forces a fresh GitHub lookup.
      const force = payload.force !== undefined ? !!payload.force : !!message.force;
      const status = await getExtensionUpdateStatus(force);
      return { _reqId, ...status };
    }

    default:
      return { _reqId, error: `Unknown action: ${action}` };
  }
}

// Load config on startup
const configReady = loadConfig();