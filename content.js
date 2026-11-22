let _stopRequested = false, _loopActive = false, _hudShadow = null, _hudRoot = null, _lastExtractionWarning = '';
const _autoHarvestRequested = new Set();
const HARVEST_STOP_WORDS = new Set([
  'a', 'an', 'and', 'of', 'the', 'for', 'in', 'its', 'to', 'with',
  'introduction', 'principles', 'applications', 'fundamentals',
]);

// ── Update banner (GitHub) ───────────────────────────────────────────────────
// The service worker compares its manifest version with the repo's manifest.json
// (cached 6 h). When GitHub has something newer, a green "Update vX.Y.Z" badge
// appears in the HUD header and downloads the ZIP in one click. Fully cosmetic.
const UPDATE_ZIP_URL = 'https://github.com/ambotlangnimo/moodle-quiz-bot/archive/refs/heads/main.zip';
let _updateInfo = null;

// Reveal the green badge. Safe to call before createHUD(): the info is cached and
// replayed once the HUD exists.
function showUpdateBadge(info) {
  if (!info || !info.latestVersion) return;
  _updateInfo = info;
  const badge = _hudShadow?.getElementById('hud-update-badge');
  if (!badge) return;
  const version = String(info.latestVersion).trim().replace(/^v/i, '');
  if (!version) return;
  badge.href = info.downloadUrl || UPDATE_ZIP_URL;
  badge.textContent = 'Update v' + version;
  badge.title = 'Download v' + version + ' ZIP (installed v' + (info.currentVersion || '?') + ')';
  badge.hidden = false;
}

// Ask the service worker for the GitHub status. force=true skips its 6-hour cache.
function requestUpdateCheck(force) {
  try {
    chrome.runtime.sendMessage({ action: 'CHECK_EXTENSION_UPDATE', force: !!force }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      if (response.updateAvailable) showUpdateBadge(response);
    });
  } catch (error) { /* background restarting: the next page load retries */ }
}

function createHUD() {
  if (_hudRoot) return;
  _hudRoot = document.createElement('div');
  _hudRoot.id = 'moodle-quiz-bot-hud';
  _hudShadow = _hudRoot.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  fetch(chrome.runtime.getURL('hud.css')).then(r=>r.text()).then(c=>{style.textContent=c;}).catch(()=>{});
  _hudShadow.appendChild(style);
  const root = document.createElement('div'); root.id = 'hud-root';
  root.innerHTML = '<div id="hud-header"><span id="hud-title">Quiz Bot</span><a id="hud-update-badge" href="https://github.com/ambotlangnimo/moodle-quiz-bot/archive/refs/heads/main.zip" target="_blank" rel="noopener" hidden>Update</a><span id="hud-status">idle</span></div><div id="hud-body"></div><div id="hud-footer"><button class="hud-btn" id="hud-stop-btn">Stop</button><button class="hud-btn" id="hud-clear-btn">Clear</button><button class="hud-btn" id="hud-harvest-btn">Harvest</button><button class="hud-btn" id="hud-toggle-btn">Run</button></div>';
  _hudShadow.appendChild(root); document.body.appendChild(_hudRoot);
  // Badge styling lives here (not hud.css) so the banner still looks right if the
  // stylesheet fetch is slow or fails.
  const updateStyle = document.createElement('style');
  updateStyle.textContent = `
#hud-update-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 10px;
  background: #16a34a;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
}
#hud-update-badge:hover { background: #15803d; }
#hud-update-badge:active { background: #166534; }`;
  _hudShadow.appendChild(updateStyle);
  const updateBadge = _hudShadow.getElementById('hud-update-badge');
  if (updateBadge) {
    // Stop the header drag handler from swallowing the click.
    updateBadge.onmousedown = (event) => event.stopPropagation();
    updateBadge.onclick = () => {
      const info = _updateInfo || {};
      const version = String(info.latestVersion || '').trim().replace(/^v/i, '') || 'latest';
      // The anchor href itself opens the ZIP download in a new tab.
      logHUD('success', 'Update v' + version + ' downloaded! Extract over your extension folder and click Reload in brave://extensions.');
    };
  }
  if (_updateInfo) showUpdateBadge(_updateInfo);
  requestUpdateCheck(false);
  _hudShadow.getElementById('hud-stop-btn').onclick = () => { _stopRequested = true; logHUD('error','Stop'); };
  _hudShadow.getElementById('hud-clear-btn').onclick = () => { _hudShadow.getElementById('hud-body').innerHTML = ''; };
  _hudShadow.getElementById('hud-harvest-btn').onclick = () => { requestCourseHarvest(true); harvestCourseReviews(true); };
  _hudShadow.getElementById('hud-toggle-btn').onclick = () => { _loopActive ? (_stopRequested=true) : startLoop(); };
  let dg = false, sx, sy, ox, oy;
  const hdr = _hudShadow.getElementById('hud-header');
  hdr.onmousedown = (e) => { dg = true; sx = e.clientX; sy = e.clientY; ox = _hudRoot.offsetLeft; oy = _hudRoot.offsetTop; document.onmousemove = (me) => { if (!dg) return; _hudRoot.style.left = (ox+me.clientX-sx)+'px'; _hudRoot.style.top = (oy+me.clientY-sy)+'px'; _hudRoot.style.right='auto'; _hudRoot.style.bottom='auto'; }; document.onmouseup = () => { dg = false; document.onmousemove=null; document.onmouseup=null; }; };
}

function logHUD(lvl, txt) {
  const b = _hudShadow?.getElementById('hud-body'); if (!b) return;
  const e = document.createElement('div'); e.className='hud-log-line '+lvl; e.textContent='['+new Date().toLocaleTimeString()+'] '+txt;
  b.appendChild(e); b.scrollTop = b.scrollHeight;
  console.log('[HUD/'+lvl+'] '+txt);
  try { chrome.runtime.sendMessage({action:'log',level:lvl,text:txt}); } catch(ex) {}
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'AUTO_HARVEST_PROGRESS') {
    logHUD(message.level || 'info', message.text || 'Course answer harvesting is running.');
  }
  // Service-worker broadcast: a newer build is on GitHub right now.
  if (message && message.type === 'EXTENSION_UPDATE_AVAILABLE' && message.updateAvailable !== false) {
    showUpdateBadge(message);
  }
});

function cleanCourseTitle(value) {
  return (value || '')
    .replace(/\bUGRD-[A-Z0-9-]+\b/gi, ' ')
    .replace(/\bSEMESTRALEXAM\s+\d{4}[A-Z]?\b/gi, ' ')
    .replace(/\s*(?:[-–—]\s*)?\b\d{4}[A-Z]?\s*$/i, ' ')
    .replace(/\s*[|–—]\s*Moodle\s*$/i, '')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/^\s*[-:|–—]+\s*|\s*[-|]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeReviewText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// ── Superscript / subscript / Moodle image normalization ────────────────────
// Moodle renders exponents and indices as <sup>/<sub> nodes. Converting them to
// real unicode characters ("2<sup>3</sup>" -> "2³", "10<sub>2</sub>" -> "10₂")
// means a typed "2³" and a marked-up one produce the same bank key, and
// `normText()` folds both back to plain digits. pluginfile.php URLs carry an
// attempt-specific id, so images become the stable `[moodle-asset:file]` token.
function scriptToken(tagName, raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const tag = String(tagName || '').toUpperCase();
  const map = tag === 'SUB' ? SUB_MAP : SUP_MAP;
  if ([...text].every((ch) => Object.prototype.hasOwnProperty.call(map, ch))) {
    return [...text].map((ch) => map[ch]).join('');
  }
  return (tag === 'SUB' ? '_{' : '^{') + text + '}';
}

function imageTokenFor(img) {
  if (!img) return '';
  const src = img.getAttribute('src') || img.getAttribute('data-src') || img.src || '';
  const alt = String(img.getAttribute('alt') || '').trim();
  const token = moodleAssetToken(src);
  if (token) return alt ? `[Image: ${alt} - ${token}]` : `[Image: ${token}]`;
  return alt ? `[Image: ${alt}]` : '';
}

// Replace <sup>/<sub>/<img> inside a cloned DOM node with their text equivalents.
function replaceScriptsAndImages(root) {
  if (!root || !root.querySelectorAll) return root;
  const doc = root.ownerDocument || document;
  root.querySelectorAll('sup').forEach((node) => {
    node.replaceWith(doc.createTextNode(scriptToken('SUP', node.textContent || '')));
  });
  root.querySelectorAll('sub').forEach((node) => {
    node.replaceWith(doc.createTextNode(scriptToken('SUB', node.textContent || '')));
  });
  root.querySelectorAll('img').forEach((img) => {
    const token = imageTokenFor(img);
    img.replaceWith(doc.createTextNode(token ? ' ' + token + ' ' : ''));
  });
  return root;
}

// Clean text of one DOM node: strips helper markup, folds sup/sub/images, then
// collapses whitespace. Used for statements, choices and answers so the stored
// key and the next attempt's prompt are produced by the same code path.
function cleanNodeText(node, stripSelector) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  if (stripSelector && clone.querySelectorAll) {
    clone.querySelectorAll(stripSelector).forEach((child) => child.remove());
  }
  replaceScriptsAndImages(clone);
  return normalizeReviewText(clone.innerText || clone.textContent || '');
}

// Parse a Moodle 4.x review question. Normalises whitespace in ".info"/".grade"
// before matching "Mark X out of Y", and falls back to the correctness
// indicators used by AMA's theme (.que.correct, "Your answer is correct",
// .qnbutton.correct / title containing "Correct").
// Returns { earned, max, correct } or null when there is no signal at all.
function parseGradeFromReview(scope) {
  const root = scope || document;
  let infoText = '';
  for (const node of root.querySelectorAll('.info, .grade')) {
    infoText += ' ' + (node.innerText || node.textContent || '');
  }
  infoText = normalizeReviewText(infoText);
  if (!infoText && root.innerText) infoText = normalizeReviewText(root.innerText);

  let earned = null;
  let max = null;
  const m = infoText.match(/Mark\s*([0-9.]+)\s*out of\s*([0-9.]+)/i);
  if (m) {
    earned = parseFloat(m[1]);
    max = parseFloat(m[2]);
  }

  // Grade numbers are authoritative when present: 1.00/1.00 -> right, 0.00/1.00 -> wrong.
  let correct = null;
  if (earned !== null && max !== null && !Number.isNaN(earned) && !Number.isNaN(max)) {
    correct = earned !== 0 && earned >= max;
  }

  // Fallback indicators when the numeric grade is missing or unparsable.
  if (correct === null) {
    const text = normalizeReviewText(root.innerText || root.textContent || '');
    const cls = new Set(String((root !== document && root.className) || '').toLowerCase().split(/\s+/));
    if (/Your answer is correct/i.test(text)) correct = true;
    else if (/Your answer is (?:incorrect|partially correct)/i.test(text)) correct = false;
    else if (root.querySelector('.que.correct')) correct = true;
    else if (cls.has('correct') && !cls.has('partiallycorrect')) correct = true;
    else if (cls.has('incorrect') || cls.has('partiallycorrect')) correct = false;
    else {
      const nav = root.querySelector ? root.querySelector('.qnbutton') : null;
      if (nav) {
        const navCls = String(nav.className || '').toLowerCase();
        const title = nav.getAttribute('title') || '';
        if (/partiallycorrect|incorrect/.test(navCls) || /incorrect/i.test(title)) correct = false;
        else if (/correct/.test(navCls) || /correct/i.test(title)) correct = true;
      }
    }
  }

  if (earned === null && correct === null) return null;
  return { earned, max, correct };
}

