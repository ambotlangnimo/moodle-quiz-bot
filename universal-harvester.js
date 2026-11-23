/* ─────────────────────────────────────────────────────────────────────────────
   universal-harvester.js — Harvest Q&A pairs from any study site.

   Injected on <all_urls> (but NOT on amaes.com, where content.js keeps its own
   Moodle HUD). It renders a small dark-glass panel (#qb-hud) with:

     • Harvest Page   — highlighted text first, then amauoed.com cards, Quizlet
                        term pairs, or a generic question/answer DOM heuristic
     • Harvest Course — loops ?page=1, ?page=2, … for multi-page course pages
     • Stop           — aborts an in-flight course fetch loop
     • — / 🐾          — minimize to a compact floating pill

   Every pair goes through answerKeyPut(q, a, 'harvested-<site>', { verified })
   from storage.js; flushNow() persists the bank and SYNC_GITHUB_BANK pushes the
   verified rows to the ama-quiz-bank GitHub repo.

   BOT_ENABLED (the popup switch, chrome.storage.local + .sync) is watched here:
   `false` hides the panel / 🐾 pill at once and aborts an in-flight run, `true`
   brings the panel back — neither needs a page reload.

   HUD rows are appended to #qb-log as .hud-log-line.<level> and the status chip
   uses the shared running / stopped / waiting / reviewing classes, so mascot.js
   narrates the run with harvesting.gif and review.gif without extra wiring.

   This file is strictly read-only towards the page: it never clicks, types,
   submits or navigates.
   ───────────────────────────────────────────────────────────────────────────── */
