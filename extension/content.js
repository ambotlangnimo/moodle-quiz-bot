let _stopRequested = false, _loopActive = false, _hudShadow = null, _hudRoot = null, _lastExtractionWarning = '';
const _autoHarvestRequested = new Set();
const HARVEST_STOP_WORDS = new Set([
  'a', 'an', 'and', 'of', 'the', 'for', 'in', 'its', 'to', 'with',
  'introduction', 'principles', 'applications', 'fundamentals',
]);

function createHUD() {
  if (_hudRoot) return;
  _hudRoot = document.createElement('div');
  _hudRoot.id = 'moodle-quiz-bot-hud';
  _hudShadow = _hudRoot.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  fetch(chrome.runtime.getURL('hud.css')).then(r=>r.text()).then(c=>{style.textContent=c;}).catch(()=>{});
  _hudShadow.appendChild(style);
  const root = document.createElement('div'); root.id = 'hud-root';
  root.innerHTML = '<div id="hud-header"><span id="hud-title">Quiz Bot</span><span id="hud-status">idle</span></div><div id="hud-body"></div><div id="hud-footer"><button class="hud-btn" id="hud-stop-btn">Stop</button><button class="hud-btn" id="hud-clear-btn">Clear</button><button class="hud-btn" id="hud-harvest-btn">Harvest</button><button class="hud-btn" id="hud-toggle-btn">Run</button></div>';
  _hudShadow.appendChild(root); document.body.appendChild(_hudRoot);
  _hudShadow.getElementById('hud-stop-btn').onclick = () => { _stopRequested = true; logHUD('error','Stop'); };
  _hudShadow.getElementById('hud-clear-btn').onclick = () => { _hudShadow.getElementById('hud-body').innerHTML = ''; };
  _hudShadow.getElementById('hud-harvest-btn').onclick = () => requestCourseHarvest(true);
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

function parseGradeFromReview(){
  if(!document.querySelector('.grade'))return null;
  const gradeText = document.querySelector('.grade').innerText || '';
  const m = gradeText.match(/Mark\s+([0-9.]+)\s+out\s+of\s+([0-9.]+)/i);
  if(!m)return null;
  const earned = parseFloat(m[1]);
  const max = parseFloat(m[2]);
  return {earned, max};
}

function isReviewPage(){
  return location.pathname.includes('/mod/quiz/review.php');
}

async function saveCorrectAnswerFromReview(question, answer){
  if(!answer||!answer.trim())return;
  const key = normText(question);
  const value = answer.trim();
  if(!key||!value)return;
  const hits = await answerKeyGet(key);
  const answerNorm = normText(value);
  if(!hits.some((hit) => hit && normText(hit.answer)===answerNorm)){
    await answerKeyPut(key, value, 'review-saved');
  }
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
  const isCoursePage = pathname.includes('/course/view.php');
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
    const clone=node.cloneNode(true);
    clone.querySelectorAll('input, script, style, .sr-only, .accesshide, .answernumber').forEach(child=>child.remove());
    return (clone.innerText||clone.textContent||'').replace(/\s+/g,' ').trim();
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
function getCandidates(el) {
  const BLOCK = new Set(['P','DIV','LI','UL','OL','BR','TR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','TABLE']);
  const SKIP = new Set(['SCRIPT','STYLE','BUTTON','OPTION','NOSCRIPT']);
  const walk = (root) => {
    let out = '';
    const rec = (node) => {
      if (node.nodeType === 3) { out += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') { out += ' ______ '; return; }
      if (SKIP.has(tag)) return;
      const cls = String(node.className || '');
      if (/\bsr-only|visually-hidden|accesshide|answerlabel\b/.test(cls)) return;
      const isBlock = BLOCK.has(tag);
      if (isBlock) out += '\n';
      for (const c of node.childNodes) rec(c);
      if (isBlock) out += '\n';
    };
    rec(root);
    return out;
  };
  const out = [];
  let lab = null;
  if (el.id) { try { lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); } catch (e) {} }
  if (!lab) { try { lab = el.closest('label'); } catch (e) {} }
  if (lab) out.push(walk(lab));
  let n = el;
  for (let d = 0; d < 4; d++) {
    n = n.parentElement;
    if (!n) break;
    out.push(walk(n));
  }
  return out;
}
function isReviwPg(){return (typeof location!=='undefined'&&location.pathname.includes('/review.php'))||!!document.querySelector('.rightanswer, .reviewsummary, .que.correct, .que.incorrect, .que.partiallycorrect, .outcome .feedback');}const NAV_S = '__navigating__';

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
    const selects = cfg('MATCHING_ENABLED') ? Array.from(c.querySelectorAll('div.answer select, .answer select, select')) : [];
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
async function learnFromReviewPage() {
  const learned = { right: 0, wrong: 0 };
  const containers = Array.from(document.querySelectorAll('.que'));
  for (const c of containers) {
    const qText = qTxt(c);
    if (!qText) continue;
    const classes = new Set(String(c.className || '').toLowerCase().split(/\s+/));
    const feedback = Array.from(c.querySelectorAll('.feedback'))
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase())
      .join(' ');
    const rightAnswers = c.querySelectorAll('.rightanswer');
    const overall = classes.has('incorrect') ? 'wrong'
      : classes.has('correct') ? 'right'
      : classes.has('partiallycorrect') ? 'partial'
      : /\byour answer is incorrect\b|\bis incorrect\b/.test(feedback) ? 'wrong'
      : /\byour answer is correct\b|\bis correct\b/.test(feedback) ? 'right'
      : '';
    const savedRight = new Set();
    const savedWrong = new Set();
    const saveRight = async (answer) => {
      const value = (answer || '').replace(/\s+/g, ' ').trim();
      const signature = normText(value);
      if (!signature || savedRight.has(signature)) return;
      savedRight.add(signature);
      await answerKeyPut(qText, value);
      learned.right++;
    };
    const saveWrong = async (answer) => {
      const value = (answer || '').replace(/\s+/g, ' ').trim();
      const signature = normText(value);
      if (!signature || savedWrong.has(signature)) return;
      savedWrong.add(signature);
      await wrongSet(qText, value);
      learned.wrong++;
    };
    const optionOutcome = (el, useOverall = true) => {
      let node = el;
      while (node && node !== c) {
        const rowClasses = new Set(String(node.className || '').toLowerCase().split(/\s+/));
        if (rowClasses.has('incorrect')) return 'wrong';
        if (rowClasses.has('correct')) return 'right';
        node = node.parentElement;
      }
      return useOverall && overall !== 'partial' ? overall : '';
    };

    for (const rightAnswer of rightAnswers) {
      const answer = (rightAnswer.textContent || rightAnswer.innerText || '')
        .replace(/^\s*The correct answer is\s*:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.$/, '');
      await saveRight(answer);
    }

    for (const input of c.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
      if (input.value === '-1') continue;
      const answer = optTxt(input);
      const rowResult = optionOutcome(input, false);
      if (rowResult === 'right') await saveRight(answer);
      else if (input.checked) {
        const result = rowResult || optionOutcome(input);
        if (result === 'right') await saveRight(answer);
        else if (result === 'wrong') await saveWrong(answer);
      }
    }

    for (const input of c.querySelectorAll('input[type="text"]')) {
      const answer = (input.value || '').trim();
      if (!answer) continue;
      const result = optionOutcome(input);
      if (result === 'right') await saveRight(answer);
      else if (result === 'wrong') await saveWrong(answer);
    }
  }
  return learned;
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
async function handleQuestion(data) {
  const { text, options, elements, kind, images } = data;
  const qkey = elemSig(elements);
  logHUD('info', 'Q: '+text.slice(0,80));

  // Review page grade detection: when user clicks Run on /mod/quiz/review.php
  if(isReviewPage()){
    const grade = parseGradeFromReview();
    if(grade){
      // If earned > 0 and earned >= max, or answer is correct, save it permanently
      const isCorrect = grade.earned > 0 && grade.earned >= grade.max;
      if(isCorrect){
        // Find the question text from the current quiz attempt display
        const questionElem = document.querySelector('.que .qtext,.que .question,.questiontext');
        const questionText = questionElem ? questionElem.innerText || questionElem.textContent || '' : '';
        const answerElem = document.querySelector('.que .correct,.que .correctanswer,.answ .correct');
        const answerText = answerElem ? (answerElem.innerText || answerElem.textContent || '') : '';
        if(questionText && answerText){
          await saveCorrectAnswerFromReview(questionText, answerText);
          logHUD('success', 'Grade detected: '+grade.earned+'/'+grade.max+' - Saved answer permanently');
        }
      }else if(grade.earned === 0){
        // Answer was wrong, don't save (but could mark as wrong if needed)
        logHUD('info', 'Grade detected: '+grade.earned+'/'+grade.max+' - Answer was incorrect, not saved');
      }
    }
    // Continue with normal question handling after grade processing
  }

  if (kind === 'select') {
    const n = elements.length;
    const header = text.split('\n').filter(l => !BLANK_RE.test(l)).join(' ').slice(0,300);
    const statements = [];
    for (const el of elements) {
      const cands = getCandidates(el);
      let s = '';
      for (const c of cands) {
        const cl = c.replace(/\s+/g,' ').trim();
        const clean = cl.replace(PLACEHOLDER_RE,' ').trim();
        if (clean.length > 10) { s = clean; break; }
      }
      statements.push(s);
    }
    while (statements.length < n) statements.push('');
    const { idxs, src, keyed, aiMatched } = await resolveMatching(header, statements, options, n);
    if (keyed + aiMatched === 0) {
      logHUD('warn','Waiting for manual dropdowns...');
      const ok = await waitForManual(elements, 'select', text, options, statements);
      if (!ok) logHUD('warn','Manual dropdown timeout');
      return ok;
    }
    for (let i = 0; i < n; i++) {
      if (idxs[i] === -1) continue;
      await selectAnswer(elements[i], options[idxs[i]]);
      logHUD('info', 'Dropdown '+(i+1)+' set: '+options[idxs[i]].slice(0,40));
    }
    return true;
  }

  if (kind === 'check') {
    const localMatches = await localBankOptionMatches(text, options);
    if (localMatches.length) {
      for (const match of localMatches) {
        const element = elements[match.index];
        if (element && !element.checked) element.click();
        logHUD('info', 'Tier 1 (Local Bank): ' + match.option);
      }
      return true;
    }
    const picks = await askAiMulti(text, options, images);
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
  const localMatches = await localBankOptionMatches(text, options);
  if (localMatches.length) {
    const match = localMatches[0];
    if (elements[match.index]) elements[match.index].click();
    logHUD('info', 'Tier 1 (Local Bank): ' + match.option);
    return true;
  }
  const idx = await askAi(text, options, images);
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
            logHUD('info', `Review page: learned ${learned.right} right, ${learned.wrong} wrong`);
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