function isReviewPage(){
  return location.pathname.includes('/mod/quiz/review.php');
}

async function saveCorrectAnswerFromReview(question, answer){
  if(!answer||!answer.trim())return false;
  const key = normText(question);
  const value = answer.trim();
  if(!key||!value)return false;
  const hits = await answerKeyGet(key);
  const answerNorm = normText(value);
  if(!hits.some((hit) => hit && normText(hit.answer)===answerNorm)){
    await answerKeyPut(key, value, 'learned-review', { verified: true });
    return true;
  }
  return false;
}

// Ask the background worker to push the (verified) local bank to GitHub.
// Debounced so a burst of learned answers results in a single push.
let _gitHubPushTimer = null;
function requestGitHubBankPush(){
  if (_gitHubPushTimer) return;
  _gitHubPushTimer = setTimeout(async () => {
    _gitHubPushTimer = null;
    try {
      await flushNow();
      chrome.runtime.sendMessage({ action: 'SYNC_GITHUB_BANK' }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (!resp) return;
        if (resp.error) { logHUD('warn', 'GitHub push: ' + resp.error); return; }
        if (resp.status === 'ok') logHUD('info', `GitHub bank pushed (${resp.pushed || 0} questions)`);
      });
    } catch (e) { /* extension context may have been invalidated */ }
  }, 1000);
}

function isGenericHarvestTitle(value) {
  const raw = String(value || '');
  const title = cleanCourseTitle(raw);
  const normalized = normText(title);
  return !normalized ||
    /^\s*UGRD-[A-Z0-9-]+\s*$/i.test(raw) ||
    /^(?:(?:quiz|seatwork|assignment)\s+)?(?:prelim|midterm|final)\s+exam(?:\s+\d+)?$/.test(normalized) ||
    /^(?:quiz|seatwork|assignment)(?:\s+\d+)?$/.test(normalized) ||
    /^2612s?$/.test(normalized);
}

function courseIdFromHref(href) {
  try {
    return new URL(href, location.origin).searchParams.get('id') || '';
  } catch (error) {
    return '';
  }
}

function visibleCourseTopics() {
  const topics = [];
  const seen = new Set();
  for (const node of document.querySelectorAll('.sectionname, .activityname')) {
    let visible = false;
    try {
      const style = getComputedStyle(node);
      visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    } catch (error) {
      visible = node.getClientRects().length > 0;
    }
    if (!visible) continue;
    const topic = cleanCourseTitle(node.textContent || node.innerText);
    const key = normText(topic);
    if (!key || isGenericHarvestTitle(topic) || seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
    if (topics.length === 5) break;
  }
  return topics;
}

function buildHarvestKeywords(values) {
  const keywords = [];
  const seen = new Set();
  for (const value of values) {
    if (isGenericHarvestTitle(value)) continue;
    const words = cleanCourseTitle(value).toLowerCase()
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

async function saveCourseTitlesFromLinks() {
  const stored = await chrome.storage.local.get('courseTitlesMap');
  const courseTitlesMap = stored.courseTitlesMap && typeof stored.courseTitlesMap === 'object'
    ? stored.courseTitlesMap
    : {};
  const titles = { ...courseTitlesMap };
  for (const link of document.querySelectorAll('a[href*="/course/view.php?id="]')) {
    const courseId = courseIdFromHref(link.href);
    const title = cleanCourseTitle(link.textContent || link.innerText || link.getAttribute('aria-label'));
    if (!courseId || isGenericHarvestTitle(title)) continue;
    titles[courseId] = title;
  }
  await chrome.storage.local.set({ courseTitlesMap: titles });
  return titles;
}

async function saveCourseMetadata(courseId, title, topics) {
  if (!courseId || !title) return;
  const stored = await chrome.storage.local.get(['courseTitlesMap', 'courseTopicsMap']);
  const courseTitlesMap = {
    ...(stored.courseTitlesMap && typeof stored.courseTitlesMap === 'object' ? stored.courseTitlesMap : {}),
    [courseId]: title,
  };
  const courseTopicsMap = {
    ...(stored.courseTopicsMap && typeof stored.courseTopicsMap === 'object' ? stored.courseTopicsMap : {}),
  };
  if (topics && topics.length) courseTopicsMap[courseId] = topics;
  await chrome.storage.local.set({ courseTitlesMap, courseTopicsMap });
}

async function courseHarvestInfo() {
  const pathname = location.pathname || '';
  // Use .includes()/.endsWith() so term-prefixed paths (e.g. /2612/my/) match too.
  if (pathname === '/my' || pathname.includes('/my/') || pathname.endsWith('/my')) {
    await saveCourseTitlesFromLinks();
    return null;
  }
  const isGradesPage = pathname.includes('/grade/report/user/index.php');
  const isCoursePage = pathname.includes('/course/view.php') || isGradesPage;
  const isQuizPage = pathname.includes('/mod/quiz/view.php') || pathname.includes('/mod/quiz/attempt.php');
  if (!isCoursePage && !isQuizPage) return null;
  if (isCoursePage) await saveCourseTitlesFromLinks();
  const heading = document.querySelector('.page-header-headings h1');
  const breadcrumb = document.querySelector('.breadcrumb a[href*="/course/view.php"]');
  const courseUrl = isCoursePage
    ? location.href
    : breadcrumb && breadcrumb.href;
  const courseId = courseIdFromHref(courseUrl || '');
  const stored = await chrome.storage.local.get(['courseTitlesMap', 'courseTopicsMap']);
  const courseTitlesMap = stored.courseTitlesMap && typeof stored.courseTitlesMap === 'object'
    ? stored.courseTitlesMap
    : {};
  const courseTopicsMap = stored.courseTopicsMap && typeof stored.courseTopicsMap === 'object'
    ? stored.courseTopicsMap
    : {};
  let title = '';
  const candidates = isCoursePage
    ? [heading && heading.textContent, courseTitlesMap[courseId],
      breadcrumb && breadcrumb.textContent, document.title]
    : [courseTitlesMap[courseId],
      breadcrumb && breadcrumb.textContent, heading && heading.textContent, document.title];
  for (const candidate of candidates) {
    const cleaned = cleanCourseTitle(candidate || '');
    if (!isGenericHarvestTitle(candidate || cleaned)) {
      title = cleaned;
      break;
    }
  }
  const courseKey = normText(title);
  if (!title && !courseId) return null;
  const moduleTopics = [
    ...(Array.isArray(courseTopicsMap[courseId]) ? courseTopicsMap[courseId] : []),
    ...visibleCourseTopics(),
  ];
  const topics = [];
  const topicKeys = new Set();
  for (const candidate of moduleTopics) {
    const topic = cleanCourseTitle(candidate);
    const key = normText(topic);
    if (!key || isGenericHarvestTitle(topic) || topicKeys.has(key)) continue;
    topicKeys.add(key);
    topics.push(topic);
  }
  const keywords = buildHarvestKeywords([title, ...topics]);
  if (isCoursePage && title) await saveCourseMetadata(courseId, title, topics);
  return {
    courseId,
    courseKey,
    title,
    moduleTopics: topics,
    keywords,
    courseUrl: courseUrl ? new URL(courseUrl, location.origin).href : '',
  };
}

async function requestCourseHarvest(force = false) {
  let info;
  try {
    info = await courseHarvestInfo();
  } catch (error) {
    logHUD('warn', 'Could not resolve course for harvesting: ' + error.message);
    return false;
  }
  if (!info) {
    if (force) logHUD('warn', 'Open a Moodle course or quiz page to harvest its answer bank.');
    return false;
  }
  const requestKey = info.courseId || info.courseKey;
  if (!force && _autoHarvestRequested.has(requestKey)) return true;
  if (!force) _autoHarvestRequested.add(requestKey);
  const message = {
    type: 'AUTO_HARVEST',
    courseId: info.courseId,
    courseKey: info.courseKey,
    courseTitle: info.title,
    courseUrl: info.courseUrl,
    moduleTopics: info.moduleTopics,
    keywords: info.keywords,
  };
  if (force) message.force = true;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        logHUD('warn', 'Course harvesting request failed: ' + chrome.runtime.lastError.message);
      } else if (response && response.error) {
        logHUD('warn', 'Course harvesting failed: ' + response.error);
      }
    });
    return true;
  } catch (error) {
    logHUD('warn', 'Course harvesting request failed: ' + error.message);
    return false;
  }
}

function startAutoHarvest() {
  requestCourseHarvest(false);
  // Course / grades pages also learn from every completed quiz's review page,
  // once per course (6 h throttle), then push the new pairs to GitHub.
  const pathname = location.pathname || '';
  if (pathname.includes('/course/view.php') || pathname.includes('/grade/report/user/index.php')) {
    setTimeout(() => { harvestCourseReviews(false).catch(() => {}); }, 2500);
  }
}

function addResultEntry(q, t, a, s) {
  const b = _hudShadow?.getElementById('hud-body'); if (!b) return;
  const e = document.createElement('div'); e.className='hud-entry';
  e.innerHTML = '<div class="q-text">'+esc(q.slice(0,80))+'</div><div class="q-result"><span class="q-tier">'+esc(t)+'</span><span class="q-answer">'+esc(a)+'</span><span class="q-score">'+(s||'')+'</span></div>';
  b.appendChild(e); b.scrollTop = b.scrollHeight;
}