try {
  (function () {
    'use strict';

    /* ── Configuration ──────────────────────────────────────────────────── */

    const HUD_ID = 'qb-hud';
    const LOG_ID = 'qb-log';
    const STATUS_ID = 'qb-status';

    const MAX_COURSE_PAGES = 80;
    const FETCH_TIMEOUT_MS = 20000;
    const MAX_GENERIC_NODES = 2000;
    const MAX_GENERIC_PAIRS = 300;
    const QUESTION_MAX_CHARS = 1200;
    const ANSWER_MAX_CHARS = 600;

    // Auto-expanded here; everywhere else the HUD starts as a floating pill.
    const STUDY_HOSTS = [
      'amaes.com',
      'amauoed.com',
      'quizlet.com',
      'studocu.com',
      'brainly.ph',
      'brainly.com',
      'coursehero.com',
      'scribd.com',
    ];

    // Other hosts where an expanded HUD is handy (search engines / Q&A sites).
    const EXTRA_EXPAND_HOSTS = [
      'google.com',
      'google.com.ph',
      'bing.com',
      'duckduckgo.com',
      'chegg.com',
      'bartleby.com',
      'numerade.com',
    ];

    const AUTO_EXPAND_HOSTS = STUDY_HOSTS.concat(EXTRA_EXPAND_HOSTS);

    // Never treat chrome/settings-style text as an answer.
    const STOP_ANSWERS = new Set([
      'answer',
      'answers',
      'show answer',
      'show answers',
      'see answer',
      'reveal answer',
      'hide answer',
      'check answer',
      'submit',
      'submit answer',
      'next',
      'next question',
      'previous',
      'previous question',
      'back',
      'continue',
      'login',
      'log in',
      'sign in',
      'sign up',
      'register',
      'share',
      'menu',
      'search',
      'loading',
      'loading...',
      'correct',
      'incorrect',
      'right',
      'wrong',
      'true or false',
      'select one',
      'choose one',
      'not sure',
      'skip',
    ]);

    const PAGINATION_SELECTORS = [
      'a[rel="next"]',
      '.pagination a',
      '.pager a',
      'nav[aria-label*="pagination" i] a',
      '[class*="pagination" i] a',
      '[class*="pager" i] a',
    ];

    const QUESTION_SELECTOR = [
      'p',
      'li',
      'dt',
      'summary',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'blockquote',
      '.question',
      '.question-text',
      '.qtext',
      '.prompt',
      '[class*="question" i]',
      '[data-testid*="question" i]',
    ].join(', ');

    const ANSWER_SELECTOR = [
      'strong',
      'b',
      'mark',
      '.answer',
      '.answers',
      '.correct',
      '.right-answer',
      '.rightanswer',
      '[class*="answer" i]',
      '[class*="correct" i]',
      '[data-testid*="answer" i]',
    ].join(', ');

    /* ── State ──────────────────────────────────────────────────────────── */

    let hudEl = null;
    let logEl = null;
    let statusEl = null;
    let minimizeBtn = null;
    let pageBtn = null;
    let courseBtn = null;
    let stopBtn = null;

    let collapsed = false;
    let busy = false;
    let stopRequested = false;
    let abortController = null;
    let dragState = null;

    // Lines produced before the HUD is attached; replayed on mount.
    const pendingLog = [];

    // BOT_ENABLED mirror (the popup switch). When it flips off the panel and the
    // 🐾 pill are hidden at once and any running harvest is aborted — no reload.
    let botEnabled = true;
    let enabledWatched = false;

    /* ── Small helpers ──────────────────────────────────────────────────── */

    function norm(value) {
      return String(value == null ? '' : value)
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function currentHost() {
      try {
        return String(location.hostname || '').toLowerCase();
      } catch (error) {
        return '';
      }
    }

    function hostMatches(host, domain) {
      const clean = String(host || '').toLowerCase();
      const target = String(domain || '').toLowerCase();
      return clean === target || clean.endsWith('.' + target);
    }

    function hostInList(host, list) {
      return list.some((domain) => hostMatches(host, domain));
    }

    // Study / Q&A hosts where the panel opens expanded instead of as a pill.
    function isStudyHost() {
      return hostInList(currentHost(), AUTO_EXPAND_HOSTS);
    }

    function isAmauoed() {
      return hostMatches(currentHost(), 'amauoed.com');
    }

    function isQuizlet() {
      return hostMatches(currentHost(), 'quizlet.com');
    }

    // 'harvested-amauoed', 'harvested-quizlet', … — same shape as the existing
    // 'harvested-amauoed' source tag used by background.js.
    function sourceTagForHost(host) {
      const clean = String(host || '').toLowerCase().replace(/^www\./, '');
      const label = clean.split('.')[0].replace(/[^a-z0-9-]/g, '');
      return 'harvested-' + (label || 'site');
    }

    function pairSignature(pair) {
      return (pair.question + '\u0000' + pair.answer).toLowerCase();
    }

    function safeSendMessage(message, callback) {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          if (callback) callback(null, 'extension context unavailable');
          return;
        }
        chrome.runtime.sendMessage(message, (response) => {
          const lastError = chrome.runtime.lastError;
          if (callback) callback(response || null, lastError ? lastError.message : '');
        });
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (callback) callback(null, message);
      }
    }

    /* ── Text cleanup ───────────────────────────────────────────────────── */

    const CHECK_MARK_RE = /^[\s\u2705\u2714\u2713\u2611\u2610\uFE0F]+/;
    const QUESTION_PREFIX_RE = /^(?:q(?:uestion)?\s*#?\s*\d*\s*[:.)\-]|(?:\d{1,3})[.)])\s*/i;
    const ANSWER_LABEL_RE = /^(?:(?:correct|right)\s+)?(?:answer|ans)\s*[:.)\-]\s*/i;
    const CORRECT_LABEL_RE = /^(?:correct|right)\s*[:.)\-]\s*/i;

    function stripCheckMarks(text) {
      return norm(String(text || '').replace(CHECK_MARK_RE, ''));
    }

    function cleanQuestion(text) {
      return norm(text)
        .replace(QUESTION_PREFIX_RE, '')
        .replace(/\s*\bselect (?:one|an option)\b\s*$/i, '')
        .replace(/\s*\bchoose (?:one|an option)\b\s*$/i, '')
        .trim();
    }

    function cleanAnswer(text) {
      let value = norm(text);
      value = value.replace(ANSWER_LABEL_RE, '');
      value = value.replace(CORRECT_LABEL_RE, '');
      value = stripCheckMarks(value);
      value = value.replace(/\s*\bcorrect\b\s*$/i, '').trim();
      return value;
    }

    /**
     * Validate + normalise one Q/A pair. Returns null for UI noise, navigation
     * labels, duplicated text and absurdly long blocks.
     */
    function makePair(questionText, answerText, verified) {
      const question = cleanQuestion(questionText).slice(0, QUESTION_MAX_CHARS);
      const answer = cleanAnswer(answerText).slice(0, ANSWER_MAX_CHARS);
      // Short terms are normal on Quizlet/amauoed; the generic extractor already
      // filters its own candidates through looksLikeQuestion().
      if (question.length < 3 || answer.length < 1) return null;

      const qLower = question.toLowerCase();
      const aLower = answer.toLowerCase();
      if (qLower === aLower) return null;
      if (STOP_ANSWERS.has(qLower) || STOP_ANSWERS.has(aLower)) return null;
      // An "answer" that repeats the whole question is a container, not an answer.
      if (aLower.length > 24 && qLower.includes(aLower)) return null;
      if (qLower.length > 24 && aLower.includes(qLower)) return null;
      // Real answers rarely end with '?' (True/False aside).
      if (answer.endsWith('?') && !/^(?:true|false)$/i.test(answer)) return null;
      // Pure punctuation / counters.
      if (!/[a-z0-9\u00c0-\u024f]/i.test(answer)) return null;

      return { question, answer, verified: !!verified };
    }

    /* ── HUD logging (shared #qb-log / .hud-log-line classes) ───────────── */

    function appendLogLine(level, text) {
      if (!logEl) return;
      const row = document.createElement('div');
      row.className = 'hud-log-line ' + level;
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      row.textContent = '[' + stamp + '] ' + text;
      logEl.appendChild(row);
      while (logEl.children.length > 120) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function logHUD(level, text) {
      const safeLevel = String(level || 'info');
      const message = String(text == null ? '' : text);
      if (!logEl) {
        pendingLog.push([safeLevel, message]);
        if (pendingLog.length > 60) pendingLog.shift();
      } else {
        appendLogLine(safeLevel, message);
      }
      try {
        console.log('[Harvest/' + safeLevel + '] ' + message);
      } catch (error) { /* console may be unavailable */ }
    }

    // mascot.js tees this function when it boots; keeping the same global name
    // as content.js means the 7-cat reacts to HUD output on every site.
    window.logHUD = logHUD;

    function setStatus(text, className) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.className = className || '';
      statusEl.title = text;
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    /* ── Instant enable/disable (BOT_ENABLED) ───────────────────────────── */

    // popup.js writes BOT_ENABLED to chrome.storage.local and mirrors it to
    // .sync; local wins when present, `!== false` means enabled.
    function readBotEnabled(callback) {
      const done = (value) => { try { callback(value !== false); } catch (error) { /* ignore */ } };
      try {
        chrome.storage.local.get('BOT_ENABLED', (local) => {
          if (chrome.runtime.lastError) { done(true); return; }
          if (local && local.BOT_ENABLED !== undefined) { done(local.BOT_ENABLED); return; }
          try {
            chrome.storage.sync.get('BOT_ENABLED', (sync) => {
              if (chrome.runtime.lastError) { done(true); return; }
              done(sync ? sync.BOT_ENABLED : undefined);
            });
          } catch (error) { done(true); }
        });
      } catch (error) { done(true); }
    }

    // Show/hide the panel with an inline display: #qb-hud is a flex column, so
    // restoring with 'flex' keeps the expanded panel and the 🐾 pill identical.
    function setPanelVisible(visible) {
      if (!hudEl) return;
      hudEl.style.display = visible ? 'flex' : 'none';
    }

    function applyBotEnabled(enabled) {
      const next = enabled !== false;
      const changed = next !== botEnabled;
      botEnabled = next;
      if (!next) {
        if (busy) {
          // Kills the in-flight page/course run immediately.
          stopRequested = true;
          if (abortController) {
            try { abortController.abort(); } catch (error) { /* already aborted */ }
          }
          setBusy(false);
          setStatus('stopped', 'stopped');
          logHUD('warn', changed ? 'Bot stopped — disabled from the popup.' : 'Bot stopped.');
        }
        setPanelVisible(false);
        return;
      }
      setPanelVisible(true);
      if (changed) logHUD('info', 'Bot enabled — harvester ready.');
    }

    function watchBotEnabled() {
      if (enabledWatched) return;
      enabledWatched = true;
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
        chrome.storage.onChanged.addListener((changes, areaName) => {
          try {
            if (areaName !== 'local' && areaName !== 'sync') return;
            if (!changes || !changes.BOT_ENABLED) return;
            const value = changes.BOT_ENABLED.newValue;
            applyBotEnabled(value === undefined ? true : value);
          } catch (error) { /* never break the page */ }
        });
      } catch (error) { /* storage events unavailable */ }
      readBotEnabled((enabled) => applyBotEnabled(enabled));
    }

    /* ── HUD construction ───────────────────────────────────────────────── */

    function makeButton(id, label, title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = id;
      button.className = 'qb-btn';
      button.textContent = label;
      button.title = title || label;
      return button;
    }

    function setCollapsed(next) {
      collapsed = !!next;
      if (!hudEl) return;
      hudEl.classList.toggle('qb-collapsed', collapsed);
      hudEl.classList.toggle('qb-expanded', !collapsed);
      if (minimizeBtn) {
        minimizeBtn.textContent = collapsed ? '🐾' : '—';
        minimizeBtn.title = collapsed ? 'Expand harvester' : 'Minimize harvester';
        minimizeBtn.setAttribute('aria-label', minimizeBtn.title);
        minimizeBtn.setAttribute('aria-expanded', String(!collapsed));
      }
    }

    function flushPendingLog() {
      const rows = pendingLog.splice(0, pendingLog.length);
      rows.forEach(([level, text]) => appendLogLine(level, text));
    }

    function buildHud() {
      const existing = document.getElementById(HUD_ID);
      if (existing) {
        hudEl = existing;
        logEl = existing.querySelector('#' + LOG_ID);
        statusEl = existing.querySelector('#' + STATUS_ID);
        setPanelVisible(botEnabled);
        return;
      }

      const hud = document.createElement('div');
      hud.id = HUD_ID;
      hud.className = 'qb-hud';
      hud.setAttribute('role', 'complementary');
      hud.setAttribute('aria-label', 'Quiz bank harvester');

      const header = document.createElement('div');
      header.id = 'qb-hud-header';

      const title = document.createElement('span');
      title.id = 'qb-hud-title';
      title.textContent = '🐾 Harvest';

      statusEl = document.createElement('span');
      statusEl.id = STATUS_ID;
      statusEl.textContent = 'idle';

      minimizeBtn = document.createElement('button');
      minimizeBtn.type = 'button';
      minimizeBtn.id = 'qb-minimize-btn';
      minimizeBtn.textContent = '—';
      minimizeBtn.title = 'Minimize harvester';
      minimizeBtn.setAttribute('aria-label', 'Minimize harvester');
      minimizeBtn.setAttribute('aria-expanded', 'true');

      header.append(title, statusEl, minimizeBtn);

      const body = document.createElement('div');
      body.id = 'qb-hud-body';

      logEl = document.createElement('div');
      logEl.id = LOG_ID;
      logEl.className = 'qb-log';
      logEl.setAttribute('role', 'log');
      logEl.setAttribute('aria-live', 'polite');
      body.appendChild(logEl);

      const hint = document.createElement('div');
      hint.id = 'qb-hud-hint';
      hint.textContent = 'Highlight text for an instant capture, or harvest the whole page.';
      body.appendChild(hint);

      const actions = document.createElement('div');
      actions.id = 'qb-actions';

      pageBtn = makeButton('qb-harvest-page', 'Harvest Page', 'Harvest Q&A pairs from this page');
      courseBtn = makeButton('qb-harvest-course', 'Harvest Course', 'Loop ?page=1, ?page=2, … for this course');
      stopBtn = makeButton('qb-stop', 'Stop', 'Stop the running harvest');

      actions.append(pageBtn, courseBtn, stopBtn);
      hud.append(header, body, actions);

      const anchor = document.body || document.documentElement;
      anchor.appendChild(hud);

      hudEl = hud;
      bindHudEvents(header);
      setCollapsed(!isStudyHost());
      refreshCourseButton();
      setBusy(false);
      setStatus('idle', '');
      setPanelVisible(botEnabled);
      flushPendingLog();
    }

    function bindHudEvents(header) {
      if (!header || !hudEl) return;

      minimizeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setCollapsed(!collapsed);
      });

      pageBtn.addEventListener('click', () => {
        harvestPage();
      });

      courseBtn.addEventListener('click', () => {
        harvestCourse();
      });

      stopBtn.addEventListener('click', () => {
        requestStop();
      });

      header.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (event.target && event.target.closest && event.target.closest('button')) return;
        const rect = hudEl.getBoundingClientRect();
        dragState = {
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
        };
        hudEl.style.left = rect.left + 'px';
        hudEl.style.top = rect.top + 'px';
        hudEl.style.right = 'auto';
        hudEl.style.bottom = 'auto';
        event.preventDefault();
      });

      document.addEventListener('mousemove', (event) => {
        if (!dragState || !hudEl) return;
        const maxLeft = Math.max(0, window.innerWidth - hudEl.offsetWidth - 4);
        const maxTop = Math.max(0, window.innerHeight - hudEl.offsetHeight - 4);
        const left = Math.min(maxLeft, Math.max(4, event.clientX - dragState.offsetX));
        const top = Math.min(maxTop, Math.max(4, event.clientY - dragState.offsetY));
        hudEl.style.left = left + 'px';
        hudEl.style.top = top + 'px';
      }, { passive: true });

      document.addEventListener('mouseup', () => {
        dragState = null;
      }, { passive: true });

      // Keep a dragged panel inside the viewport when it is resized.
      window.addEventListener('resize', () => {
        if (!hudEl || !hudEl.style.left) return;
        const rect = hudEl.getBoundingClientRect();
        const left = Math.min(rect.left, Math.max(4, window.innerWidth - hudEl.offsetWidth - 4));
        const top = Math.min(rect.top, Math.max(4, window.innerHeight - hudEl.offsetHeight - 4));
        hudEl.style.left = left + 'px';
        hudEl.style.top = top + 'px';
      }, { passive: true });
    }

    function setBusy(next) {
      busy = !!next;
      if (pageBtn) pageBtn.disabled = busy;
      if (stopBtn) stopBtn.disabled = false;
      if (hudEl) hudEl.classList.toggle('qb-busy', busy);
      refreshCourseButton();
    }

    function requestStop() {
      if (!busy) {
        setStatus('idle', '');
        logHUD('info', 'Idle — nothing is running.');
        return;
      }
      stopRequested = true;
      setStatus('stopping', 'waiting');
      logHUD('warn', 'Stop requested — halting harvest.');
      if (abortController) {
        try { abortController.abort(); } catch (error) { /* already aborted */ }
      }
    }

    /* ── Strategy 1: highlighted selection ─────────────────────────────── */

    const QUESTION_START_RE = /^(?:q(?:uestion)?\s*#?\s*\d*\s*[:.)\-]|(?:\d{1,3})[.)])\s*/i;
    const CHOICE_RE = /^(?:\(?[a-h]\)?|[ivx]{1,4})[.)]\s+(.+)$/i;
    const BULLET_RE = /^[-*•·]\s+(.+)$/;

    function readSelectionText() {
      try {
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          const start = typeof active.selectionStart === 'number' ? active.selectionStart : 0;
          const end = typeof active.selectionEnd === 'number' ? active.selectionEnd : 0;
          if (end > start) {
            const value = String(active.value || '').slice(start, end);
            if (value.trim()) return value;
          }
        }
        return String(window.getSelection ? window.getSelection().toString() : '');
      } catch (error) {
        return '';
      }
    }

    function parseHighlightedSelection(rawText) {
      const text = String(rawText || '').replace(/\r\n?/g, '\n');
      const lines = text.split('\n').map((line) => norm(line)).filter(Boolean);
      if (!lines.length) return [];

      const blocks = [];
      let block = null;

      const beginBlock = (line) => {
        block = {
          question: [cleanQuestion(line)],
          answer: [],
          choices: [],
          verified: false,
        };
        blocks.push(block);
      };

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        // "Q: …" / "Question 4: …" / "12. …" starts (or restarts) a block.
        if (QUESTION_START_RE.test(line)) {
          beginBlock(line);
          continue;
        }

        if (!block) {
          if (line.endsWith('?') || /^(?:q|question)\b/i.test(line)) beginBlock(line);
          continue;
        }

        // A fresh question line while the previous one has no answer yet.
        if (!block.answer.length && line.endsWith('?') && block.question.join(' ').trim()) {
          beginBlock(line);
          continue;
        }

        const answerLabel = line.match(ANSWER_LABEL_RE);
        if (answerLabel) {
          block.verified = block.verified || /^(?:correct|right)\b/i.test(line);
          block.answer.push(cleanAnswer(line.slice(answerLabel[0].length)));
          continue;
        }

        const correctLabel = line.match(CORRECT_LABEL_RE);
        if (correctLabel) {
          block.verified = true;
          block.answer.push(cleanAnswer(line.slice(correctLabel[0].length)));
          continue;
        }

        // "✓ Active Directory Domain Services" / "✅ Paris"
        if (CHECK_MARK_RE.test(line) && stripCheckMarks(line)) {
          block.verified = true;
          block.answer.push(stripCheckMarks(line));
          continue;
        }

        const choice = line.match(CHOICE_RE) || line.match(BULLET_RE);
        if (choice && !block.answer.length) {
          const isCorrect = /[\u2705\u2714\u2713\u2611\u2610]/.test(line);
          const choiceText = cleanAnswer(choice[1] || line);
          if (choiceText) {
            block.choices.push({ text: choiceText, correct: isCorrect });
            if (isCorrect) {
              block.verified = true;
              block.answer.push(choiceText);
            }
          }
          continue;
        }

        if (block.answer.length) block.answer.push(cleanAnswer(line));
        else block.question.push(norm(line));
      }

      const pairs = [];
      blocks.forEach((item) => {
        const question = cleanQuestion(item.question.join(' '));
        let answer = cleanAnswer(item.answer.join(' '));
        let verified = item.verified;
        if (!answer && item.choices.length === 1) {
          answer = item.choices[0].text;
          verified = verified || item.choices[0].correct;
        }
        const pair = makePair(question, answer, verified);
        if (pair) pairs.push(pair);
      });

      // Plain "question?" / "answer" selections without any label at all.
      if (!pairs.length) {
        for (let i = 0; i < lines.length - 1; i += 1) {
          if (!lines[i].endsWith('?')) continue;
          const candidate = cleanAnswer(lines[i + 1]);
          if (!candidate || candidate.endsWith('?')) continue;
          const pair = makePair(cleanQuestion(lines[i]), candidate, false);
          if (pair) pairs.push(pair);
        }
      }

      return pairs;
    }

    /* ── Strategy 2: amauoed.com cards ──────────────────────────────────── */

    function extractAmauoed(root) {
      const out = [];
      if (!root || !root.querySelectorAll) return out;
      let badges = [];
      try {
        badges = Array.from(root.querySelectorAll('.chip.bg-success, .bg-success'));
      } catch (error) {
        badges = [];
      }

      badges.forEach((badge) => {
        if (!/correct/i.test(norm(badge.textContent))) return;
        if (badge.closest && badge.closest('#' + HUD_ID)) return;

        const scope = (badge.closest && (
          badge.closest('.card') ||
          badge.closest('.list-group-item') ||
          badge.closest('li')
        )) || badge.parentElement;
        if (!scope) return;

        // The answer lives beside the green "Correct" chip, usually in <strong>.
        const answerOwner = (badge.closest && badge.closest('strong, b')) || badge.parentElement;
        let answer = '';
        if (answerOwner) {
          const clone = answerOwner.cloneNode(true);
          try {
            clone.querySelectorAll('.chip, .badge, .bg-success, .bg-primary').forEach((node) => node.remove());
          } catch (error) { /* ignore */ }
          answer = cleanAnswer(clone.textContent);
        }
        if (!answer) return;

        const questionEl = scope.querySelector('.mb-2, .question, .question-text, .qtext, .prompt');
        if (!questionEl || questionEl === answerOwner) return;

        const pair = makePair(cleanQuestion(questionEl.textContent), answer, true);
        if (pair) out.push(pair);
      });

      return out;
    }

    /* ── Strategy 3: Quizlet term cards ─────────────────────────────────── */

    function extractQuizlet(root) {
      const out = [];
      if (!root || !root.querySelectorAll) return out;

      let containers = [];
      try {
        containers = Array.from(root.querySelectorAll('.SetPageTerm-content, .SetPageTerm'));
      } catch (error) {
        containers = [];
      }

      containers.forEach((container) => {
        const word = container.querySelector('.SetPageTerm-wordText');
        const definition = container.querySelector('.SetPageTerm-definitionText');
        if (!word || !definition) return;
        const pair = makePair(word.textContent, definition.textContent, false);
        if (pair) out.push(pair);
      });

      // Quizlet's newer card markup (data-testid cards with .TermText spans).
      if (!out.length) {
        let cards = [];
        try {
          cards = Array.from(root.querySelectorAll('[data-testid="set-page-card"], [data-testid="card"]'));
        } catch (error) {
          cards = [];
        }
        cards.forEach((card) => {
          const texts = Array.from(card.querySelectorAll('.TermText, [class*="TermText"]'))
            .map((node) => norm(node.textContent))
            .filter(Boolean);
          if (texts.length < 2) return;
          const pair = makePair(texts[0], texts[1], false);
          if (pair) out.push(pair);
        });
      }

      return out;
    }

    /* ── Strategy 4: generic DOM heuristic ──────────────────────────────── */

    const INLINE_ANSWER_RE = /\b(?:correct\s+)?(?:answer|ans)\s*[:.)\-]\s*(.{1,400})$/i;

    function looksLikeQuestion(text) {
      const value = norm(text);
      if (value.length < 8 || value.length > 700) return false;
      if (value.endsWith('?')) return true;
      if (/^(?:q|question)\s*#?\s*\d*\s*[:.)\-]/i.test(value)) return true;
      if (QUESTION_PREFIX_RE.test(value)) return true;
      return /^(?:what|which|who|whom|when|where|why|how|define|describe|explain|identify|list|name|state|give|true or false)\b/i.test(value);
    }

    function isVerifiedAnswerElement(element, rawText) {
      try {
        if (CHECK_MARK_RE.test(String(rawText || ''))) return true;
        const className = String(element.className || '');
        if (/\b(correct|right-?answer|rightanswer|answer-correct|bg-success|is-correct|verified)\b/i.test(className)) return true;
        if (element.matches && element.matches('mark, .correct, .bg-success, [class*="correct" i]')) return true;
        if (element.closest && element.closest('mark, .correct, .bg-success, [class*="correct" i]')) return true;
      } catch (error) { /* ignore */ }
      return false;
    }

    function answerCandidate(element, questionText) {
      if (!element || element.nodeType !== 1) return null;
      if (element.closest && element.closest('#' + HUD_ID)) return null;
      const raw = norm(element.textContent);
      if (!raw || raw.length > ANSWER_MAX_CHARS) return null;
      const text = cleanAnswer(raw);
      if (!text || text.length > ANSWER_MAX_CHARS) return null;

      const qLower = questionText.toLowerCase();
      const aLower = text.toLowerCase();
      if (aLower === qLower) return null;
      if (aLower.length > 24 && qLower.includes(aLower)) return null;
      if (qLower.length > 24 && aLower.includes(qLower)) return null;
      if (STOP_ANSWERS.has(aLower)) return null;
      if (text.endsWith('?') && !/^(?:true|false)$/i.test(text)) return null;

      return {
        text,
        verified: isVerifiedAnswerElement(element, raw),
      };
    }

    function findGenericAnswer(node, questionText) {
      // <dt>Question</dt><dd>Answer</dd>
      if (node.tagName === 'DT') {
        const dd = node.nextElementSibling;
        if (dd && dd.tagName === 'DD') {
          const hit = answerCandidate(dd, questionText);
          if (hit) return hit;
        }
      }

      // <details><summary>Question?</summary>Answer…</details>
      if (node.tagName === 'SUMMARY' && node.parentElement) {
        const clone = node.parentElement.cloneNode(true);
        const summary = clone.querySelector('summary');
        if (summary) summary.remove();
        const hit = answerCandidate(clone, questionText);
        if (hit) return hit;
      }

      // Following siblings: the usual "question div, answer div" layout.
      let sibling = node.nextElementSibling;
      for (let i = 0; sibling && i < 3; i += 1, sibling = sibling.nextElementSibling) {
        const hit = answerCandidate(sibling, questionText);
        if (hit && !sibling.matches('ul, ol, table, form, nav')) return hit;
      }

      // Question and answer wrapped in separate spans inside neighbour divs.
      const parent = node.parentElement;
      if (parent) {
        let parentSibling = parent.nextElementSibling;
        for (let i = 0; parentSibling && i < 2; i += 1, parentSibling = parentSibling.nextElementSibling) {
          const hit = answerCandidate(parentSibling, questionText);
          if (hit && !parentSibling.matches('ul, ol, table, form, nav')) return hit;
        }
      }

      // Explicit answer / correct-answer nodes inside the same card.
      let container = null;
      try {
        container = (node.closest && node.closest(
          'li, article, section, tr, dl, .question, [class*="question" i], [class*="qa" i], [class*="card" i]'
        )) || parent;
      } catch (error) {
        container = parent;
      }
      if (container) {
        let answers = [];
        try {
          answers = Array.from(container.querySelectorAll(ANSWER_SELECTOR));
        } catch (error) {
          answers = [];
        }
        for (let i = 0; i < answers.length; i += 1) {
          if (node.contains(answers[i])) continue;
          const hit = answerCandidate(answers[i], questionText);
          if (hit) return hit;
        }
      }

      return null;
    }


    function extractGeneric(root) {
      const out = [];
      if (!root || !root.querySelectorAll) return out;

      let nodes = [];
      try {
        nodes = Array.from(root.querySelectorAll(QUESTION_SELECTOR));
      } catch (error) {
        nodes = [];
      }
      if (nodes.length > MAX_GENERIC_NODES) nodes = nodes.slice(0, MAX_GENERIC_NODES);

      for (let i = 0; i < nodes.length; i += 1) {
        if (out.length >= MAX_GENERIC_PAIRS) break;
        const node = nodes[i];

        try {
          if (node.closest('#' + HUD_ID)) continue;
          if (node.closest('nav, header, footer, aside, [role="navigation"], [aria-hidden="true"]')) continue;
          // Skip big wrappers; leaf-ish nodes carry a single question.
          if (node.querySelectorAll('p, li, h1, h2, h3, .question').length > 2) continue;

          const text = norm(node.textContent);
          if (!text || text.length > 700) continue;

          // "…? Answer: …" inside one block.
          const inline = text.match(INLINE_ANSWER_RE);
          if (inline && inline.index > 7) {
            const pair = makePair(text.slice(0, inline.index), inline[1], /correct/i.test(inline[0]));
            if (pair) { out.push(pair); continue; }
          }

          if (!looksLikeQuestion(text)) continue;
          const found = findGenericAnswer(node, cleanQuestion(text));
          if (!found) continue;
          const pair = makePair(text, found.text, found.verified);
          if (pair) out.push(pair);
        } catch (error) {
          // One odd node must never abort the whole harvest.
        }
      }

      return out;
    }

    function extractPagePairsFromDom() {
      const collected = [];
      const seen = new Set();
      const push = (pair) => {
        if (!pair) return;
        const signature = pairSignature(pair);
        if (seen.has(signature)) return;
        seen.add(signature);
        collected.push(pair);
      };

      if (isAmauoed()) extractAmauoed(document).forEach(push);
      if (isQuizlet()) extractQuizlet(document).forEach(push);
      extractGeneric(document).forEach(push);
      return collected;
    }

    /* ── Persistence + GitHub bank sync ─────────────────────────────────── */

    async function persistPairs(pairs, host, options) {
      const opts = options || {};
      const tag = sourceTagForHost(host);
      const seen = new Set();
      let saved = 0;
      let verified = 0;
      let skipped = 0;

      for (let i = 0; i < pairs.length; i += 1) {
        const pair = pairs[i];
        if (!pair) continue;
        const signature = pairSignature(pair);
        if (seen.has(signature)) { skipped += 1; continue; }
        seen.add(signature);
        try {
          if (typeof answerKeyPut !== 'function') throw new Error('answerKeyPut unavailable');
          await answerKeyPut(pair.question, pair.answer, tag, { verified: !!pair.verified });
          saved += 1;
          if (pair.verified) verified += 1;
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          logHUD('error', 'Bank write failed: ' + message);
        }
      }

      if (!opts.deferFlush && saved > 0) {
        try {
          if (typeof flushNow === 'function') await flushNow();
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          logHUD('warn', 'Bank flush failed: ' + message);
        }
      }

      return { saved, verified, skipped };
    }

    function requestGitHubBankPush() {
      safeSendMessage({ action: 'SYNC_GITHUB_BANK' }, (response, error) => {
        if (error) {
          logHUD('warn', 'GitHub bank sync unavailable: ' + error);
          return;
        }
        if (!response) return;
        if (response.error) {
          logHUD('warn', 'GitHub bank sync failed: ' + response.error);
          return;
        }
        if (response.status === 'skipped') {
          logHUD('info', 'GitHub bank not configured — pairs stay in the local bank.');
          return;
        }
        if (response.status === 'ok') {
          logHUD('success', 'GitHub bank pushed (' + (response.pushed || 0) + ' questions).');
        }
      });
    }

    /* ── Harvest Page ───────────────────────────────────────────────────── */

    let activeRunId = 0;

    function scheduleIdleStatus(runId) {
      window.setTimeout(() => {
        if (activeRunId !== runId || busy) return;
        setStatus('idle', '');
      }, 2600);
    }

    async function harvestPage() {
      if (!botEnabled) {
        logHUD('warn', 'Bot is disabled — enable it in the popup to harvest.');
        return;
      }
      if (busy) {
        logHUD('warn', 'Harvest is already running.');
        return;
      }
      if (!hudEl) buildHud();

      const host = currentHost() || 'this page';
      const runId = ++activeRunId;
      stopRequested = false;
      setBusy(true);
      setStatus('harvesting', 'running');
      logHUD('info', 'Harvest "' + host + '" — reading this page…');
      // Give the mascot's log observer a frame to see the start line.
      await delay(80);

      try {
        let strategy = '';
        let pairs = [];

        const selection = readSelectionText();
        if (norm(selection)) {
          pairs = parseHighlightedSelection(selection);
          if (pairs.length) strategy = 'highlighted text';
        }

        if (!pairs.length) {
          pairs = extractPagePairsFromDom();
          strategy = 'page DOM';
        }

        if (!pairs.length) {
          setStatus('empty', 'waiting');
          logHUD('warn', 'Harvesting failed: no Q&A pairs found — highlight a Q&A block or open a study page.');
          return;
        }

        logHUD('info', 'Harvest "' + host + '" — ' + pairs.length + ' candidate pair(s) from ' + strategy + '.');
        await delay(40);

        const result = await persistPairs(pairs, host);
        if (!result.saved) {
          setStatus('empty', 'waiting');
          logHUD('warn', 'Harvesting failed: nothing new to store on this page.');
          return;
        }

        setStatus('done', 'reviewing');
        const savedLabel = result.saved === 1 ? 'answer' : 'answers';
        logHUD('success', 'Harvested ' + result.saved + ' ' + savedLabel + ' from ' + host + '!');
        await delay(900);
        logHUD('info', 'Review page: ' + result.saved + ' pairs ready in the local bank.');
        requestGitHubBankPush();
        scheduleIdleStatus(runId);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        setStatus('stopped', 'stopped');
        logHUD('error', 'Harvesting failed: ' + message);
      } finally {
        setBusy(false);
      }
    }


    /* ── Harvest Course (?page=1, ?page=2, …) ───────────────────────────── */

    function isCourseUrl() {
      try {
        const path = String(location.pathname || '');
        return /\/(?:courses?|class|classes|modules?|subjects?|sets?|study)(?:\/|$)/i.test(path);
      } catch (error) {
        return false;
      }
    }

    function hasPagination() {
      for (let i = 0; i < PAGINATION_SELECTORS.length; i += 1) {
        try {
          if (document.querySelector(PAGINATION_SELECTORS[i])) return true;
        } catch (error) { /* skip bad selector */ }
      }
      return false;
    }

    function courseHarvestAvailable() {
      return isCourseUrl() || hasPagination();
    }

    function refreshCourseButton() {
      if (!courseBtn) return;
      const available = courseHarvestAvailable();
      courseBtn.disabled = busy || !available;
      courseBtn.title = available
        ? 'Loop ?page=1, ?page=2, … for this course'
        : 'Needs a multi-page course or a paginated page';
    }

    function baseCourseUrl() {
      const url = new URL(location.href);
      url.searchParams.delete('page');
      url.hash = '';
      return url.toString();
    }

    function coursePageUrl(baseHref, page) {
      const url = new URL(baseHref);
      url.searchParams.set('page', String(page));
      return url.toString();
    }

    async function fetchHtml(url) {
      const controller = new AbortController();
      abortController = controller;
      const timer = setTimeout(() => {
        try { controller.abort(); } catch (error) { /* already aborted */ }
      }, FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
          headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.text();
      } finally {
        clearTimeout(timer);
        if (abortController === controller) abortController = null;
      }
    }

    function extractPairsFromHtml(html) {
      const collected = [];
      const seen = new Set();
      const push = (pair) => {
        if (!pair) return;
        const signature = pairSignature(pair);
        if (seen.has(signature)) return;
        seen.add(signature);
        collected.push(pair);
      };

      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      if (isAmauoed()) extractAmauoed(doc).forEach(push);
      if (isQuizlet()) extractQuizlet(doc).forEach(push);
      extractGeneric(doc).forEach(push);
      return collected;
    }

    async function harvestCourse() {
      if (!botEnabled) {
        logHUD('warn', 'Bot is disabled — enable it in the popup to harvest.');
        return;
      }
      if (busy) {
        logHUD('warn', 'Harvest is already running.');
        return;
      }
      if (!courseHarvestAvailable()) {
        logHUD('warn', 'Course harvest needs a course page or a paginated page.');
        return;
      }
      if (!hudEl) buildHud();

      const host = currentHost() || 'this page';
      const runId = ++activeRunId;
      const base = baseCourseUrl();
      stopRequested = false;
      setBusy(true);
      setStatus('harvesting', 'running');
      logHUD('info', 'Harvest "' + host + '" — course mode, starting at ?page=1…');
      await delay(80);

      const seenPairs = new Set();
      let savedTotal = 0;
      let verifiedTotal = 0;
      let pagesRead = 0;
      let lastSignature = '';

      try {
        for (let page = 1; page <= MAX_COURSE_PAGES; page += 1) {
          if (stopRequested || !botEnabled) break;
          setStatus('page ' + page, 'running');

          const url = coursePageUrl(base, page);
          let pagePairs = [];

          try {
            const html = await fetchHtml(url);
            if (stopRequested) break;
            pagePairs = extractPairsFromHtml(html);
          } catch (error) {
            if (stopRequested) break;
            const message = error && error.message ? error.message : String(error);
            // First page fallback: harvest what is already open in the tab.
            if (page === 1) {
              logHUD('warn', 'Harvest "' + host + '" — ?page=1 fetch failed (' + message + '), using the open tab.');
              pagePairs = extractPagePairsFromDom();
            } else {
              logHUD('warn', 'Harvest "' + host + '" — ?page=' + page + ' failed: ' + message);
              break;
            }
          }

          if (stopRequested) break;

          const fresh = pagePairs.filter((pair) => !seenPairs.has(pairSignature(pair)));
          if (!fresh.length) {
            logHUD('info', 'Harvest "' + host + '" — ?page=' + page + ' has no new pairs.');
            break;
          }

          const signature = fresh.map(pairSignature).join('|');
          if (signature === lastSignature) {
            logHUD('info', 'Harvest "' + host + '" — ?page=' + page + ' repeats the previous page.');
            break;
          }
          lastSignature = signature;
          fresh.forEach((pair) => seenPairs.add(pairSignature(pair)));

          const result = await persistPairs(fresh, host, { deferFlush: true });
          savedTotal += result.saved;
          verifiedTotal += result.verified;
          pagesRead += 1;

          logHUD('info', 'Harvest "' + host + '" — ?page=' + page + ': +' + result.saved + ' pair(s) stored.');
          await delay(120);
        }

        if (!savedTotal) {
          setStatus(stopRequested ? 'stopped' : 'empty', stopRequested ? 'stopped' : 'waiting');
          logHUD('warn', stopRequested
            ? 'Bot stopped — nothing stored.'
            : 'Harvesting failed: nothing new to store across the course.');
          return;
        }

        try {
          if (typeof flushNow === 'function') await flushNow();
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          logHUD('warn', 'Bank flush failed: ' + message);
        }

        setStatus(stopRequested ? 'stopped' : 'done', stopRequested ? 'stopped' : 'reviewing');
        const savedLabel = savedTotal === 1 ? 'answer' : 'answers';
        logHUD('success', 'Harvested ' + savedTotal + ' ' + savedLabel + ' from ' + host + '!');
        await delay(900);

        if (stopRequested) {
          logHUD('warn', 'Bot stopped — ' + savedTotal + ' pair(s) kept from ' + pagesRead + ' page(s).');
        } else {
          logHUD('info', 'Review page: ' + savedTotal + ' pairs ready in the local bank.');
          if (verifiedTotal) logHUD('info', 'Verified this run: ' + verifiedTotal + ' pair(s).');
          if (pagesRead >= MAX_COURSE_PAGES) logHUD('warn', 'Course page limit reached (' + MAX_COURSE_PAGES + ').');
        }

        requestGitHubBankPush();
        scheduleIdleStatus(runId);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        setStatus('stopped', 'stopped');
        logHUD('error', 'Harvesting failed: ' + message);
      } finally {
        setBusy(false);
      }
    }

    /* ── Boot ───────────────────────────────────────────────────────────── */

    function ensureMounted() {
      if (!hudEl) return;
      if (!hudEl.isConnected) {
        try {
          (document.body || document.documentElement).appendChild(hudEl);
        } catch (error) { /* page may be tearing down */ }
      }
      refreshCourseButton();
    }

    function init() {
      try {
        if (document.getElementById(HUD_ID)) return;
        buildHud();
        watchBotEnabled();
        logHUD('info', 'Ready on ' + (currentHost() || 'this page') + ' — highlight text or use Harvest Page.');
        if (hasPagination()) {
          logHUD('info', 'Paginated page detected — Harvest Course can walk ?page=1, 2, 3…');
        }
        window.setInterval(ensureMounted, 5000);
        window.addEventListener('beforeunload', () => {
          if (abortController) {
            try { abortController.abort(); } catch (error) { /* ignore */ }
          }
        });
      } catch (error) {
        try { console.warn('[Harvest] init failed:', error); } catch (ignore) { /* ignore */ }
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  })();
} catch (error) {
  try { console.warn('[Harvest] disabled:', error); } catch (ignore) { /* ignore */ }
}