function setHUDStatus(s) { const e = _hudShadow?.getElementById('hud-status'); if (e) { e.textContent = s; e.className = s; } }
function esc(s) { return (s||'').replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

function getQContainers() { return Array.from(document.querySelectorAll('div.que')).filter(d => !d.parentElement?.closest('div.que')); }
function qSig(c) { return c.id || normText(qTxt(c)).slice(0,120); }
function qTxt(c) {
  const BLOCK = new Set(['P','DIV','LI','UL','OL','BR','TR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','TABLE']);
  const SKIP = new Set(['SCRIPT','STYLE','BUTTON','NOSCRIPT']);
  const SKIP_CLASSES = new Set(['info','outcome','feedback','rightanswer','qno','state','grade','questionflag']);
  const extract = (root) => {
    let output = '';
    const walk = (node) => {
      if (node.nodeType === 3) { output += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (SKIP.has(tag)) return;
      const className = String(node.className || '');
      if (className.split(/\s+/).some((name) => SKIP_CLASSES.has(name))) return;
      if (/\bsr-only|visually-hidden|accesshide|answerlabel\b/.test(className)) return;
      if (tag === 'SUP' || tag === 'SUB') { output += scriptToken(tag, node.textContent || ''); return; }
      if (tag === 'IMG') {
        const token = imageTokenFor(node);
        if (token) output += ' ' + token + ' ';
        return;
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { output += ' ______ '; return; }
      const isBlock = BLOCK.has(tag);
      if (isBlock) output += '\n';
      for (const child of node.childNodes) walk(child);
      if (isBlock) output += '\n';
    };
    walk(root);
    const lines = [];
    const seen = new Set();
    for (const line of output.split('\n')) {
      const text = line.replace(/\s+/g,' ').trim();
      const normalized = text.toLowerCase();
      if (!text || seen.has(normalized)) continue;
      seen.add(normalized);
      lines.push(text);
    }
    return lines.join('\n').slice(0,1200);
  };
  const questionText = Array.from(c.querySelectorAll('.qtext'));
  const preferred = questionText.length ? questionText : Array.from(c.querySelectorAll('.formulation'));
  for (const node of preferred) {
    const text = extract(node);
    if (text) return text;
  }
  return extract(c);
}
function elemSig(els) { if (!els||!els.length) return ''; const c = els[0].closest('div[class*="que"]'); return c ? qSig(c) : ''; }
function optLabel(el){
  const textFrom=(node)=>{
    if(!node)return'';
    return cleanNodeText(node, 'input, script, style, .sr-only, .accesshide, .answernumber, select');
  };
  const labels=[];
  if(el.id){try{const label=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(label)labels.push(label);}catch(e){}}
  try{const label=el.closest('label');if(label&&!labels.includes(label))labels.push(label);}catch(e){}
  for(const label of labels){const text=textFrom(label);if(text)return text;}
  if(el.parentElement){
    try{
      const answerLabel=el.parentElement.querySelector('[data-region="answer-label"], .flex-fill, .ml-1, .answertext');
      const text=textFrom(answerLabel);
      if(text)return text;
    }catch(e){}
  }
  let row=el.parentElement;
  while(row){
    const text=textFrom(row);
    if(text)return text;
    if(/(^|\s)r[01](\s|$)/.test(String(row.className||'')))break;
    row=row.parentElement;
  }
  return'';
}
function optTxt(el){let t=optLabel(el);if(t){t=t.replace(/\s+/g,' ').replace(/^[a-dA-D][.)]\s*/,'');return t.trim();}return (el.getAttribute('value')||'').trim();}
function xtractOpts(radios){const txts=[],els=[];for(const r of radios){if((r.getAttribute('value')||'')==='-1')continue;const t=optTxt(r);if(t){txts.push(t);els.push(r);}}return{txts,els};}
function isQuizPg(){return getQContainers().length>0||!!document.querySelector('form#responseform, #mod_quiz-next-nav, #mod_quiz-finish-nav, .que, input[type="radio"][name^="q"]');}
function isReviwPg(){return (typeof location!=='undefined'&&location.pathname.includes('/review.php'))||!!document.querySelector('.rightanswer, .reviewsummary, .que.correct, .que.incorrect, .que.partiallycorrect, .outcome .feedback');}const NAV_S = '__navigating__';

// ── Matching questions (.que.match) ─────────────────────────────────────────
// Every <select> sits in its own row whose prompt is the sub-statement to
// complete ("Computer security and cybersecurity are both children of ______").
// "Match the term/details to complete each statement." only describes the whole
// block, so keying answers by it would blend every pair together — each row is
// stored/retrieved under its own sub-statement instead.
const MATCH_CELL_SKIP = /(^|\s)(control|feedback|feedbackspan|state|grade|outcome|rightanswer|correctanswer)(\s|$)/i;

// Dropdowns that belong to the matching block (navigation/attempt controls
// inside the same .que are ignored so they can never be mistaken for a row).
function matchingSelects(container) {
  if (!container || !container.querySelectorAll) return [];
  return Array.from(container.querySelectorAll('div.answer select, .answer select, select'))
    .filter((select) => !select.closest('.im-controls, .submitbtns, .submitbuttons, .quiznavigation'));
}

// True for `qtype_match` blocks: `.que.match`, or several dropdowns laid out as
// `table.answer tr` / `.answer .row` pairs. Inline "select missing word" blanks
// are not rows, so they keep the legacy resolver.
function isMatchingBlock(container) {
  if (!container) return false;
  if (/(^|\s)match(\s|$)/i.test(String(container.className || ''))) return true;
  return !!container.querySelector('table.answer tr select, .answer .row select, .answer .r0 select, .answer .r1 select');
}

// Data rows of a matching block. Review pages render graded rows as text (no
// live <select> anymore), so a row with an answer/feedback cell still counts.
function matchingRowElements(container) {
  if (!container || !container.querySelectorAll) return [];
  return Array.from(container.querySelectorAll('table.answer tr, .answer .row, .answer .r0, .answer .r1'))
    .filter((row) => {
      const cells = Array.from(row.children || []).filter((child) => String(child.tagName || '').toUpperCase() === 'TD');
      if (!cells.length) return false;
      if (row.querySelector('select')) return true;
      return !!row.querySelector('.rightanswer, .correctanswer, .feedback, .answer');
    });
}

// The row element that carries one statement + its dropdown. Moodle uses
// `table.answer tr` (4.x) and some themes use `.answer .row` divs.
function matchingRowRoot(selectEl) {
  if (!selectEl) return null;
  try {
    const row = selectEl.closest('tr');
    if (row) return row;
  } catch (error) { /* closest() unavailable on exotic nodes */ }
  let node = selectEl.parentElement;
  let fallback = node || selectEl;
  let depth = 0;
  while (node && depth < 6) {
    if (node.querySelectorAll && node.querySelectorAll('select').length > 1) break;
    if (/(^|\s)(row|r0|r1|answerrow|answer)(\s|$)/i.test(String(node.className || ''))) return node;
    fallback = node;
    node = node.parentElement;
    depth += 1;
  }
  return fallback;
}

// Text of the statement cell only: the dropdown cell, the feedback cell and the
// graded "The correct answer is..." block are never part of the key.
const MATCH_STRIP_SELECTOR = 'select, input, button, script, style, .rightanswer, .correctanswer, .feedback, .feedbackspan, .state, .grade, .icon, .accesshide, .answernumber, .sr-only, .useranswer';

function statementTextFrom(node) {
  return cleanNodeText(node, MATCH_STRIP_SELECTOR);
}

function statementFromRowRoot(rowRoot, selectEl) {
  if (!rowRoot) return '';
  let parts = [];
  if (rowRoot.tagName === 'TR') parts = Array.from(rowRoot.children);
  else if (rowRoot.querySelectorAll) parts = Array.from(rowRoot.querySelectorAll(':scope > *'));
  for (const part of parts) {
    if (!part || part.nodeType !== 1) continue;
    if (selectEl && (part === selectEl || part.contains(selectEl))) continue;
    if (MATCH_CELL_SKIP.test(String(part.className || ''))) continue;
    if (part.querySelector && part.querySelector('select')) continue;
    const text = statementTextFrom(part);
    if (text) return text;
  }
  return statementTextFrom(rowRoot);
}

// Normalise one row prompt into a stable lookup key: numbering and leaked
// "Choose..." placeholder text are dropped, the blank itself is kept so the
// statement stays readable, and meaningless rows (letters/digits only) are
// rejected.
function cleanSubStatement(raw) {
  let text = normalizeReviewText(raw);
  if (!text) return '';
  text = text.replace(PLACEHOLDER_RE, ' ');
  // Graded feedback ("The correct answer is: ...") is never part of the prompt.
  text = text.replace(/\s*(?:the\s+)?correct\s+answer\s+is\s*:.*$/i, ' ');
  text = text.replace(/\s*correct\s+answer\s*:.*$/i, ' ');
  text = text.replace(/^[-\u2013\u2014(\[]?\s*\d{1,2}\s*[.)\]:]\s*/, '');
  text = text.replace(/\s+(?:choose\.{2,}.*|select one.*)$/i, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.replace(/[\s\d_\-.,;:()\[\]]/g, '').length < 8) return '';
  return text.slice(0, 300);
}

// Build one record per dropdown: { rowIndex, element, rowRoot, subStatement }.
// `rowIndex` is the 1-based row number used in prompts, logs and the batch JSON.
// Items may be dropdowns (attempt page) or row elements (review pages, where a
// row can render its answer as text instead of a disabled <select>).
function collectMatchingRows(elements, questionText) {
  const lines = String(questionText || '')
    .split('\n')
    .map((line) => normalizeReviewText(line))
    .filter(Boolean);
  const rows = [];
  for (let index = 0; index < elements.length; index += 1) {
    const unit = elements[index];
    const isSelect = !!unit && String(unit.tagName || '').toUpperCase() === 'SELECT';
    const rowRoot = isSelect ? matchingRowRoot(unit) : unit;
    const selectEl = isSelect ? unit : (rowRoot && rowRoot.querySelector ? rowRoot.querySelector('select') : null);
    rows.push({
      rowIndex: index + 1,
      element: selectEl || unit,
      rowRoot,
      subStatement: cleanSubStatement(statementFromRowRoot(rowRoot, selectEl)),
    });
  }
  // Themes that render every statement inside .qtext still work: unused blank
  // lines are handed to rows whose own cell carried no prompt text.
  const used = new Set(rows.map((row) => normText(row.subStatement)).filter(Boolean));
  const spare = lines.filter((line) => BLANK_RE.test(line) && !used.has(normText(line)));
  let cursor = 0;
  for (const row of rows) {
    if (row.subStatement) continue;
    while (cursor < spare.length && used.has(normText(spare[cursor]))) cursor += 1;
    if (cursor >= spare.length) break;
    const statement = cleanSubStatement(spare[cursor]);
    cursor += 1;
    if (!statement || used.has(normText(statement))) continue;
    row.subStatement = statement;
    used.add(normText(statement));
  }
  const statements = new Set(rows.map((row) => normText(row.subStatement)).filter(Boolean));
  const header = lines.filter((line) => !statements.has(normText(line))).join(' ').slice(0, 300);
  return { rows, header };
}

// "also information security" is a different choice from "information
// security": a near-duplicate must never be used for a row that asks for the
// shorter phrase when the exact item is already taken.
function isNearDuplicateVariant(target, candidate) {
  if (!target || !candidate || target === candidate) return false;
  const targetWords = target.split(' ');
  const candidateWords = candidate.split(' ');
  if (targetWords.length >= candidateWords.length) return false;
  return targetWords.every((word) => candidateWords.includes(word));
}

// Map an item text onto the shared option list. `exclude` holds option indexes
// already taken by another row so a 1-to-1 assignment is preserved.
function matchingOptionIndex(text, options, exclude) {
  const target = normText(text);
  if (!target || !options || !options.length) return -1;
  const blocked = exclude || new Set();
  for (let index = 0; index < options.length; index += 1) {
    if (blocked.has(index)) continue;
    if (normText(options[index]) === target) return index;
  }
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < options.length; index += 1) {
    if (blocked.has(index)) continue;
    const candidate = normText(options[index]);
    if (!candidate || isNearDuplicateVariant(target, candidate)) continue;
    const score = similarity(target, candidate);
    if (score > bestScore) { best = index; bestScore = score; }
  }
  return best !== -1 && bestScore >= 0.8 ? best : -1;
}

// Item currently chosen in one dropdown, mapped back onto the shared list.
function currentMatchingOptionIndex(selectEl, options) {
  if (!selectEl || !selectEl.options || selectEl.selectedIndex < 0) return -1;
  const option = selectEl.options[selectEl.selectedIndex];
  if (!option || !option.value || option.value === '0') return -1;
  return matchingOptionIndex(option.text, options, new Set());
}

function setMatchingSelect(selectEl, optionText) {
  if (!selectEl || !selectEl.options) return false;
  const target = normText(optionText);
  if (!target) return false;
  let chosen = null;
  for (const option of selectEl.options) {
    if (!option.value || option.value === '0') continue;
    if (normText(option.text) === target) { chosen = option; break; }
  }
  if (!chosen) {
    let bestScore = 0;
    for (const option of selectEl.options) {
      if (!option.value || option.value === '0') continue;
      const candidate = normText(option.text);
      if (!candidate || isNearDuplicateVariant(target, candidate)) continue;
      const score = similarity(target, candidate);
      if (score > bestScore) { chosen = option; bestScore = score; }
    }
    if (bestScore < 0.72) chosen = null;
  }
  if (!chosen) return false;
  try {
    selectEl.value = chosen.value;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (error) { return false; }
}

function hasMatchingSelection(selectEl) {
  if (!selectEl) return false;
  const value = String(selectEl.value || '');
  if (value && value !== '0' && value !== '-1' && !/^choose/i.test(value)) return true;
  const option = selectEl.options && selectEl.selectedIndex >= 0 ? selectEl.options[selectEl.selectedIndex] : null;
  return !!(option && option.value && option.value !== '0' && !/^choose/i.test(option.text || ''));
}

// Rows answered by a Moodle-confirmed (verified: true) bank hit are filled
// first, keyed by their own sub-statement. Returns the answered row numbers.
async function fillMatchingFromBank(rows, options, used) {
  const filled = new Set();
  for (const row of rows) {
    if (!row.subStatement) continue;
    let hits = null;
    try { hits = await answerKeyGet(row.subStatement); }
    catch (error) { hits = null; }
    if (!hits || !hits.length) continue;
    for (const hit of hits) {
      if (!hit || hit.verified !== true || !hit.answer) continue;
      const index = matchingOptionIndex(hit.answer, options, used);
      if (index === -1) continue;
      if (!setMatchingSelect(row.element, options[index])) continue;
      used.add(index);
      filled.add(row.rowIndex);
      logHUD('success', 'Matched row ' + row.rowIndex + ': ' + options[index]);
      break;
    }
  }
  return filled;
}

function extractQuestionData() {
  const all = getQContainers();
  const ANSWERED = new Set(['correct','incorrect','partiallycorrect','answersaved','complete','finished','gradedwrong','gradedright']);
  let firstSkipReason = '';
  const noteFirstSkip = (reason) => { if (!firstSkipReason) firstSkipReason = reason; };
  const foundQuestion = (data) => { _lastExtractionWarning = ''; return data; };
  for (const c of all) {
    const cls = new Set((c.className||'').toLowerCase().split(' '));
    if ([...cls].some(x=>ANSWERED.has(x))) {
      noteFirstSkip('question is already answered or graded');
      continue;
    }
    const selects = cfg('MATCHING_ENABLED') ? matchingSelects(c) : [];
    if (selects.length) {
      const items = [];
      for (const s of selects) { for (const o of s.options) { if (o.value && o.value !== '0' && !o.text.toLowerCase().startsWith('choose')) items.push(o.text.trim()); } }
      const uniq = [...new Set(items)];
      if (uniq.length < 2) {
        noteFirstSkip(`matching options=${uniq.length}; question text length=${qTxt(c).length}`);
        continue;
      }
      return foundQuestion({ text: qTxt(c), options: uniq, elements: selects, kind: 'select', images: [] });
    }
    const boxes = cfg('MULTI_ENABLED') ? Array.from(c.querySelectorAll('input[type="checkbox"]')) : [];
    if (boxes.length) {
      const r = xtractOpts(boxes);
      if (r.txts.length < 2) {
        noteFirstSkip(`checkbox option text count=${r.txts.length}; question text length=${qTxt(c).length}`);
        continue;
      }
      if (r.els.some(b => b.checked)) {
        noteFirstSkip('checkbox question already has a selection');
        continue;
      }
      return foundQuestion({ text: qTxt(c), options: r.txts, elements: r.els, kind: 'check', images: [] });
    }
    const rads = Array.from(c.querySelectorAll('input[type="radio"]'));
    if (rads.length) {
      const r = xtractOpts(rads);
      if (!r.txts.length && cfg('SHORT_ANSWER_ENABLED')) {
        const inputs = Array.from(c.querySelectorAll('input[type="text"], textarea')).filter(el => !el.readOnly && !el.disabled && !(el.name||'').startsWith('_qf') && !(el.name||'').startsWith('sesskey'));
        if (!inputs.length) {
          noteFirstSkip(`radio option text count=${r.txts.length}; no usable short-answer input`);
          continue;
        }
        const text = qTxt(c);
        if (!text) {
          noteFirstSkip('short-answer question text is empty');
          continue;
        }
        return foundQuestion({ text, options: [], elements: [inputs[0]], kind: 'text', images: [] });
      }
      if (r.txts.length < 2) {
        noteFirstSkip(`radio option text count=${r.txts.length}; question text length=${qTxt(c).length}`);
        continue;
      }
      if (r.els.some(r2 => r2.checked)) {
        noteFirstSkip('radio question already has a selection');
        continue;
      }
      return foundQuestion({ text: qTxt(c), options: r.txts, elements: r.els, kind: 'radio', images: [] });
    }
    if (cfg('SHORT_ANSWER_ENABLED')) {
      const inputs = Array.from(c.querySelectorAll('input[type="text"], textarea')).filter(el => !el.readOnly && !el.disabled && !(el.name||'').startsWith('_qf') && !(el.name||'').startsWith('sesskey'));
      if (!inputs.length) {
        noteFirstSkip('no supported radio, checkbox, select, or short-answer input');
        continue;
      }
      if (inputs.some(el => (el.value||'').trim())) {
        noteFirstSkip('short-answer input already has a value');
        continue;
      }
      const text = qTxt(c);
      if (!text) {
        noteFirstSkip('short-answer question text is empty');
        continue;
      }
      return foundQuestion({ text, options: [], elements: [inputs[0]], kind: 'text', images: [] });
    }
    noteFirstSkip('no supported unanswered question controls');
  }
  if (all.length && !isReviwPg()) {
    const first = all[0];
    const warning = `Skipped ${all.length} question container(s); first .que: ${firstSkipReason || 'no eligible question found'}; className="${String(first.className || '')}"; innerHTML="${String(first.innerHTML || '').slice(0,300)}"`;
    if (warning !== _lastExtractionWarning) {
      logHUD('warn', warning);
      _lastExtractionWarning = warning;
    }
  } else {
    _lastExtractionWarning = '';
  }
  return null;
}

function waitForManual(elements, kind, question = '', options = [], statements = []) {
  logHUD('warn', 'No AI answer (check API key/credits or select manually)');
  return new Promise((resolve) => {
    const deadline = Date.now() + 300000;
    let checkSelection = '';
    let checkChangedAt = 0;
    const saveManualAnswers = async () => {
      const answers = [];
      if (kind === 'radio' || kind === 'check') {
        for (let i = 0; i < elements.length; i++) {
          if (elements[i].checked) answers.push({ question, answer: options[i] || optTxt(elements[i]) });
        }
      } else if (kind === 'select') {
        for (let i = 0; i < elements.length; i++) {
          const select = elements[i];
          const option = select.options[select.selectedIndex];
          if (!option || !select.value || select.value === '0') continue;
          answers.push({ question: statements[i] || question, answer: option.text.trim() });
        }
      } else {
        const answer = (elements[0]?.value || '').trim();
        if (answer) answers.push({ question, answer });
      }
      for (const item of answers) {
        if (!item.question || !item.answer) continue;
        await learnCorrect(item.question, item.answer);
        logHUD('success', 'Saved manual answer to local question bank (will verify on review)');
      }
    };
    const ivl = setInterval(async () => {
      if (_stopRequested || Date.now() > deadline) {
        clearInterval(ivl);
        if (Date.now() > deadline) logHUD('warn','Manual timeout - continuing');
        resolve(false); return;
      }
      if (kind === 'radio' || kind === 'check') {
        const selected = elements.map((element) => element.checked ? '1' : '0').join('');
        if (selected !== checkSelection) {
          checkSelection = selected;
          checkChangedAt = Date.now();
        }
        const selectionReady = kind === 'radio'
          ? elements.some(e => e.checked)
          : elements.some(e => e.checked) && Date.now() - checkChangedAt >= 900;
        if (selectionReady) {
          clearInterval(ivl);
          try { await saveManualAnswers(); }
          catch (error) { logHUD('error', 'Could not save manual answer: ' + error.message); }
          resolve(true);
          return;
        }
      } else if (kind === 'select') {
        if (elements.some(e => e.value && e.value !== '' && e.value !== '0')) {
          clearInterval(ivl);
          try { await saveManualAnswers(); }
          catch (error) { logHUD('error', 'Could not save manual answer: ' + error.message); }
          resolve(true);
          return;
        }
      } else {
        if (elements.some(e => (e.value||'').trim())) {
          clearInterval(ivl);
          try { await saveManualAnswers(); }
          catch (error) { logHUD('error', 'Could not save manual answer: ' + error.message); }
          resolve(true);
          return;
        }
      }
    }, 500);
  });
}

async function clickNext() {
  try {
    window.scrollBy(0,500); await new Promise(r=>setTimeout(r,150));
    for (const sel of ['#mod_quiz-next-nav','input#mod_quiz-next-nav','button#mod_quiz-next-nav','#mod_quiz-next-nav','button[name="nextbutton"]','input[value="Next page"]']) {
      const btn = document.querySelector(sel); if (btn) { btn.click(); return true; }
    }
    // Fallback: find any button whose text contains "Next"
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) { if (btn.textContent.trim().toLowerCase().includes('next')) { btn.click(); return true; } }
    return false;
  } catch(e) { return false; }
}

async function clickFinish() {
  try {
    for (const sel of ['#mod_quiz-finish-nav','input[value="Finish attempt"]']) {
      const btn = document.querySelector(sel); if (btn) { btn.click(); return true; }
    }
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) { if (btn.textContent.trim().toLowerCase().includes('finish attempt') || btn.textContent.trim().toLowerCase().includes('finish')) { btn.click(); return true; } }
    return false;
  } catch(e) { return false; }
}
// Extract clean option text for a (possibly disabled) review input.
function reviewAnswerText(inputOrRow) {
  const node0 = inputOrRow;
  const strip = (node) => cleanNodeText(node, 'script, style, .icon, .feedbackicon, .grade, .state, .questionflag, .accesshide, .answernumber, .feedbackimage');
  let input = null;
  if (node0 && node0.tagName === 'INPUT') input = node0;
  else if (node0 && node0.querySelector) input = node0.querySelector('input[type="radio"], input[type="checkbox"]');

  let text = '';
  if (input) {
    const lbl = input.closest('label');
    if (lbl) text = strip(lbl);
    if (!text && input.id) {
      const id = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(input.id) : input.id.replace(/"/g, '\\"');
      const forLabel = document.querySelector('label[for="' + id + '"]');
      if (forLabel) text = strip(forLabel);
    }
  }
  if (!text && node0 && node0.closest) {
    const row = node0.closest('.r0, .r1, [class*="answer"] > div, .answer, .answercell, td');
    if (row) text = strip(row);
  }
  if (!text && input && input.parentElement) text = strip(input.parentElement);
  // Strip any leading option-letter prefix ("a.", "B)", ...) and trailing state words.
  text = text.replace(/^[A-Da-d][.)]\s*/, '').replace(/^[A-Da-d][.)]\s*/, '');
  text = text.replace(/\s*(?:Correct|Incorrect|Partially correct)\s*$/i, '');
  return normalizeReviewText(text);
}

// ── Row marks: Moodle's per-row check/cross indicators ──────────────────────
// Every theme renders them differently (fa icons, feedbackimage alt/title,
// `.text-success`/`.text-danger`, literal ✓/✗ characters), so the row itself and
// the whole row subtree are inspected. Crosses win over checks: a wrong row is
// never treated as verified.
function reviewMarkKind(node) {
  if (!node || node.nodeType !== 1) return '';
  const cls = String(node.className || '').toLowerCase();
  if (/\bincorrect\b|\btext-danger\b/.test(cls)) return 'wrong';
  if (/\bcorrect\b/.test(cls) && !/partiallycorrect/.test(cls)) return 'right';
  if (node.querySelector) {
    const wrong = node.querySelector(
      '.fa-remove, .fa-times, .fa-close, .fa-times-circle, ' +
      '.feedbackimage[alt*="Incorrect" i], .feedbackimage[title*="Incorrect" i], ' +
      'img[src*="cross" i], img[src*="incorrect" i], [title*="Incorrect" i], ' +
      '[aria-label*="Incorrect" i], .text-danger, svg[data-icon="times"], i[data-icon="times"]'
    );
    if (wrong) return 'wrong';
    const right = node.querySelector(
      '.fa-check, .fa-check-circle, .feedbackimage[alt*="Correct" i], ' +
      '.feedbackimage[title*="Correct" i], img[src*="tick" i], img[src*="correct" i], ' +
      'img[src*="check" i], [title*="Correct" i], [aria-label*="Correct" i], ' +
      '.text-success, svg[data-icon="check"], i[data-icon="check"]'
    );
    if (right) return 'right';
  }
  const text = String(node.textContent || '');
  if (/[✗✘✕✖]/.test(text)) return 'wrong';
  if (/[✓✔]/.test(text)) return 'right';
  return '';
}

// Row-level correctness on a matching review page: the feedback icon first
// (`title="Correct"` / fa-check), then the nearest marked ancestor. Matching
// rows carry their own state, so a partially correct block is still learnable.
function matchingRowIsCorrect(row) {
  const root = row && (row.rowRoot || row.element);
  if (!root) return false;
  const mark = reviewMarkKind(root);
  if (mark === 'right') return true;
  if (mark === 'wrong') return false;
  let node = root;
  let depth = 0;
  while (node && depth < 8) {
    const cls = String(node.className || '').toLowerCase();
    if (/\bpartiallycorrect\b|\bincorrect\b/.test(cls)) return false;
    if (/\bcorrect\b/.test(cls)) return true;
    if (/\bque\b/.test(cls)) break;
    node = node.parentElement;
    depth += 1;
  }
  return false;
}

function cleanRightAnswerText(value) {
  return normalizeReviewText(value)
    .replace(/^The (?:correct|right) answers? (?:is|are)\s*:?\s*/i, '')
    .replace(/^Correct answers?\s*:?\s*/i, '')
    .replace(/\.$/, '')
    .trim();
}

// Moodle's own "The correct answer is: ..." text inside one review row.
function matchingRowRightAnswer(row) {
  const root = row && (row.rowRoot || row.element);
  if (!root || !root.querySelector) return '';
  for (const node of root.querySelectorAll('.rightanswer, .correctanswer')) {
    const text = cleanRightAnswerText(node.textContent || '');
    if (text) return text;
  }
  return '';
}

// What the learner actually submitted for one row (live dropdown, disabled
// review dropdown, or the plain-text answer cell Moodle 4.x renders).
function matchingRowSelectedText(row) {
  const root = row && (row.rowRoot || row.element);
  const select = row && row.element && String(row.element.tagName || '').toUpperCase() === 'SELECT'
    ? row.element
    : (root && root.querySelector ? root.querySelector('select') : null);
  if (select && select.options && select.selectedIndex >= 0) {
    const option = select.options[select.selectedIndex];
    const text = option ? normalizeReviewText(option.text || '') : '';
    if (text && option.value && option.value !== '0' && !/^choose/i.test(text)) return text;
  }
  if (!root || !root.querySelectorAll) return '';
  const candidates = root.querySelectorAll(
    '.useranswer, .control .answer, .control span.answer, .answercell .answer, td.control'
  );
  for (const node of candidates) {
    const text = cleanNodeText(node, MATCH_STRIP_SELECTOR);
    if (text && !/^choose/i.test(text)) return text;
  }
  return '';
}

// Verified correct dropdown value for one review row, or '' when the row does
// not prove an answer (right answer hidden and the row is not marked correct).
function matchingRowCorrectText(row, containerCorrect) {
  const root = row && (row.rowRoot || row.element);
  if (!root) return '';
  const rightAnswer = matchingRowRightAnswer(row);
  if (rightAnswer) return rightAnswer;
  if (!matchingRowIsCorrect(row) && containerCorrect !== true) return '';
  return matchingRowSelectedText(row);
}

// Outcome of one radio/checkbox option row (`right`/`wrong`/''), used by the
// live review learner and the background review-page harvester.
function choiceRowOutcome(el, container) {
  let node = el;
  while (node && node !== container) {
    const classes = new Set(String(node.className || '').toLowerCase().split(/\s+/));
    if (classes.has('incorrect') || classes.has('partiallycorrect')) return 'wrong';
    if (classes.has('correct')) return 'right';
    node = node.parentElement;
  }
  return '';
}

// One matching block -> per-row analysis with iterative elimination.
//
// 1. Verified rows pin a statement to an option and remove it from the pool.
// 2. A row with exactly one still-unclaimed candidate (after dropping that
//    row's own confirmed-wrong submission) is deduced — this covers "N-1 rows
//    are known, the last one follows".
// 3. Two swapped rows are deduced together: each one's wrong submission is the
//    other's correct option.
//
// Deduction only runs when the option pool covers every row, so an incomplete
// review page (learner skipped rows) can never fabricate a verified pair.
function analyzeMatchingRows(container, containerCorrect) {
  const selects = matchingSelects(container);
  const rowEls = matchingRowElements(container);
  if (!selects.length && !rowEls.length) return null;
  const units = rowEls.length >= Math.max(2, selects.length) ? rowEls : selects;
  const { rows, header } = collectMatchingRows(units, qTxt(container));

  const options = [];
  const optionKeys = new Set();
  const addOption = (value) => {
    const text = normalizeReviewText(value);
    const key = normText(text);
    if (!text || !key || /^choose\b/i.test(text) || optionKeys.has(key)) return;
    optionKeys.add(key);
    options.push(text);
  };
  for (const select of selects) {
    for (const option of select.options || []) {
      if (!option || !option.value || option.value === '0') continue;
      addOption(option.text || '');
    }
  }

  const analyses = [];
  for (const row of rows) {
    const root = row.rowRoot || row.element;
    const selected = matchingRowSelectedText(row);
    const rightAnswer = matchingRowRightAnswer(row);
    const mark = root ? reviewMarkKind(root) : '';
    const rowIsWrong = mark === 'wrong';
    const rowIsCorrect = !rowIsWrong && (mark === 'right' || !!rightAnswer || containerCorrect === true);
    if (selected) addOption(selected);
    if (rightAnswer) addOption(rightAnswer);
    const answer = rowIsCorrect ? (rightAnswer || selected) : '';
    analyses.push({
      rowIndex: row.rowIndex,
      element: row.element,
      rowRoot: row.rowRoot,
      subStatement: row.subStatement,
      selected,
      rightAnswer,
      answer,
      rowIsWrong,
      verified: !!(rowIsCorrect && answer),
      deduced: false,
      wrongAnswers: rowIsWrong && selected ? [selected] : [],
    });
  }
  const usedByVerified = new Set(
    analyses.filter((row) => row.verified && row.answer).map((row) => normText(row.answer))
  );
  let remaining = options.filter((option) => !usedByVerified.has(normText(option)));

  if (options.length >= analyses.length) {
    let deducedAny = true;
    while (deducedAny) {
      deducedAny = false;
      // Single-candidate elimination.
      for (const row of analyses) {
        if (row.verified) continue;
        const blocked = new Set((row.wrongAnswers || []).map((wrong) => normText(wrong)));
        const candidates = remaining.filter((option) => !blocked.has(normText(option)));
        if (candidates.length !== 1) continue;
        row.answer = candidates[0];
        row.verified = true;
        row.deduced = true;
        remaining = remaining.filter((option) => normText(option) !== normText(candidates[0]));
        deducedAny = true;
        break;
      }
      if (deducedAny) continue;

      // 2-row swap deduction.
      const open = analyses.filter((row) => !row.verified);
      if (open.length !== 2 || remaining.length !== 2) continue;
      const [first, second] = open;
      const [firstChoice, secondChoice] = remaining;
      const firstWrong = new Set((first.wrongAnswers || []).map((wrong) => normText(wrong)));
      const secondWrong = new Set((second.wrongAnswers || []).map((wrong) => normText(wrong)));
      const a = normText(firstChoice);
      const b = normText(secondChoice);
      if (firstWrong.has(a) && secondWrong.has(b)) {
        first.answer = secondChoice;
        second.answer = firstChoice;
      } else if (firstWrong.has(b) && secondWrong.has(a)) {
        first.answer = firstChoice;
        second.answer = secondChoice;
      } else {
        continue;
      }
      first.verified = true;
      second.verified = true;
      first.deduced = true;
      second.deduced = true;
      remaining = [];
      deducedAny = true;
    }
  }

  return { rows: analyses, header, options, selects, rowEls };
}

// Save every graded matching pair under its own sub-statement (never under the
// shared "Match the term/details..." header) so the next attempt can fill the
// dropdowns straight from the local/GitHub bank. Deduced pairs are stored as
// verified too; wrong submissions are recorded as eliminated choices.
async function learnMatchingFromReview(container, containerCorrect, learned) {
  const analysis = analyzeMatchingRows(container, containerCorrect);
  if (!analysis) return 0;
  let saved = 0;
  const used = new Set();
  for (const row of analysis.rows) {
    if (!row.subStatement) continue;
    const key = normText(row.subStatement);
    if (!key || used.has(key)) continue;
    used.add(key);
    if (row.verified && row.answer) {
      try {
        await answerKeyPut(row.subStatement, row.answer, 'learned-review', { verified: true, replaceVerified: true });
        saved += 1;
        if (learned) {
          learned.right += 1;
          learned.matching = (learned.matching || 0) + 1;
          if (row.deduced) learned.deduced = (learned.deduced || 0) + 1;
        }
        logHUD('success', 'Matching saved: row ' + row.rowIndex + (row.deduced ? ' (deduced)' : '') +
          ' -> ' + row.answer.slice(0, 40));
      } catch (error) {
        logHUD('warn', 'Could not save matching pair: ' + error.message);
      }
      continue;
    }
    // Only rows Moodle marked wrong prove an eliminated choice.
    for (const wrong of row.wrongAnswers || []) {
      if (!wrong) continue;
      try {
        await wrongSet(row.subStatement, wrong);
        if (learned) learned.wrong += 1;
      } catch (error) { /* the wrong cache is advisory */ }
    }
  }
  return saved;
}

async function learnFromReviewPage() {
  const learned = { right: 0, wrong: 0, matching: 0, deduced: 0 };
  const containers = Array.from(document.querySelectorAll('.que'));
  for (const c of containers) {
    const qText = qTxt(c);
    if (!qText) continue;
    const grade = parseGradeFromReview(c);
    const containerCorrect = grade && typeof grade.correct === 'boolean' ? grade.correct : null;

    // Matching questions are graded row by row: learn each (sub-statement,
    // verified option) pair instead of running the single-answer path below.
    if (isMatchingBlock(c) && (matchingSelects(c).length || matchingRowElements(c).length)) {
      await learnMatchingFromReview(c, containerCorrect, learned);
      continue;
    }

    const savedRight = new Set();
    const savedWrong = new Set();
    const saveRight = async (answer) => {
      const value = normalizeReviewText(answer);
      const signature = normText(value);
      if (!signature || savedRight.has(signature)) return;
      savedRight.add(signature);
      await answerKeyPut(qText, value, 'learned-review', { verified: true });
      learned.right++;
    };
    const saveWrong = async (answer) => {
      const value = normalizeReviewText(answer);
      const signature = normText(value);
      if (!signature || savedWrong.has(signature)) return;
      savedWrong.add(signature);
      await wrongSet(qText, value);
      learned.wrong++;
    };
    const optionOutcome = (el) => choiceRowOutcome(el, c);

    // 1) Authoritative correct-answer text rendered by Moodle ("The correct answer is: ...").
    for (const rightAnswer of c.querySelectorAll('.rightanswer')) {
      const answer = normalizeReviewText(rightAnswer.textContent || rightAnswer.innerText || '')
        .replace(/^The correct answer is\s*:\s*/i, '')
        .replace(/\.$/, '');
      if (answer) await saveRight(answer);
    }

    // 2) Options flagged correct by the theme (covers multi-select even if unchecked).
    for (const input of c.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
      if (input.value === '-1') continue;
      if (optionOutcome(input) !== 'right') continue;
      const text = reviewAnswerText(input);
      if (text) await saveRight(text);
    }

    // 3) The learner's own checked answer(s). ":checked" matches even when disabled (Moodle 4.x).
    const checked = c.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked');
    for (const input of checked) {
      if (input.value === '-1') continue;
      const text = reviewAnswerText(input);
      if (!text) continue;
      const rowResult = optionOutcome(input);
      if (rowResult === 'right') { await saveRight(text); continue; }
      if (rowResult === 'wrong') { await saveWrong(text); continue; }
      if (containerCorrect === true) await saveRight(text);
      else if (containerCorrect === false) await saveWrong(text);
    }

    // 4) Short-answer / typed responses (input value, or plain-text ".answer" rendering).
    for (const input of c.querySelectorAll('input[type="text"]')) {
      let answer = normalizeReviewText(input.value || '');
      if (!answer) {
        const plain = c.querySelector('.answer .qtext, .answer p, .answer, .rightanswer');
        if (plain) answer = normalizeReviewText(plain.textContent || '');
      }
      if (!answer) continue;
      const rowResult = optionOutcome(input);
      if (rowResult === 'right' || containerCorrect === true) await saveRight(answer);
      else if (rowResult === 'wrong' || containerCorrect === false) await saveWrong(answer);
    }

    // 5) Two-option / True-False: when the attempt was wrong (earned === 0), the
    //    opposite (unselected) option is the correct answer — save it as verified.
    if (grade && grade.earned === 0) {
      const optionInputs = Array.from(c.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
        .filter((input) => input.value !== '-1');
      const optionTexts = [];
      for (const input of optionInputs) {
        const t = reviewAnswerText(input);
        if (t && !optionTexts.some((x) => normText(x) === normText(t))) optionTexts.push(t);
      }
      if (optionTexts.length === 2) {
        const selected = optionInputs
          .filter((input) => input.checked)
          .map((input) => reviewAnswerText(input))
          .filter(Boolean);
        if (selected.length === 1) {
          const other = optionTexts.find((t) => normText(t) !== normText(selected[0]));
          if (other) {
            await saveRight(other);
            learned.deduced += 1;
            logHUD('info', 'Deduced opposite answer for 2-option question: ' + other.slice(0, 40));
            requestGitHubBankPush();
          }
        }
      }
    }
  }
  // Verified matching pairs are the most valuable bank entries (one clean key
  // per sub-statement), so push them to the shared GitHub bank right away.
  if (learned.matching > 0) {
    logHUD('info', 'Matching review: saved ' + learned.matching + ' verified pair(s)' +
      (learned.deduced ? ' (' + learned.deduced + ' deduced by elimination)' : ''));
    requestGitHubBankPush();
  }
  return learned;
}

// ── Review-page answer extraction (live page + fetched grade pages) ─────────
// Extracts verified answers, matching pairs and eliminated wrong choices from
// one review document. Runs on the live review page and on DOMParser documents
// fetched in the background, so both paths learn exactly the same evidence.
function harvestAnswersFromReviewDoc(rootDoc, subjectCode, quizTitle, courseTitle = '') {
  const questions = [];
  if (!rootDoc || !rootDoc.querySelectorAll) return questions;
  const containers = Array.from(rootDoc.querySelectorAll('.que'))
    .filter((que) => !que.parentElement || !que.parentElement.closest('.que'));
  for (const que of containers) {
    const qText = qTxt(que);
    if (!qText) continue;
    const grade = parseGradeFromReview(que);
    const containerCorrect = grade && typeof grade.correct === 'boolean' ? grade.correct : null;
    const base = { quizTitle, courseTitle, subjectCode, evidenceType: 'moodle_review_elimination' };

    // Matching blocks are graded row by row; each verified/deduced pair is its
    // own bank entry keyed by the row's sub-statement.
    if (isMatchingBlock(que) && (matchingSelects(que).length || matchingRowElements(que).length)) {
      const analysis = analyzeMatchingRows(que, containerCorrect);
      if (!analysis) continue;
      for (const row of analysis.rows) {
        if (!row.subStatement) continue;
        const record = { question: row.subStatement, answer: '', verified: false, deduced: false, wrongAnswers: [], ...base };
        if (row.verified && row.answer) {
          record.answer = row.answer;
          record.verified = true;
          record.deduced = !!row.deduced;
          record.evidenceType = row.deduced ? 'elimination_deduction' : 'moodle_review';
        } else {
          record.wrongAnswers = (row.wrongAnswers || []).slice();
        }
        if (record.answer || record.wrongAnswers.length) questions.push(record);
      }
      continue;
    }

    const rightTexts = [];
    const wrongTexts = [];
    const choiceTexts = [];
    const addRight = (value) => {
      const text = normalizeReviewText(value);
      if (!text) return;
      if (!rightTexts.some((existing) => normText(existing) === normText(text))) rightTexts.push(text);
    };
    const addWrong = (value) => {
      const text = normalizeReviewText(value);
      if (!text) return;
      if (rightTexts.some((existing) => normText(existing) === normText(text))) return;
      if (!wrongTexts.some((existing) => normText(existing) === normText(text))) wrongTexts.push(text);
    };

    // 1) Moodle's authoritative correct-answer text.
    for (const node of que.querySelectorAll('.rightanswer, .correctanswer')) {
      const answer = cleanRightAnswerText(node.textContent || '');
      if (answer) addRight(answer);
    }

    // 2) Per-choice checkmarks/crosses and the learner's checked options.
    const inputs = Array.from(que.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
      .filter((input) => input.value !== '-1');
    const checkedChoices = [];
    for (const input of inputs) {
      const text = reviewAnswerText(input);
      if (!text) continue;
      if (!choiceTexts.some((existing) => normText(existing) === normText(text))) choiceTexts.push(text);
      const mark = choiceRowOutcome(input, que) ||
        reviewMarkKind(input.closest('label') || input.parentElement || input);
      if (mark === 'wrong') addWrong(text);
      else if (mark === 'right') addRight(text);
      if (input.checked) checkedChoices.push({ text, mark });
    }

    // 3) Full marks prove the submitted choices; zero marks eliminate them.
    if (!rightTexts.length && containerCorrect === true) {
      checkedChoices.forEach((choice) => { if (choice.mark !== 'wrong') addRight(choice.text); });
    } else if (!rightTexts.length && (containerCorrect === false || (grade && grade.earned === 0))) {
      checkedChoices.forEach((choice) => { if (choice.mark !== 'right') addWrong(choice.text); });
    }

    // 3b) Review pages often render choices as text (disabled/no inputs). The
    // per-choice checkmark/cross still proves the answer or the elimination.
    const choiceRows = que.querySelectorAll(
      '.answer div.r0, .answer div.r1, .answer fieldset > div, .answer li, .answer tr, .answer label, .answer > div'
    );
    for (const row of choiceRows) {
      if (/(^|\s)(rightanswer|correctanswer)(\s|$)/i.test(String(row.className || ''))) continue;
      if (row.querySelector('.rightanswer, .correctanswer')) continue;
      const label = row.querySelector('label') || row;
      const text = cleanNodeText(label, 'input, button, .answernumber, .accesshide, .sr-only, .feedback, .feedbackspan, .feedbackimage, .icon, .state, .grade');
      if (!text || text.length < 2) continue;
      if (!choiceTexts.some((existing) => normText(existing) === normText(text))) choiceTexts.push(text);
      const mark = reviewMarkKind(row) || reviewMarkKind(label);
      if (mark === 'wrong') addWrong(text);
      else if (mark === 'right') addRight(text);
    }

    // 4) Typed responses (short answer / cloze).
    for (const input of que.querySelectorAll('input[type="text"], textarea')) {
      const value = normalizeReviewText(input.value || '');
      if (!value) continue;
      const outcome = choiceRowOutcome(input, que);
      if (outcome === 'right' || containerCorrect === true) addRight(value);
      else if (outcome === 'wrong' || containerCorrect === false) addWrong(value);
    }

    // 5) Review pages render a typed answer as text instead of a live input.
    if (!rightTexts.length && containerCorrect === true && !inputs.length) {
      const answerNode = que.querySelector('.answer > div:not(.rightanswer):not(.correctanswer), .answer p, .answer');
      const answer = answerNode
        ? cleanNodeText(answerNode, '.rightanswer, .correctanswer, .feedback, .state, .grade, .icon, .feedbackimage')
        : '';
      if (answer && !/^select one|^choose/i.test(answer)) addRight(answer);
    }

    // 6) Elimination: when every option but one is confirmed wrong.
    let deduced = false;
    if (!rightTexts.length && wrongTexts.length > 0 && choiceTexts.length > 1) {
      const remaining = choiceTexts.filter((choice) =>
        !wrongTexts.some((wrong) => normText(wrong) === normText(choice)));
      if (remaining.length === 1) {
        addRight(remaining[0]);
        deduced = true;
      }
    }

    const record = {
      question: qText,
      answer: rightTexts.join(', '),
      verified: rightTexts.length > 0,
      deduced,
      wrongAnswers: wrongTexts.filter((wrong) =>
        !rightTexts.some((right) => normText(right) === normText(wrong))),
      ...base,
    };
    record.evidenceType = deduced
      ? 'elimination_deduction'
      : (rightTexts.length ? 'moodle_review' : 'moodle_review_elimination');
    if (record.answer || record.wrongAnswers.length) questions.push(record);
  }
  return questions;
}

function subjectCodeFromText(value) {
  const match = String(value || '').match(/\b([A-Z]{2,6}\s*-?\s*\d{3,4}[A-Z]?)\b/);
  return match ? match[1].replace(/\s+/g, '').toUpperCase() : '';
}

// Fetch one quiz's review pages (showall=1, plus pagination when Moodle ignores
// it) and extract every question record.
async function harvestQuizReviewPages(quiz, subjectCode, courseTitle, seenQuestions) {
  const viewDoc = await fetchMoodleDocument(quiz.url);
  const queue = [];
  for (const link of viewDoc.querySelectorAll('a[href*="review.php"], a[href*="/mod/quiz/review.php"]')) {
    const href = link.getAttribute('href');
    if (!href) continue;
    try { queue.push(new URL(href, quiz.url).href); } catch (error) { /* ignore */ }
  }
  if (!queue.length && /\/mod\/quiz\/review\.php/i.test(quiz.url)) queue.push(quiz.url);
  const seenUrls = new Set();
  const records = [];
  for (let index = 0; index < queue.length && index < GRADES_HARVEST_MAX_REVIEW_PAGES; index += 1) {
    let reviewUrl = queue[index];
    try {
      const parsed = new URL(reviewUrl, quiz.url);
      parsed.searchParams.set('showall', '1');
      reviewUrl = parsed.href;
    } catch (error) { /* keep the raw URL */ }
    if (seenUrls.has(reviewUrl)) continue;
    seenUrls.add(reviewUrl);
    let reviewDoc = null;
    try {
      reviewDoc = await fetchMoodleDocument(reviewUrl);
    } catch (error) {
      logHUD('warn', 'Review fetch failed (' + quiz.title + '): ' + error.message);
      continue;
    }
    for (const record of harvestAnswersFromReviewDoc(reviewDoc, subjectCode, quiz.title, courseTitle)) {
      const key = normText(record.question);
      if (!key || seenQuestions.has(key)) continue;
      seenQuestions.add(key);
      records.push(record);
    }
    // Themes that ignore showall=1 expose follow-up review pages as links.
    for (const link of reviewDoc.querySelectorAll('a[href*="review.php"]')) {
      const href = link.getAttribute('href');
      if (!href) continue;
      let pageUrl = '';
      try {
        const parsed = new URL(href, quiz.url);
        parsed.searchParams.delete('showall');
        pageUrl = parsed.href;
      } catch (error) { continue; }
      if (!seenUrls.has(pageUrl) && !queue.includes(pageUrl)) queue.push(pageUrl);
    }
  }
  return records;
}

// Clicking Harvest (force) or opening a course/grades page (throttled to one
// scan per course per 6 h) reads the user grade report, fetches every completed
// quiz's review pages and merges verified answers + eliminated choices into the
// local bank, then pushes them to the GitHub `ama-quiz-bank`.
async function harvestCourseReviews(force = false) {
  if (_gradesHarvestRunning) {
    if (force) logHUD('warn', 'Course review harvest is already running');
    return { success: false, inProgress: true };
  }
  const pathname = location.pathname || '';
  if (!force && (pathname.includes('/mod/quiz/attempt.php') || pathname.includes('/mod/quiz/review.php'))) {
    return { success: false, skipped: true };
  }
  let courseInfo = null;
  try { courseInfo = await courseHarvestInfo(); } catch (error) { courseInfo = null; }
  const courseId = (courseInfo && courseInfo.courseId) || courseIdFromLocation();
  if (!courseId) {
    if (force) logHUD('warn', 'Open a Moodle course or grades page to harvest review answers.');
    return { success: false };
  }
  if (!force) {
    const stored = await chrome.storage.local.get('gradesHarvestMap');
    const history = stored.gradesHarvestMap && typeof stored.gradesHarvestMap === 'object'
      ? stored.gradesHarvestMap
      : {};
    const last = Number(history[courseId]) || 0;
    if (Date.now() - last < GRADES_HARVEST_COOLDOWN_MS) return { success: false, skipped: true };
    history[courseId] = Date.now();
    await chrome.storage.local.set({ gradesHarvestMap: history });
  }

  _gradesHarvestRunning = true;
  try {
    const courseTitle = (courseInfo && courseInfo.title) || '';
    const subjectCode = subjectCodeFromText(courseTitle) || courseTitle || ('course' + courseId);
    logHUD('info', 'Review harvest: scanning grade report for ' + (courseTitle || courseId) + '...');
    const gradesDoc = (pathname.includes('/grade/report/user/index.php') &&
      document.querySelector('.user-grade, table.generaltable, .generaltable'))
      ? document
      : await fetchMoodleDocument(gradesReportUrl(courseId));
    const quizzes = completedQuizzesFromGradesDoc(gradesDoc).slice(0, GRADES_HARVEST_MAX_QUIZZES);
    if (!quizzes.length) {
      logHUD('info', 'Review harvest: no completed quizzes found');
      return { success: false, quizzes: 0 };
    }
    const records = [];
    const seenQuestions = new Set();
    for (let index = 0; index < quizzes.length; index += 1) {
      const quiz = quizzes[index];
      logHUD('info', 'Review harvest [' + (index + 1) + '/' + quizzes.length + ']: ' + quiz.title);
      try {
        const extracted = await harvestQuizReviewPages(quiz, subjectCode, courseTitle, seenQuestions);
        for (const record of extracted) records.push(record);
      } catch (error) {
        logHUD('warn', 'Review harvest skipped ' + quiz.title + ': ' + error.message);
      }
    }
    const merged = await mergeHarvestedReviewRecords(records, subjectCode);
    if (merged.saved || merged.eliminated) {
      logHUD('success', 'Review harvest: ' + merged.saved + ' verified answer(s), ' +
        merged.eliminated + ' eliminated choice(s)' +
        (merged.deduced ? ', ' + merged.deduced + ' deduced' : '') +
        ' from ' + quizzes.length + ' quiz(zes)');
      requestGitHubBankPush();
    } else {
      logHUD('info', 'Review harvest: nothing new to save');
    }
    return { success: merged.saved > 0, quizzes: quizzes.length, ...merged };
  } catch (error) {
    logHUD('warn', 'Review harvest failed: ' + error.message);
    return { success: false, error: error.message };
  } finally {
    _gradesHarvestRunning = false;
  }
}


// Merge harvested review evidence into the local bank. Verified (and deduced)
// answers use `replaceVerified` so a newer Moodle result retires stale pairs;
// eliminated choices go to the wrong cache so future attempts never pick them.
async function mergeHarvestedReviewRecords(records, subjectCode) {
  const course = 'harvested-' + (normText(subjectCode).replace(/\s+/g, '') || 'reviews');
  let saved = 0;
  let deduced = 0;
  let eliminated = 0;
  for (const record of records || []) {
    const question = normalizeReviewText(record && record.question);
    if (!question) continue;
    const answer = normalizeReviewText(record.answer || '');
    if (answer) {
      await answerKeyPut(question, answer, course, { verified: true, replaceVerified: true });
      saved += 1;
      if (record.deduced) deduced += 1;
    }
    const answerParts = answer.split(',').map((part) => normText(part)).filter(Boolean);
    for (const wrong of record.wrongAnswers || []) {
      const text = normalizeReviewText(wrong);
      const wrongNorm = normText(text);
      if (!wrongNorm) continue;
      if (answerParts.some((part) => part === wrongNorm || similarity(part, wrongNorm) >= 0.95)) continue;
      await wrongSet(question, text);
      eliminated += 1;
    }
  }
  if (saved || eliminated) await flushNow();
  return { saved, deduced, eliminated };
}

// ── Background grades-report harvest (course / grades pages) ────────────────
const GRADES_HARVEST_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const GRADES_HARVEST_MAX_QUIZZES = 25;
const GRADES_HARVEST_MAX_REVIEW_PAGES = 40;
let _gradesHarvestRunning = false;

// Semester-aware Moodle base path: "/2612/course/view.php" -> "/2612".
function moodleBasePath() {
  const match = String(location.pathname || '').match(/^(.*?)\/(?:course|mod|grade|my|login|admin)(?:\/|$)/i);
  return match ? match[1] : '';
}

function gradesReportUrl(courseId) {
  return location.origin + moodleBasePath() + '/grade/report/user/index.php?id=' + encodeURIComponent(courseId);
}

function courseIdFromLocation() {
  const crumb = document.querySelector('.breadcrumb a[href*="/course/view.php"]');
  if (crumb) {
    const id = courseIdFromHref(crumb.href || crumb.getAttribute('href') || '');
    if (id) return id;
  }
  const gradesLink = document.querySelector('a[href*="/grade/report/user/index.php"]');
  if (gradesLink) {
    const id = courseIdFromHref(gradesLink.href || gradesLink.getAttribute('href') || '');
    if (id) return id;
  }
  const pathname = location.pathname || '';
  if (pathname.includes('/course/view.php') || pathname.includes('/grade/report/user/index.php')) {
    return new URLSearchParams(location.search).get('id') || '';
  }
  return '';
}

// A grade-report row is "completed" only when it carries a real score. Ranges
// ("0.00–100.00"), dashes and "( Empty )" never count.
function quizRowCompleted(row) {
  const usable = (text) => {
    const value = normalizeReviewText(text);
    if (!value || value === '-' || value === '–') return false;
    if (/\(\s*empty\s*\)/i.test(value)) return false;
    return /\d/.test(value);
  };
  const gradeCell = row.querySelector('.column-grade, td.grade, [headers*="grade" i]');
  if (gradeCell) {
    const text = normalizeReviewText(gradeCell.textContent);
    if (usable(text) && !/^0(?:\.0+)?\s*[–-]\s*\d/.test(text)) return true;
  }
  const pctCell = row.querySelector('.column-percentage, [headers*="percentage" i]');
  if (pctCell) {
    const text = normalizeReviewText(pctCell.textContent);
    if (usable(text) && !/^0(?:\.0+)?\s*%?$/.test(text)) return true;
  }
  for (const cell of row.querySelectorAll('td')) {
    if (cell.querySelector('a[href*="/mod/quiz/"]')) continue;
    const text = normalizeReviewText(cell.textContent);
    if (!usable(text)) continue;
    if (/^0(?:\.0+)?\s*%?$/.test(text)) continue;
    if (/^0(?:\.0+)?\s*[–-]\s*\d/.test(text)) continue;
    return true;
  }
  return false;
}

// Completed quizzes in a grade-report document (view.php links with a score).
function completedQuizzesFromGradesDoc(gradesDoc) {
  const quizzes = [];
  const seen = new Set();
  if (!gradesDoc || !gradesDoc.querySelectorAll) return quizzes;
  const rows = Array.from(gradesDoc.querySelectorAll('.user-grade tr, table.generaltable tr, table.table tr, tr'));
  for (const row of rows) {
    const link = row.querySelector('a[href*="/mod/quiz/view.php"], a[href*="/mod/quiz/"]');
    if (!link) continue;
    const href = link.getAttribute('href') || '';
    if (!href || href.includes('attempt.php') || href.includes('review.php')) continue;
    const title = normalizeReviewText(link.textContent || '');
    if (!title) continue;
    let url = '';
    try { url = new URL(href, location.origin).href; } catch (error) { continue; }
    if (seen.has(url) || !quizRowCompleted(row)) continue;
    seen.add(url);
    quizzes.push({ title: title.replace(/^QUIZ\s+/i, '').trim() || title, url });
  }
  return quizzes;
}

async function fetchMoodleDocument(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  } finally {
    clearTimeout(timer);
  }
}


async function selectAnswer(selectEl, optionText) {

  try {
    let bestVal = null, bestScore = 0;
    for (const o of selectEl.options) {
      if (!o.value || o.value === '0') continue;
      const s = similarity(optionText.toLowerCase(), o.text.toLowerCase());
      if (s > bestScore) { bestVal = o.value; bestScore = s; }
    }
    if (!bestVal || bestScore < 0.45) return false;
    selectEl.value = bestVal;
    selectEl.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  } catch(e) { return false; }
}

function typeAnswer(element, text) {
  try {
    element.focus();
    element.value = text;
    element.dispatchEvent(new Event('input', {bubbles:true}));
    element.dispatchEvent(new Event('change', {bubbles:true}));
    element.dispatchEvent(new Event('blur', {bubbles:true}));
    return true;
  } catch(e) { return false; }
}

async function submitAttempt() {
  const sel = ['#id_submitbutton','input[value="Submit all and finish"]','button[name="submitbutton"]'];
  for (const s of sel) {
    const btn = document.querySelector(s);
    if (btn) { btn.click(); return true; }
  }
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) { if (btn.textContent.trim().toLowerCase().includes('submit all and finish')) { btn.click(); return true; } }
  return false;
}
// Build a predicate that flags options matching a stored (known-wrong) answer.
async function buildWrongOptionFilter(qText, options) {
  const wrong = await getWrongAnswers(qText);
  const set = new Set((wrong || []).map((w) => normText(w)).filter(Boolean));
  return (option) => {
    const on = normText(option);
    if (!on) return false;
    if (set.has(on)) return true;
    for (const w of set) if (similarity(on, w) >= 0.9) return true;
    return false;
  };
}

// Return `preferIdx` unless it maps to a known-wrong option, else the first allowed one.
function firstAllowedOption(options, isWrong, preferIdx) {
  if (preferIdx >= 0 && preferIdx < options.length && !isWrong(options[preferIdx])) return preferIdx;
  for (let i = 0; i < options.length; i++) if (!isWrong(options[i])) return i;
  return preferIdx;
}

// Local-bank matches: hits flagged wrong (or whose answer/option is stored as
// wrong) are strictly excluded, and `verified: true` hits always sort first so
// Tier 1 can only ever click an answer Moodle already confirmed.
function rankLocalMatches(matches, isWrong) {
  const allowed = (matches || []).filter((match) =>
    match && match.wrong !== true && !isWrong(match.option) && !isWrong(match.answer));
  return allowed.sort((a, b) => (b.verified === true ? 1 : 0) - (a.verified === true ? 1 : 0));
}

async function handleQuestion(data) {
  const { text, options, elements, kind, images } = data;
  const qkey = elemSig(elements);
  logHUD('info', 'Q: '+text.slice(0,80));

  // Review page grade detection: when user clicks Run on /mod/quiz/review.php
  if(isReviewPage()){
    const container = (elements && elements[0] && elements[0].closest) ? elements[0].closest('.que') : null;
    const scope = container || document;
    const grade = parseGradeFromReview(scope);
    if(grade){
      const gradeLabel = (grade.earned == null ? '?' : grade.earned) + '/' + (grade.max == null ? '?' : grade.max);
      if(grade.correct === true && kind !== 'select'){
        // Matching blocks are learned per dropdown row further down (and on the
        // review pass) — saving the first row's `.rightanswer` under the shared
        // header would store one pair for the whole block.
        // Prefer the per-question correct-answer block; fall back to a ".correct" option.
        const questionElem = scope.querySelector('.qtext, .question, .questiontext') || scope;
        const questionText = normalizeReviewText(questionElem ? (questionElem.innerText || questionElem.textContent) : '');
        const answerElem = scope.querySelector('.rightanswer, .correctanswer, .answ .correct, .correct');
        const answerText = normalizeReviewText(answerElem ? (answerElem.innerText || answerElem.textContent) : '')
          .replace(/^The correct answer is\s*:\s*/i, '');
        if(questionText && answerText){
          const saved = await saveCorrectAnswerFromReview(questionText, answerText);
          logHUD('success', 'Grade detected: '+gradeLabel+' - '+(saved ? 'Saved answer permanently' : 'Answer already known'));
          if(saved){ await flushNow(); requestGitHubBankPush(); }
        }
      }else if(grade.correct === false){
        logHUD('info', 'Grade detected: '+gradeLabel+' - Answer was incorrect, not saved');
      }
    }
    // Continue with normal question handling after grade processing
  }

  if (kind === 'select') {
    // One `.que.match` block = many dropdown rows sharing one item list. Each
    // row is keyed by its own sub-statement; unanswered rows are resolved by a
    // single batch AI request instead of one call per dropdown.
    const { rows, header } = collectMatchingRows(elements, text);
    const statements = rows.map((row) => row.subStatement);
    const container = elements[0] && elements[0].closest ? elements[0].closest('.que') : null;

    if (!isMatchingBlock(container)) {
      // Inline dropdown blanks ("select missing word") are not rows: keep the
      // legacy resolver, but still log each pair under its row number.
      const n = elements.length;
      const legacy = await resolveMatching(header, statements, options, n);
      if (legacy.keyed + legacy.aiMatched === 0) {
        logHUD('warn','Waiting for manual dropdowns...');
        const ok = await waitForManual(elements, 'select', text, options, statements);
        if (!ok) logHUD('warn','Manual dropdown timeout');
        return ok;
      }
      for (let i = 0; i < n; i++) {
        if (legacy.idxs[i] === -1) continue;
        await selectAnswer(elements[i], options[legacy.idxs[i]]);
        logHUD('info', 'Matched row ' + (i + 1) + ': ' + options[legacy.idxs[i]]);
      }
      return true;
    }

    const unanswered = rows.filter((row) => !hasMatchingSelection(row.element));
    if (!unanswered.length) {
      logHUD('info', 'Matching question already answered');
      return true;
    }
    // Items already chosen by the learner are off-limits for the remaining rows.
    const used = new Set();
    for (const row of rows) {
      if (!hasMatchingSelection(row.element)) continue;
      const index = currentMatchingOptionIndex(row.element, options);
      if (index !== -1) used.add(index);
    }
    const filled = await fillMatchingFromBank(unanswered, options, used);
    const pending = unanswered.filter((row) => !filled.has(row.rowIndex));
    if (!pending.length) return true;

    let aiMatched = 0;
    try {
      const batch = await resolveMatchingBatch(
        pending.map((row) => ({ rowIndex: row.rowIndex, subStatement: row.subStatement })),
        options,
        header
      );
      const assignments = (batch && batch.assignments) || {};
      for (const row of pending) {
        const answer = assignments[String(row.rowIndex)];
        if (!answer) continue;
        const index = matchingOptionIndex(answer, options, used);
        if (index === -1) continue;
        if (!setMatchingSelect(row.element, options[index])) continue;
        used.add(index);
        aiMatched += 1;
        logHUD('success', 'Matched row ' + row.rowIndex + ': ' + options[index]);
      }
      if (aiMatched > 0) {
        logHUD('info', 'Matching batch: ' + aiMatched + '/' + pending.length + ' dropdown(s) resolved in one request');
      }
    } catch (error) {
      logHUD('warn', 'Matching batch failed: ' + error.message);
    }

    if (filled.size + aiMatched === 0) {
      logHUD('warn','Waiting for manual dropdowns...');
      const ok = await waitForManual(elements, 'select', text, options, statements);
      if (!ok) logHUD('warn','Manual dropdown timeout');
      return ok;
    }
    return true;
  }

  if (kind === 'check') {
    const isWrong = await buildWrongOptionFilter(text, options);
    const localMatches = rankLocalMatches(await localBankOptionMatches(text, options), isWrong);
    if (localMatches.length) {
      for (const match of localMatches) {
        const element = elements[match.index];
        if (element && !element.checked) element.click();
        logHUD('info', 'Tier 1 (Local Bank): ' + match.option);
      }
      return true;
    }
    let picks = await askAiMulti(text, options, images);
    picks = (picks || []).filter((p) => p >= 0 && p < options.length && !isWrong(options[p]));
    if (!picks.length) {
      logHUD('warn','Waiting for manual checkboxes...');
      const ok = await waitForManual(elements, 'check', text, options);
      if (!ok) logHUD('warn','Manual checkbox timeout');
      return ok;
    }
    for (const p of picks) {
      if (p < elements.length && !elements[p].checked) {
        elements[p].click();
        logHUD('info', 'Ticked '+(p+1));
      }
    }
    return true;
  }

  if (kind === 'text') {
    const ans = await askAiText(text);
    if (!ans) {
      logHUD('warn','Waiting for manual text input...');
      const ok = await waitForManual(elements, 'text', text);
      if (!ok) logHUD('warn','Manual text timeout');
      return ok;
    }
    typeAnswer(elements[0], ans);
    logHUD('success', 'Typed: '+ans.slice(0,60));
    return true;
  }

  // Radio / MCQ
  const isWrong = await buildWrongOptionFilter(text, options);
  const localMatches = rankLocalMatches(await localBankOptionMatches(text, options), isWrong);
  if (localMatches.length) {
    const match = localMatches[0];
    if (elements[match.index]) elements[match.index].click();
    logHUD('info', 'Tier 1 (Local Bank): ' + match.option);
    return true;
  }
  let idx = await askAi(text, options, images);
  // Safety net: never click a stored-wrong option even if a provider returns one.
  if (idx !== -1 && isWrong(options[idx])) idx = firstAllowedOption(options, isWrong, idx);
  if (idx === -1) {
    logHUD('warn','Waiting for manual selection...');
    const ok = await waitForManual(elements, 'radio', text, options);
    if (!ok) logHUD('warn','Manual selection timeout');
    return ok;
  }
  if (idx < elements.length) {
    elements[idx].click();
    logHUD('success', 'Option '+(idx+1)+': '+options[idx].slice(0,60));
  }
  return true;
}

async function startLoop() {
  if (_loopActive) return;
  await ensureLoaded();
  await loadConfig();
  await chrome.storage.sync.get('BOT_ENABLED', async (r) => {
    if (r.BOT_ENABLED === false) {
      logHUD('error', 'Bot disabled in settings');
      return;
    }
    _loopActive = true;
    _stopRequested = false;
    setHUDStatus('running');
    createHUD();
    logHUD('info', 'Bot started');
    _hudRoot?.classList?.add('active');

    const handledQuestions = new Set();
    let totalAnswered = 0;
    let emptyScans = 0;
    let stalls = 0;
    let reviewPageHandled = '';
    const startTime = Date.now();
    const maxRun = 8 * 60 * 60 * 1000;

    while (!_stopRequested) {
      if (Date.now() - startTime > maxRun) {
        logHUD('error', '8-hour max runtime reached');
        break;
      }
      await new Promise(r => setTimeout(r, cfg('SCAN_INTERVAL')));
      if (isReviwPg()) {
        const pageId = typeof location === 'undefined' ? 'review' : location.href;
        if (pageId !== reviewPageHandled) {
          reviewPageHandled = pageId;
          try {
            const learned = await learnFromReviewPage();
            logHUD('info', `Review page: learned ${learned.right} right, ${learned.wrong} wrong` +
              (learned.matching ? `, ${learned.matching} matching pair(s)` : '') +
              (learned.deduced ? `, ${learned.deduced} deduced` : ''));
            if (learned.right > 0) {
              await flushNow();
              requestGitHubBankPush();
            }
          } catch (error) {
            logHUD('error', 'Review page learning failed: ' + error.message);
          }
        }
        continue;
      }
      reviewPageHandled = '';
      if (!isQuizPg()) {
        emptyScans++;
        if (emptyScans > 30 && totalAnswered > 0) {
          logHUD('info', 'No quiz page - idle');
        }
        continue;
      }

      try {
        const data = extractQuestionData();
        if (!data) {
          emptyScans++;
          if (emptyScans >= 6 && totalAnswered > 0) {
            logHUD('info', 'All answered - advancing');
            const ok = cfg('AUTO_CLICK_NEXT') ? await clickNext() : false;
            if (!ok) await clickFinish();
            handledQuestions.clear();
          }
          continue;
        }
        emptyScans = 0;
        totalAnswered++;
        addResultEntry(data.text, '', '', '');

        const sig = elemSig(data.elements);
        if (handledQuestions.has(sig)) continue;
        handledQuestions.add(sig);

        const ok = await handleQuestion(data);
        if (!ok && data.kind !== 'select') {
          stalls++;
          if (stalls > 5) {
            logHUD('warn', 'Too many stalls - advancing');
            stalls = 0;
          }
        } else {
          stalls = 0;
        }

        if (cfg('PAUSE_AFTER_ANSWER') > 0) await new Promise(r => setTimeout(r, cfg('PAUSE_AFTER_ANSWER')));
      } catch (e) {
        logHUD('error', 'Error: '+e.message.slice(0,100));
      }
    }

    _loopActive = false;
    setHUDStatus('stopped');
    logHUD('info', 'Bot stopped');
    if (_hudRoot) _hudRoot.classList.remove('active');
  });
}

// Auto-start when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  createHUD();
  logHUD('info', 'Moodle Quiz Bot loaded');
  startAutoHarvest();
  // Auto-start checked via startLoop which checks BOT_ENABLED
  chrome.storage.sync.get('BOT_ENABLED', (r) => {
    if (r.BOT_ENABLED !== false) startLoop();
  });
});

// Also try immediate start
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  loadConfig().then(() => {
    createHUD();
    startAutoHarvest();
    chrome.storage.sync.get('BOT_ENABLED', (r) => {
      if (r.BOT_ENABLED !== false) startLoop();
    });
  });
}
