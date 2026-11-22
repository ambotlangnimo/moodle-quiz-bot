/* ─────────────────────────────────────────────────────────────────────────────
   mascot.js — standalone, self-aware roaming 4-cat mascot for the Quiz Bot.

   HARD RULE: this file never touches quiz logic. It cannot click, submit,
   navigate or block anything:
     • no element.click(), no preventDefault(), no stopPropagation();
     • every page listener is passive and side-effect free;
     • state is inferred read-only (DOM observation + a pass-through tee on the
       HUD logger that only *reads* the text, then delegates unchanged);
     • the whole file is wrapped in try/catch, so a mascot bug can only ever
       disable the mascot — quiz solving, review learning and GitHub bank
       syncing keep running exactly as in previous version/content.js.

   States:
     idle      mascot/idle.gif      roams the bottom/side edges every 5–7 s,
                                    random cat quotes every 6–8 s (petting lines on click)
     thinking  mascot/thinking.png  "Reading the question... 👀"
                                  → "Hmm... let me think 🤔"
     answering mascot/answering.gif "AHA!! Found it! ✨" (~0.8 s reaction)
     clicking  mascot/clicking.gif  "Slapping that answer!! 🐾💥" (1.1 s) parked on the
                                   exact radio dot / checkbox the bot ticked, then a hop to the
                                   next page button
     nextpage  mascot/clicking.gif  "Next page!! 🐾➡️" (1.1 s) directly left of the visible
                                   Next page button, facing right so the paw lands on it
                                   (visual only), then idle roaming
     typing    mascot/typing.gif    "Typing the answer... ⌨️🐾" (2.5 s, then idle)
                                   fill-in-the-blank / short-answer box filled
     harvesting mascot/harvesting.gif "Digging up answers... 🐾⛏️" while the HUD streams
                                   harvest progress → "Scooped X answers!! 🐟✨", then a
                                   smooth idle 2 s after the last harvest line
                                   (auto-falls back to idle.gif if the GIF is missing)
     review    mascot/review.gif    "Checking your score... 👀"
                                  → "Learned X right! Purrfect 🎓"

   Interaction (all cosmetic — none of it can reach quiz logic):
     click          playful petting line from PET_LINES (shuffle-no-repeat)
     double-click   1.8 s answering.gif cheer from HYPE_LINES → back to the state
     mouseenter     occasional curious hint from HOVER_LINES (12 s cooldown)
     low timer      on /attempt.php, ≤5 min left → review.gif + "HALA!! ..." alarm
     review score   .quizreviewsummary ≥90% / ≥75% / <75% celebration lines

   ───────────────────────────────────────────────────────────────────────────── */
try {
  (function () {
    'use strict';

    /* ── Ids, assets, speech, timings ─────────────────────────────────────── */

    const WRAP_ID = 'qb-mascot-wrap';
    const IMG_CLASS = 'qb-mascot-img';
    const BUBBLE_ID = 'qb-mascot-bubble';
    const STYLE_ID = 'qb-mascot-style';
    const HUD_HOST_ID = 'moodle-quiz-bot-hud';

    const SIZE = 130;        // px — square cat
    const BUBBLE_MAX = 175;  // px — widest the speech bubble can render
    const EDGE = 16;         // px — viewport margin (left / top / bottom)
    const RIGHT_GUARD = 24;  // px — extra room reserved on the right edge
    const GAP = 10;          // px — gap when parking beside a Moodle element
    // Right-edge footprint: the bubble (175 px, right-aligned to the wrap) is
    // wider than the 130 px cat, so the wider of the two drives the clamp.
    const MASCOT_WIDTH = Math.max(SIZE, BUBBLE_MAX);

    const ASSETS = {
      idle: 'mascot/idle.gif',
      thinking: 'mascot/thinking.png',
      answering: 'mascot/answering.gif',
      clicking: 'mascot/clicking.gif',
      nextpage: 'mascot/clicking.gif', // same slap GIF, different bubble + target
      typing: 'mascot/typing.gif',
      harvesting: 'mascot/harvesting.gif', // digging GIF; idle.gif is the fallback
      review: 'mascot/review.gif',
    };

    // If a GIF is not shipped yet (or fails to decode), the state still plays -
    // it just borrows this fallback asset, so `harvesting` keeps its bubble and
    // GIF-frame timing on idle.gif instead of dropping the whole animation.
    const ASSET_FALLBACKS = { harvesting: 'idle' };
    const brokenAssets = new Set();

    // The two "action" GIFs replay the exact move the bot just made: slapping a
    // radio/checkbox/dropdown option, or typing into a fill-in-the-blank box.
    const ACTION_STATES = ['clicking', 'typing'];

    const SPEECH = {
      reading: 'Reading the question... 👀',
      thinking: 'Hmm... let me think 🤔',
      answering: 'AHA!! Found it! ✨',
      clicking: 'Slapping that answer!! 🐾💥',
      nextpage: 'Next page!! 🐾➡️',
      typing: 'Typing the answer... ⌨️🐾',
      harvesting: 'Digging up answers... 🐾⛏️',
      scooped: (count) => 'Scooped ' + count + ' answers!! 🐟✨',
      review: 'Checking your score... 👀',
      learned: (count) => 'Learned ' + count + ' right! Purrfect 🎓',
    };

    const IDLE_QUOTES = [
      'Meow... waiting for a quiz! 🐾',
      'Manifesting 1.00 flat... purr ✨',
      'Checking my 1 braincell... 0 found 😿',
      'Don\'t forget to click Review after! 📖',
      'GitHub bank locked & loaded 🐟',
      'Kaya natin \'to, click Run na! 💪',
      'Sip water while I scan~ 💧🐾',
      'No thoughts, head empty, only 100% score',
      'Study now, bawal bumagsak 📚😾',
      'Feed me questions, hooman 🐟',
      'Cramming is a lifestyle, purr 😹',
      'Deadline? More like dead-tired 🐾💀',
      'Recitation later, cat nap now 😴',
      'God bless sa quiz, laban tayo! 🙏🐾',
      'Pretending I reviewed the modules 📖😼',
      'Calculator ba need dito? 🧮',
      'Ready when you are! Click Run~ 🐱',
      '8 AM class? I sleep through it 😾',
      'One more question please, I behave 🥺',
      'Remember to open Review after! 📖',
      'Confidence 100, knowledge 40 😹',
      'Bonak sa quiz, bawi sa Finals 💪',
      'I roam, therefore I answer. 🐈',
      'Coffee for hooman, canned tuna for me ☕🐟',
      'Group project? I only do solo 😼',
      'Zero naps until the bank syncs 😼',
      'Attendance is 20%, effort is 100% 🐾',
      'Waiting for that sweet 1.00 sighting 🎓',
      'My answers are 99% purr-fect, 1% cat hair 🐈',
      'Click Run before my braincell expires ⌛😿',
    ];

    // Every pool below is drawn through pickFreshLine(), so no line ever repeats
    // back-to-back and a long exam session keeps hearing fresh material.
    const READING_LINES = [
      SPEECH.reading,
      'Basahin ko muna, wait lang 👀',
      'Wait lang, reading carefully 👀',
      'Scanning the question text 🔍',
    ];

    const THINKING_LINES = [
      SPEECH.thinking,
      'Hmm... let me cook 🤔',
      'Scanning my braincells... 🔍',
      'Wait lang, reading carefully 👀',
      'Processing... purr-cessing 🐾',
      'Consulting the GitHub bank 🐟',
      'Checking amauoed.com real quick 👀',
      'Hmm, familiar ba \'to? 🤔',
    ];

    const CLICKING_LINES = [
      SPEECH.clicking,
      'Boop! Selected! ✨',
      'Easy pick right here! 😼',
      'Tapped it, no hesitation 🐾',
      'That option, final answer 😼',
      'Picked with my paw, 100% accurate 🐾',
    ];

    const TYPING_LINES = [
      SPEECH.typing,
      'FURIOUS TYPING NOISES ⌨️🔥',
      'Speedrunning this blank box 🐾💻',
      'Typing like my tuition depends on it ⌨️😾',
      'Fill in the blank, fill my heart 💖⌨️',
    ];

    const PET_LINES = [
      'Meow?! I\'m working here! 😾',
      'Purrrr~ +10 luck on your exam 🍀',
      'Petting the cat increases accuracy by 99% 🐾',
      'Mrrp! That tickles 🐱',
      'Head scritches accepted, focus restored ✨',
      'One pet = one correct answer (not really) 😼',
      'Purr... continue, hooman 🐾',
    ];

    const HYPE_LINES = [
      'LET\'S GOOOO!! 🔥🐾',
      'UNSTOPPABLE!! ✨',
      'KAYA NATIN \'TO!! 1.00 LANG!! 🎓🔥',
      'CHEER MODE: ON 🐾📣',
      'Manifesting perfect-score energy ✨🐱',
    ];

    const HOVER_LINES = [
      'Need help? Hit Run! 👀',
      'Psst... you can drag me anywhere 🐾',
      'Stuck? Click Run and I\'ll cook 🤔',
      'I can\'t help by just hovering, you know 😼',
      'Double-click me if you need hype 🔥',
    ];

    const PANIC_LINE = 'HALA!! Under 5 mins left!! ⏰🙀';

    const SCORE_HIGH_LINES = [
      'SHEESH!! High score!! Certified Dean\'s Lister 🎓✨',
      'Grabe ang galing, 1.00 energy 🎓✨',
      'Top of the class behavior detected 🎓🐾',
    ];

    const SCORE_PASS_LINES = [
      'Solid pass!! Synced new answers to GitHub 😎🐾',
      'Panalo! Passed with style 😎🐾',
      'Good score, bank updated, tuloy ang laban 😎',
    ];

    const SCORE_LOW_LINES = [
      'Bawi next attempt! Saved the right ones 📖💪',
      'Okay lang \'yan, next attempt panalo 📖💪',
      'Charge to experience, saved the rights 📖🐾',
    ];

    const CHEER_MS = 1800;             // double-click answering.gif cheer
    const PANIC_HOLD_MS = 3200;        // low-timer review.gif alarm
    const TIMER_CHECK_MS = 10000;      // #quiz-time-left poll cadence
    const TIMER_PANIC_SECONDS = 300;   // "under 5 mins left" threshold
    const HOVER_COOLDOWN_MS = 12000;   // hover hints at most once per 12 s
    const HOVER_CHANCE = 0.35;         // ... and only ~1 in 3 hovers speaks
    const PET_COOLDOWN_MS = 300;       // swallows the 2nd click of a double click

    const ROAM_MIN_MS = 5000;        // idle wander cadence: 5–7 s
    const ROAM_SPREAD_MS = 2000;
    const ROAM_PAUSE_AFTER_DRAG = 15000;
    const QUOTE_MIN_MS = 6000;       // idle chatter cadence: 6–8 s
    const QUOTE_SPREAD_MS = 2000;
    const READING_HOLD_MS = 1600;    // "Reading the question..." → "Hmm..."
    const ANSWER_REACT_MS = 800;     // "AHA!! Found it! ✨" → clicking / typing
    const SLAP_HOLD_MS = 1100;       // clicking.gif on the exact dot → Next page hop
    const NEXT_HOP_MS = 1100;        // "Next page!!" hop beside the button → idle
    const ACTION_HOLD_MS = 2500;     // typing.gif → idle (clicking uses SLAP_HOLD_MS)
    const TARGET_LIFT = 40;          // px — sit this far above the target's top edge
    const NEXT_OFFSET_X = 140;       // px — park this far left of the Next page button
    const NEXT_OFFSET_Y = 45;        // px — park this far above the Next page button
    const REVIEW_COUNT_DELAY_MS = 1800;
    const TICK_MS = 1500;            // read-only state reconciliation
    const MUTATION_DEBOUNCE_MS = 220;
    const ANSWER_THROTTLE_MS = 800;
    const HARVEST_HOLD_MS = 2000;    // harvest GIF lingers 2 s after the last line
    const HARVEST_STALE_MS = 20000;  // safety: 20 s of silence → back to idle
    const CONTROL_HINT_MS = 2000;    // how long the last answer control stays "fresh"

    /* ── Module state ─────────────────────────────────────────────────────── */

    let wrapEl = null;
    let imgEl = null;
    let bubbleEl = null;

    let currentState = 'idle';
    let facing = 'right';
    let pos = { left: 0, top: 0 };

    let drag = null;
    let suppressClickUntil = 0;
    let pauseRoamUntil = 0;
    let pendingAction = null;   // { kind: 'clicking' | 'typing', anchor } queued behind "AHA!!"
    let lastControl = null;     // { kind, element, at } — last answer control the bot touched

    let quoteTimer = null;
    let roamTimer = null;
    let thinkTimer = null;
    let holdTimer = null;
    let reviewTimer = null;
    let harvestTimer = null;   // harvesting → idle fade-out after the last harvest line
    let tickTimer = null;
    let mutationTimer = null;

    const freshMemory = new WeakMap(); // dialog pool -> line it drew last
    let lastBubbleText = '';
    let lastQuestionKey = '';
    let lastQuestionAt = 0;
    let lastAnswerAt = 0;
    let lastLogLine = '';
    let lastLearnedShown = -1;
    let reviewStartedAt = 0;
    let reviewParked = false;
    let booted = false;

    let overlayTimer = null;   // cheer / panic GIF restore timer
    let overlayState = '';     // '' | 'answering' | 'review'
    let timerCheck = null;     // 10 s #quiz-time-left poll
    let panicWarned = false;   // one low-timer alarm per attempt
    let lastHoverAt = 0;
    let lastPetAt = 0;
    let scoreAnnounced = false;
    let lastScoreLine = '';    // celebration line, re-shown when the cat is petted

    const answeredKeys = new Set();
    const warned = new Set();

    /* ── Tiny, never-throwing utilities ───────────────────────────────────── */

    function warnOnce(scope, error) {
      const message = scope + ': ' + ((error && error.message) || error || 'unknown error');
      if (warned.has(message)) return;
      warned.add(message);
      try { console.warn('[Mascot] ' + message); } catch (e) { /* never throw */ }
    }

    function assetUrl(path) {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          return chrome.runtime.getURL(path);
        }
      } catch (error) { /* invalidated extension context — fall through */ }
      return path;
    }

    // Which key actually renders for `state`: the real asset, or its fallback
    // once the file is known to be missing/broken (harvesting → idle), so the
    // state keeps its bubble and hop even when mascot/harvesting.gif is absent.
    function renderKeyFor(state) {
      const key = ASSETS[state] ? state : 'idle';
      if (!brokenAssets.has(ASSETS[key])) return key;
      const fallback = ASSET_FALLBACKS[key];
      if (fallback && ASSETS[fallback] && !brokenAssets.has(ASSETS[fallback])) return fallback;
      return key;
    }

    // Point the <img> at `state`'s asset, remembering the exact path in
    // dataset.asset so onAssetError() knows which file failed to load.
    function applyAsset(state) {
      if (!imgEl) return;
      const key = renderKeyFor(state);
      imgEl.dataset.state = state;
      imgEl.dataset.asset = ASSETS[key];
      imgEl.src = assetUrl(ASSETS[key]);
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function norm(value) {
      return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function isReviewPage() {
      try {
        const path = String((typeof location !== 'undefined' && location.pathname) || '');
        return path.includes('/mod/quiz/review.php') || path.includes('/review.php');
      } catch (error) {
        return false;
      }
    }

    function rectFor(element) {
      try {
        if (!element || !element.getBoundingClientRect) return null;
        const rect = element.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) return null;
        return rect;
      } catch (error) {
        return null;
      }
    }

    /* ── Styles (self-contained; hud.css only styles the closed shadow HUD) ── */

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
#${WRAP_ID} {
  position: fixed;
  left: 0;
  top: 0;
  width: ${SIZE}px;
  height: ${SIZE}px;
  z-index: 2147483647;
  pointer-events: none;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  transition:
    left 0.85s cubic-bezier(0.22, 1, 0.36, 1),
    top 0.85s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: left, top;
}
#${WRAP_ID}.qb-dragging {
  transition: none;
  will-change: auto;
}
.${IMG_CLASS} {
  display: block;
  width: ${SIZE}px;
  height: ${SIZE}px;
  object-fit: cover;
  border-radius: 16px;
  background: transparent;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  transform: scaleX(1);
  transform-origin: 50% 50%;
  transition: transform 0.35s ease, box-shadow 0.25s ease;
}
.${IMG_CLASS}.qb-facing-left { transform: scaleX(-1); }
.${IMG_CLASS}:active { cursor: grabbing; }
.${IMG_CLASS}.qb-hop { animation: qbMascotHop 0.45s ease-out; }
.${IMG_CLASS}.qb-review { animation: qbMascotGlow 2s ease-in-out infinite; }
@keyframes qbMascotHop {
  0%   { translate: 0 0; }
  45%  { translate: 0 -10px; }
  100% { translate: 0 0; }
}
@keyframes qbMascotGlow {
  0%, 100% { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 0 0 rgba(245, 183, 79, 0); }
  50%      { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 0 6px rgba(245, 183, 79, 0.35); }
}
#${BUBBLE_ID} {
  position: absolute;
  right: 0;
  left: auto;
  bottom: calc(100% + 10px);
  max-width: 175px;
  min-width: 56px;
  box-sizing: border-box;
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: break-word;
  padding: 8px 12px;
  border-radius: 16px 16px 4px 16px;
  background: linear-gradient(135deg, #ff6b6b 0%, #ff8c42 100%);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.25s ease, visibility 0.25s ease;
  z-index: 2147483647;
}
#${BUBBLE_ID}.qb-bubble-visible { opacity: 1; visibility: visible; }
#${BUBBLE_ID}.qb-bubble-left {
  right: auto;
  left: 0;
  border-radius: 16px 16px 16px 4px;
}
#${BUBBLE_ID}::after {
  content: "";
  position: absolute;
  top: 100%;
  right: 20px;
  left: auto;
  width: 0;
  border-width: 10px 10px 0;
  border-style: solid;
  border-color: #ff6b6b transparent;
}
#${BUBBLE_ID}.qb-bubble-left::after {
  right: auto;
  left: 20px;
}
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    /* ── Geometry: viewport clamping + HUD-box avoidance ──────────────────── */

    function hudBlockedRect() {
      try {
        const host = document.getElementById(HUD_HOST_ID);
        if (!host) return null;
        const narrow = window.innerWidth <= 564; // hud.css stacks the panel there
        const style = window.getComputedStyle(host);
        const rect = rectFor(host);
        const width = narrow
          ? Math.max(0, window.innerWidth - 40)
          : ((rect && rect.width) || parseFloat(style.width) || 380);
        const right = rect
          ? rect.right
          : window.innerWidth - (parseFloat(style.right) || 165);
        // The HUD host is 0 px tall (its panel is absolutely positioned inside),
        // so the panel's bottom edge is the host's top edge.
        let bottom = rect ? rect.top : window.innerHeight - (parseFloat(style.bottom) || 20);
        if (narrow) bottom -= 148;
        const height = Math.min(window.innerHeight - 40, 360);
        return { left: right - width, right, top: bottom - height, bottom };
      } catch (error) {
        return null;
      }
    }

    function intersects(x, y, rect) {
      if (!rect) return false;
      return x < rect.right && x + SIZE > rect.left && y < rect.bottom && y + SIZE > rect.top;
    }

    // Right-edge clamp for every `left` we ever write:
    //   maxLeft = window.innerWidth − mascotWidth − 24
    // mascotWidth is the bubble (175 px, right-aligned to the wrap) because it is
    // wider than the 130 px cat, so neither the cat nor its bubble can clip off
    // the right edge of the window.
    function maxLeftFor() {
      return Math.max(EDGE, window.innerWidth - MASCOT_WIDTH - RIGHT_GUARD);
    }

    // Clamp into the viewport (16 px margin) and keep clear of the HUD box.
    function safeSpot(x, y) {
      const maxLeft = maxLeftFor();
      const maxTop = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
      let left = clamp(x, EDGE, maxLeft);
      let top = clamp(y, EDGE, maxTop);
      const hud = hudBlockedRect();
      if (hud && intersects(left, top, hud)) {
        const above = hud.top - SIZE - GAP;
        const leftOf = hud.left - SIZE - GAP;
        if (above >= EDGE) top = Math.min(maxTop, above);
        else if (leftOf >= EDGE) left = Math.max(EDGE, leftOf);
        else { left = EDGE; top = EDGE; }
      }
      return { left: clamp(left, EDGE, maxLeft), top: clamp(top, EDGE, maxTop) };
    }

    /* ── Movement + horizontal flip ───────────────────────────────────────── */

    function alignBubble() {
      if (!bubbleEl) return;
      const bubbleWidth = Math.min(BUBBLE_MAX, bubbleEl.offsetWidth || BUBBLE_MAX);
      const overflowLeft = pos.left + SIZE - bubbleWidth;
      bubbleEl.classList.toggle('qb-bubble-left', overflowLeft < 8);
    }

    function applyPosition(left, top) {
      if (!wrapEl) return;
      pos = { left, top };
      wrapEl.style.left = Math.round(left) + 'px';
      wrapEl.style.top = Math.round(top) + 'px';
      alignBubble();
    }

    // Glide (CSS transition) to a target, flipping the cat to face its heading.
    function moveTo(x, y) {
      if (!wrapEl) return;
      const spot = safeSpot(x, y);
      const dx = spot.left - pos.left;
      if (Math.abs(dx) > 6) {
        facing = dx < 0 ? 'left' : 'right';
        if (imgEl) imgEl.classList.toggle('qb-facing-left', facing === 'left');
      }
      applyPosition(spot.left, spot.top);
    }

    // Force the un-mirrored pose (scaleX(1)): the Next page hop always keeps the
    // paw pointing right at the blue button, whatever way the cat last walked.
    function faceRight() {
      facing = 'right';
      if (imgEl) imgEl.classList.remove('qb-facing-left');
    }

    /* ── Speech bubble ────────────────────────────────────────────────────── */

    function setBubble(text, visible) {
      if (!bubbleEl) return;
      if (text) {
        bubbleEl.textContent = text;
        lastBubbleText = text;
      }
      bubbleEl.classList.toggle('qb-bubble-visible', visible !== false);
      alignBubble();
    }

    // Shuffle-no-repeat picker: each pool remembers its last line, so the same
    // dialog never appears twice in a row (and never echoes the live bubble).
    function rememberPick(pool, pick) {
      try { freshMemory.set(pool, pick); } catch (error) { /* ignore */ }
      return pick;
    }

    function pickFreshLine(pool) {
      if (!Array.isArray(pool) || !pool.length) return '';
      if (pool.length === 1) return pool[0];
      const last = freshMemory.get(pool) || '';
      let pick = last;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick !== last && pick !== lastBubbleText) return rememberPick(pool, pick);
      }
      // Tiny pool / unlucky rerolls: accept anything different from the last draw.
      if (pick === last) pick = pool[(pool.indexOf(last) + 1) % pool.length];
      return rememberPick(pool, pick);
    }

    // Idle chatter draws from the big IDLE_QUOTES pool.
    function randomQuote() {
      return pickFreshLine(IDLE_QUOTES);
    }

    // Temporary GIF overlay (double-click cheer, low-timer panic): show `state`'s
    // asset for `ms` with `line` in the bubble, then restore whatever the real
    // state machine currently wants. currentState never moves, so quiz logic and
    // the reconciliation loop are completely untouched by it.
    function startOverlay(state, ms, line) {
      if (!imgEl || !bubbleEl) return;
      if (!ASSETS[state]) return;
      if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
      overlayState = state;
      if (imgEl.dataset.state !== state) {
        applyAsset(state);
      }
      imgEl.classList.remove('qb-hop', 'qb-review');
      void imgEl.offsetWidth; // restart the hop animation
      imgEl.classList.add('qb-hop');
      if (line) setBubble(line, true);
      overlayTimer = setTimeout(restoreAfterOverlay, ms);
    }

    function restoreAfterOverlay() {
      overlayTimer = null;
      overlayState = '';
      if (!imgEl) return;
      const real = ASSETS[currentState] ? currentState : 'idle';
      if (imgEl.dataset.state !== real) {
        applyAsset(real);
      }
      if (real === 'review') imgEl.classList.add('qb-review');
      else imgEl.classList.remove('qb-review');
    }

    /* ── DOM: draggable cat + wrapped speech bubble ───────────────────────── */

    function mount() {
      if (wrapEl && wrapEl.isConnected) return;
      injectStyles();

      wrapEl = document.createElement('div');
      wrapEl.id = WRAP_ID;

      bubbleEl = document.createElement('div');
      bubbleEl.id = BUBBLE_ID;

      imgEl = document.createElement('img');
      imgEl.className = IMG_CLASS;
      imgEl.alt = 'Quiz bot cat mascot';
      imgEl.draggable = false;
      imgEl.dataset.state = 'idle';
      imgEl.addEventListener('error', onAssetError);
      applyAsset('idle');
      imgEl.addEventListener('click', onMascotClick);
      imgEl.addEventListener('mousedown', onDragStart);
      imgEl.addEventListener('dblclick', onMascotDoubleClick);
      imgEl.addEventListener('mouseenter', onMascotHover, { passive: true });

      wrapEl.appendChild(bubbleEl);
      wrapEl.appendChild(imgEl);

      // Paint the very first frame already parked bottom-right (no animation).
      const start = safeSpot(window.innerWidth - SIZE - 20, window.innerHeight - SIZE - 20);
      pos = { left: start.left, top: start.top };
      wrapEl.style.left = Math.round(start.left) + 'px';
      wrapEl.style.top = Math.round(start.top) + 'px';

      (document.body || document.documentElement).appendChild(wrapEl);
      alignBubble();

      document.addEventListener('mousemove', onDragMove, { passive: true });
      document.addEventListener('mouseup', onDragEnd, true);
      window.addEventListener('resize', onWindowResize, { passive: true });
    }

    // A missing/broken GIF never breaks the mascot: remember the file that
    // failed, then fall back to that state's fallback asset (harvesting →
    // idle.gif) while keeping the logical state — and its bubble — alive.
    function onAssetError() {
      try {
        if (!imgEl || !imgEl.dataset) return;
        const failed = imgEl.dataset.asset || '';
        if (failed) brokenAssets.add(failed);
        const logical = imgEl.dataset.state || 'idle';
        const path = ASSETS[renderKeyFor(logical)];
        if (path && path !== failed && !brokenAssets.has(path)) {
          imgEl.dataset.asset = path;
          imgEl.src = assetUrl(path);
          return;
        }
        if (imgEl.dataset.state !== 'idle') {
          imgEl.dataset.state = 'idle';
          imgEl.dataset.asset = ASSETS.idle;
          imgEl.src = assetUrl(ASSETS.idle);
          return;
        }
        warnOnce('asset', 'mascot assets could not be loaded');
      } catch (error) {
        /* never throw */
      }
    }

    // Single click: a playful petting reaction. The same click handler swallows
    // the second click of a double click (PET_COOLDOWN_MS) so the cheer takes over.
    function onMascotClick() {
      if (Date.now() < suppressClickUntil) return;
      const now = Date.now();
      if (now - lastPetAt < PET_COOLDOWN_MS) return;
      lastPetAt = now;
      try {
        if (currentState === 'idle') {
          const line = pickFreshLine(PET_LINES);
          if (line) setBubble(line, true);
          scheduleQuote();
          return;
        }
        if (currentState === 'thinking') { setBubble(pickFreshLine(THINKING_LINES), true); return; }
        if (currentState === 'answering') { setBubble(SPEECH.answering, true); return; }
        if (currentState === 'clicking') { setBubble(pickFreshLine(CLICKING_LINES), true); return; }
        if (currentState === 'nextpage') { setBubble(SPEECH.nextpage, true); return; }
        if (currentState === 'harvesting') { setBubble(SPEECH.harvesting, true); return; }
        if (currentState === 'typing') { setBubble(pickFreshLine(TYPING_LINES), true); return; }
        if (lastScoreLine) { setBubble(lastScoreLine, true); return; }
        setBubble(SPEECH.review, true);
      } catch (error) {
        warnOnce('click', error);
      }
    }

    // Double click: 1.8 s of answering.gif plus an excited cheer, then straight
    // back to whatever the state machine wants (idle / review / an action GIF).
    function onMascotDoubleClick() {
      if (Date.now() < suppressClickUntil) return;
      try {
        startOverlay('answering', CHEER_MS, pickFreshLine(HYPE_LINES));
      } catch (error) {
        warnOnce('double-click', error);
      }
    }

    // Hover: now and then a subtle hint — at most once per HOVER_COOLDOWN_MS and
    // only while idling, so it never talks over the bot's action bubbles.
    function onMascotHover() {
      try {
        if (!booted || drag || overlayState) return;
        const now = Date.now();
        if (now - lastHoverAt < HOVER_COOLDOWN_MS) return;
        lastHoverAt = now;
        if (currentState !== 'idle') return;
        if (Math.random() > HOVER_CHANCE) return;
        const line = pickFreshLine(HOVER_LINES);
        if (!line) return;
        setBubble(line, true);
        scheduleQuote();
      } catch (error) {
        warnOnce('hover', error);
      }
    }

    /* ── Dragging (the cat only — never the page, never a Moodle button) ──── */

    function onDragStart(event) {
      if (!wrapEl || event.button !== 0) return;
      const rect = rectFor(wrapEl) || { left: pos.left, top: pos.top };
      drag = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      wrapEl.classList.add('qb-dragging');
    }

    function onDragMove(event) {
      if (!drag || !wrapEl) return;
      const travelled = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (!drag.moved && travelled < 4) return;
      drag.moved = true;
      const maxLeft = maxLeftFor();
      const maxTop = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
      const left = clamp(event.clientX - drag.offsetX, EDGE, maxLeft);
      const top = clamp(event.clientY - drag.offsetY, EDGE, maxTop);
      pos = { left, top };
      wrapEl.style.left = Math.round(left) + 'px';
      wrapEl.style.top = Math.round(top) + 'px';
      alignBubble();
    }

    function onDragEnd() {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (!wrapEl) return;
      // Re-enable the glide transition only after the release frame, otherwise
      // the cat would animate back from where the drag started.
      window.requestAnimationFrame(() => {
        try { wrapEl.classList.remove('qb-dragging'); } catch (error) { /* ignore */ }
      });
      if (moved) {
        suppressClickUntil = Date.now() + 250;
        pauseRoamUntil = Date.now() + ROAM_PAUSE_AFTER_DRAG; // 15 s calm-down
      }
    }

    function onWindowResize() {
      try { moveTo(pos.left, pos.top); } catch (error) { warnOnce('resize', error); }
    }

    /* ── Idle chatter + review score (read-only) ──────────────────────────── */

    function scheduleQuote() {
      if (quoteTimer) clearTimeout(quoteTimer);
      quoteTimer = setTimeout(() => {
        quoteTimer = null;
        showRandomQuote();
      }, QUOTE_MIN_MS + Math.random() * QUOTE_SPREAD_MS);
    }

    function showRandomQuote() {
      if (!bubbleEl || currentState !== 'idle') return;
      if (overlayState) { scheduleQuote(); return; } // an overlay owns the bubble
      const text = randomQuote();
      if (text) setBubble(text, true);
      scheduleQuote();
    }

    function countRight() {
      try {
        const marked = document.querySelectorAll('.que.correct').length;
        if (marked) return marked;
        return document.querySelectorAll('.qnbutton.correct').length;
      } catch (error) {
        return 0;
      }
    }

    /* ── State machine ────────────────────────────────────────────────────── */

    function setState(next, options) {
      const state = ASSETS[next] ? next : 'idle';
      if (!imgEl || !bubbleEl) return;
      const opts = options || {};
      const changed = currentState !== state;
      currentState = state;

      if (changed) {
        if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (reviewTimer) { clearTimeout(reviewTimer); reviewTimer = null; }
        if (harvestTimer) { clearTimeout(harvestTimer); harvestTimer = null; }
        if (quoteTimer) { clearTimeout(quoteTimer); quoteTimer = null; }
        if (roamTimer) { clearTimeout(roamTimer); roamTimer = null; }
        // A queued action only survives the "AHA!!" reaction it was queued for.
        if (state !== 'answering') pendingAction = null;

        if (imgEl.dataset.state !== state) {
          applyAsset(state);
        }
        imgEl.classList.remove('qb-hop', 'qb-review');
        if (state === 'answering' || state === 'nextpage' || state === 'harvesting' || ACTION_STATES.includes(state)) {
          void imgEl.offsetWidth; // restart the hop animation
          imgEl.classList.add('qb-hop');
        } else if (state === 'review') {
          imgEl.classList.add('qb-review');
          lastLearnedShown = -1;
          reviewStartedAt = Date.now();
        }
      } else {
        // Unchanged state: only re-show an idle quote, or an explicit restart.
        if (state === 'idle' && opts.quote) { scheduleRoam(); showRandomQuote(); return; }
        if (!opts.restart) return;
      }

      if (state === 'idle') {
        scheduleRoam();
        if (changed || opts.quote) showRandomQuote();
        return;
      }

      if (state === 'thinking') {
        setBubble(pickFreshLine(READING_LINES), true);
        if (thinkTimer) clearTimeout(thinkTimer);
        thinkTimer = setTimeout(() => {
          thinkTimer = null;
          if (currentState === 'thinking') setBubble(pickFreshLine(THINKING_LINES), true);
        }, READING_HOLD_MS);
        return;
      }

      if (state === 'answering') {
        // Brief "AHA!! Found it! ✨" reaction, then the matching action GIF.
        setBubble(SPEECH.answering, true);
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (currentState !== 'answering') return;
          if (pendingAction) { startAction(); return; }
          setState('idle');
        }, ANSWER_REACT_MS);
        return;
      }

      if (ACTION_STATES.includes(state)) {
        // clicking: ~1.1 s of "Slapping that answer!! 🐾💥" on the exact dot, then
        // the "Next page!! 🐾➡️" hop. typing: 2.5 s of "Typing the answer... ⌨️🐾".
        setBubble(pickFreshLine(state === 'typing' ? TYPING_LINES : CLICKING_LINES), true);
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (currentState !== state) return;
          if (state === 'clicking') { hopToNextPage(); return; }
          setState('idle');
        }, state === 'clicking' ? SLAP_HOLD_MS : ACTION_HOLD_MS);
        return;
      }

      if (state === 'harvesting') {
        // Passive digging: content.js owns the harvest, the cat only narrates it.
        // Every harvest line re-arms the safety timer; the closing line (or a
        // 2 s silence) sends the cat back to idle.
        setBubble(SPEECH.harvesting, true);
        scheduleHarvestIdle(HARVEST_STALE_MS);
        return;
      }

      if (state === 'nextpage') {
        // Visual-only hop beside the Next page button — nothing is ever clicked.
        setBubble(SPEECH.nextpage, true);
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (currentState === 'nextpage') setState('idle');
        }, NEXT_HOP_MS);
        return;
      }

      // review
      setBubble(SPEECH.review, true);
      if (reviewTimer) clearTimeout(reviewTimer);
      reviewTimer = setTimeout(() => {
        reviewTimer = null;
        if (currentState !== 'review') return;
        if (announceReviewScore()) return; // e.g. "SHEESH!! High score!! ..."
        if (scoreAnnounced) return; // celebration already shown by an earlier pass
        setBubble(SPEECH.learned(countRight()), true);
      }, REVIEW_COUNT_DELAY_MS);
    }

    function refreshReviewCount() {
      if (currentState !== 'review') return;
      if (Date.now() - reviewStartedAt < REVIEW_COUNT_DELAY_MS) return;
      if (scoreAnnounced) return; // the score celebration already owns the bubble
      const count = countRight();
      if (count === lastLearnedShown) return;
      lastLearnedShown = count;
      setBubble(SPEECH.learned(count), true);
    }

    /* ── Shimeji roaming (idle only) ──────────────────────────────────────── */

    function scheduleRoam() {
      if (roamTimer) clearTimeout(roamTimer);
      roamTimer = null;
      if (currentState !== 'idle') return;
      roamTimer = setTimeout(() => {
        roamTimer = null;
        roamOnce();
      }, ROAM_MIN_MS + Math.random() * ROAM_SPREAD_MS);
    }

    function roamOnce() {
      if (currentState !== 'idle' || drag) { scheduleRoam(); return; }
      if (Date.now() < pauseRoamUntil) { scheduleRoam(); return; } // 15 s after a drag
      const target = pickRoamTarget();
      moveTo(target.left, target.top);
      scheduleRoam();
    }

    function pickRoamTarget() {
      const maxLeft = maxLeftFor();
      const maxTop = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
      const roll = Math.random();
      let next;
      if (roll < 0.55) {
        // bottom edge stroll
        next = { left: EDGE + Math.random() * (maxLeft - EDGE), top: maxTop };
      } else if (roll < 0.8) {
        // left side climb
        next = {
          left: EDGE + Math.random() * Math.min(120, maxLeft - EDGE),
          top: maxTop * (0.25 + Math.random() * 0.75),
        };
      } else {
        // right side (safeSpot lifts the cat above the HUD box when needed)
        next = { left: maxLeft, top: maxTop * (0.25 + Math.random() * 0.75) };
      }
      // Avoid micro-movements: if the target is on top of the cat, cross over.
      if (Math.abs(next.left - pos.left) < 40 && Math.abs(next.top - pos.top) < 40) {
        const farLeft = pos.left > (maxLeft + EDGE) / 2;
        next = { left: farLeft ? EDGE + Math.random() * 80 : maxLeft - Math.random() * 80, top: maxTop };
      }
      return next;
    }

    /* ── Moodle DOM helpers (strictly read-only) ──────────────────────────── */

    const ANSWERED_RE = /\b(correct|incorrect|partiallycorrect|answersaved|complete|finished|gradedright|gradedwrong)\b/;

    function questionTextOf(container) {
      if (!container) return '';
      const node = container.querySelector('.qtext, .questiontext, .prompt, legend');
      return norm(node ? (node.innerText || node.textContent) : (container.innerText || '')).slice(0, 160);
    }

    function questionKeyOf(container) {
      if (!container) return '';
      const number = container.querySelector('.qno, .questionnumber');
      return norm(number ? number.textContent : '') + '|' + questionTextOf(container);
    }

    function isAnswered(container) {
      if (!container) return true;
      if (ANSWERED_RE.test(String(container.className || '').toLowerCase())) return true;
      try {
        return !!container.querySelector('.rightanswer, .outcome .correct, .outcome .incorrect');
      } catch (error) {
        return true;
      }
    }

    function onScreen(rect) {
      if (!rect) return false;
      return rect.bottom > 8
        && rect.top < window.innerHeight - 8
        && rect.right > 8
        && rect.left < window.innerWidth - 8;
    }

    function activeQuestion() {
      try {
        const list = document.querySelectorAll('.que');
        for (let i = 0; i < list.length; i += 1) {
          const candidate = list[i];
          if (isAnswered(candidate)) continue;
          if (!onScreen(rectFor(candidate))) continue;
          return candidate;
        }
      } catch (error) {
        warnOnce('active-question', error);
      }
      return null;
    }

    // Park immediately to the right of a box, or to its left when there is no
    // room, always through the viewport/HUD clamp.
    function beside(rect) {
      if (!rect || !onScreen(rect)) return null;
      const centreY = rect.top + rect.height / 2 - SIZE / 2;
      let left = rect.right + GAP;
      if (left > maxLeftFor()) left = rect.left - SIZE - GAP;
      return safeSpot(left, centreY);
    }

    // Park exactly beside a control: just right of its right edge (or left of it
    // when the right side has no room) and 40 px above its top edge — always
    // through the viewport/HUD clamp, so the cat can never leave the window.
    function besideExact(rect) {
      if (!rect) return null;
      let left = rect.right + GAP;
      if (left > maxLeftFor()) left = rect.left - SIZE - GAP;
      return safeSpot(left, rect.top - TARGET_LIFT);
    }

    // The precise radio dot / checkbox the bot just ticked: the control captured
    // from the page event while it is still fresh and checked, otherwise the
    // first checked radio/checkbox inside the open question.
    function slapInput() {
      try {
        const hint = lastControl;
        if (hint && hint.element && hint.kind === 'clicking' && Date.now() - hint.at < CONTROL_HINT_MS) {
          const element = hint.element;
          const tag = String(element.tagName || '').toLowerCase();
          const type = String(element.type || '').toLowerCase();
          if (tag === 'input' && (type === 'radio' || type === 'checkbox') && element.checked) return element;
        }
        return document.querySelector('.que input[type="radio"]:checked, .que input[type="checkbox"]:checked');
      } catch (error) { /* ignore */ }
      return null;
    }

    // Where the slap happens: the input's own rect first (that is the dot the
    // user asked for), then its row/label, then whatever the DOM says was chosen.
    function slapSpot(fallbackAnchor) {
      const input = slapInput();
      const inputRect = rectFor(input);
      if (inputRect && onScreen(inputRect)) return besideExact(inputRect);
      const rowRect = rectFor(fallbackAnchor) || rectFor(anchorFor(input)) || rectFor(bestAnswerAnchor());
      if (rowRect) return besideExact(rowRect);
      return beside(rowRect);
    }

    /* ── Moodle "Next page" navigation button (read-only) ─────────────────── */

    // Ordered candidates. A real forward control (name="next" / Moodle's own nav
    // id or class) always wins; the generic `.submitbtns` submit is only a last
    // resort, because that container also holds the "Previous page" button and
    // it comes FIRST in document order — which is exactly how the cat used to
    // end up guarding the left-hand Previous button.
    const NEXT_BUTTON_SELECTORS = [
      'input[name="next"]',
      'button[name="next"]',
      '#mod_quiz-next-nav',
      'input.mod_quiz-next-nav',
      'button.mod_quiz-next-nav',
      'a.mod_quiz-next-nav',
      '.submitbtns input[type="submit"]:not([name="previous"]):not([name="prev"])',
      '.submitbtns button[type="submit"]:not([name="previous"]):not([name="prev"])',
      '.submitbtns a.mod_quiz-next-nav'
    ];
    const NEXT_VALUE_RE = /next|finish/i;          // "Next page", "Finish attempt ..."
    const PREVIOUS_RE = /previous|prev\b|back\b/i; // never a forward target

    function navTextOf(node) {
      return {
        name: norm(node.getAttribute('name') || node.name || '').toLowerCase(),
        id: norm(node.id || '').toLowerCase(),
        cls: norm(node.getAttribute('class') || node.className || '').toLowerCase(),
        value: norm(node.value || '').toLowerCase(),
        text: norm(node.textContent || '').toLowerCase(),
        type: String(node.type || '').toLowerCase()
      };
    }

    // True only for the forward/next control: name="next", Moodle's nav id/class,
    // or a footer submit whose label says next/finish. "Previous page", "Back"
    // and hidden/reset inputs are always rejected.
    function isForwardNav(node) {
      try {
        if (!node || node.nodeType !== 1) return false;
        const meta = navTextOf(node);
        if (meta.type === 'hidden' || meta.type === 'reset') return false;
        if (meta.name.indexOf('previous') >= 0 || meta.name === 'prev') return false;
        if (meta.id.indexOf('previous') >= 0 || meta.id === 'prev') return false;
        const label = [meta.name, meta.id, meta.value, meta.text].filter(Boolean).join(' ');
        if (PREVIOUS_RE.test(label)) return false;
        if (meta.name === 'next') return true;
        if (meta.id === 'mod_quiz-next-nav') return true;
        if (/\bmod_quiz-next-nav\b/.test(meta.cls)) return true;
        return NEXT_VALUE_RE.test(meta.value + ' ' + meta.text);
      } catch (error) {
        return false;
      }
    }

    // The first *visible* forward button in the page's nav footer, if any.
    function findNextButton() {
      try {
        const seen = new Set();
        for (let s = 0; s < NEXT_BUTTON_SELECTORS.length; s += 1) {
          const list = document.querySelectorAll(NEXT_BUTTON_SELECTORS[s]);
          for (let i = 0; i < list.length; i += 1) {
            const node = list[i];
            if (seen.has(node)) continue;
            seen.add(node);
            if (!isForwardNav(node)) continue;
            const style = window.getComputedStyle(node);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
            const rect = rectFor(node);
            if (!rect || !onScreen(rect)) continue;
            return { element: node, rect: rect };
          }
        }
      } catch (error) {
        warnOnce('next-button', error);
      }
      return null;
    }

    /* ── Triggers (all read-only) ─────────────────────────────────────────── */

    function botRunning() {
      try {
        const host = document.getElementById(HUD_HOST_ID);
        if (!host) return false;
        if (host.dataset && host.dataset.running === '1') return true;
        return /\bactive\b/.test(String(host.className || ''));
      } catch (error) {
        return false;
      }
    }

    // The visible row of an answer control (never the invisible input itself).
    function anchorFor(control) {
      if (!control || control.nodeType !== 1) return null;
      try {
        const tag = String(control.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
          const label = control.closest && control.closest('label');
          if (label) return label;
          const row = control.closest && control.closest('.answer > div, .answer, .fitem, .ablock, .r0, .r1');
          if (row) return row;
        }
      } catch (error) { /* ignore */ }
      return control;
    }

    function bestAnswerAnchor() {
      try {
        const checked = document.querySelector('.que input[type="radio"]:checked, .que input[type="checkbox"]:checked');
        if (checked) return anchorFor(checked);
        const typed = Array.prototype.find.call(
          document.querySelectorAll('.que input[type="text"], .que input[type="number"], .que textarea'),
          (input) => String(input.value || '').trim()
        );
        if (typed) return anchorFor(typed);
        const chosen = Array.prototype.find.call(
          document.querySelectorAll('.que select'),
          (select) => select.value && select.value !== '0'
        );
        if (chosen) return anchorFor(chosen);
        const container = activeQuestion();
        if (container) return container.querySelector('.qtext, .questiontext') || container;
      } catch (error) { /* ignore */ }
      return null;
    }

    // 'typing' for a fill-in-the-blank / short-answer box, 'clicking' for a
    // radio / checkbox / dropdown — '' when the node is not an answer control.
    function kindForControl(node) {
      if (!node || node.nodeType !== 1) return '';
      const tag = String(node.tagName || '').toLowerCase();
      if (tag === 'textarea') return 'typing';
      if (tag === 'select') return 'clicking';
      if (tag !== 'input') return '';
      const type = String(node.type || 'text').toLowerCase();
      if (type === 'radio' || type === 'checkbox') return 'clicking';
      if (type === 'text' || type === 'number' || type === 'search' || type === 'email' || type === 'url' || type === 'tel') {
        return 'typing';
      }
      return '';
    }

    // Read-only DOM guess (used when the HUD line itself does not say which
    // move happened): a checked radio/checkbox or a chosen dropdown is a click,
    // otherwise a filled text box is typing.
    function detectActionKind() {
      try {
        const checked = document.querySelector('.que input[type="radio"]:checked, .que input[type="checkbox"]:checked');
        if (checked) return 'clicking';
        const chosen = Array.prototype.find.call(
          document.querySelectorAll('.que select'),
          (select) => select.value && select.value !== '0'
        );
        if (chosen) return 'clicking';
        const typed = Array.prototype.find.call(
          document.querySelectorAll('.que input[type="text"], .que input[type="number"], .que textarea'),
          (input) => String(input.value || '').trim()
        );
        if (typed) return 'typing';
      } catch (error) { /* ignore */ }
      return 'clicking';
    }

    // Where to hop for an action: the control that just fired (most precise),
    // then the live DOM of the current question.
    function actionAnchor(kind) {
      try {
        if (lastControl && lastControl.kind === kind && Date.now() - lastControl.at < CONTROL_HINT_MS) {
          const anchor = anchorFor(lastControl.element);
          if (rectFor(anchor)) return anchor;
        }
        if (kind === 'typing') {
          const typed = Array.prototype.find.call(
            document.querySelectorAll('.que input[type="text"], .que input[type="number"], .que textarea'),
            (input) => String(input.value || '').trim()
          );
          if (typed) return anchorFor(typed);
        } else {
          const checked = document.querySelector('.que input[type="radio"]:checked, .que input[type="checkbox"]:checked');
          if (checked) return anchorFor(checked);
          const chosen = Array.prototype.find.call(
            document.querySelectorAll('.que select'),
            (select) => select.value && select.value !== '0'
          );
          if (chosen) return anchorFor(chosen);
        }
        const container = activeQuestion();
        if (container) return container.querySelector('.qtext, .questiontext') || container;
      } catch (error) { /* ignore */ }
      return bestAnswerAnchor();
    }

    function enterThinking(container) {
      setState('thinking', { restart: true });
      const anchor = container ? (container.querySelector('.qtext, .questiontext') || container) : null;
      const spot = beside(rectFor(anchor));
      if (spot) moveTo(spot.left, spot.top);
    }

    function noteQuestion() {
      try {
        if (!wrapEl || isReviewPage()) return;
        const container = activeQuestion();
        if (!container) return;
        const key = questionKeyOf(container);
        if (!key || answeredKeys.has(key)) return;
        if (key === lastQuestionKey && Date.now() - lastQuestionAt < 4000) return;
        lastQuestionKey = key;
        lastQuestionAt = Date.now();
        enterThinking(container);
      } catch (error) {
        warnOnce('note-question', error);
      }
    }

    // Answer detected → brief "AHA!! Found it! ✨" hop, then the matching action
    // GIF (`clicking` or `typing`) parked beside the control that was answered.
    function enterAnswering(anchor, kind) {
      const now = Date.now();
      if (now - lastAnswerAt < ANSWER_THROTTLE_MS) return; // DOM + log double-fire
      lastAnswerAt = now;

      const key = questionKeyOf(activeQuestion());
      if (key) answeredKeys.add(key);

      let resolvedKind = (kind === 'typing' || kind === 'clicking') ? kind : '';
      if (!resolvedKind) {
        const hint = lastControl && now - lastControl.at < CONTROL_HINT_MS ? lastControl : null;
        resolvedKind = hint ? hint.kind : detectActionKind();
      }
      const hintForKind = (lastControl && lastControl.kind === resolvedKind && now - lastControl.at < CONTROL_HINT_MS)
        ? lastControl
        : null;
      const anchorEl = anchor || (hintForKind ? anchorFor(hintForKind.element) : null) || actionAnchor(resolvedKind);

      pendingAction = { kind: resolvedKind, anchor: anchorEl || null };
      setState('answering');
      const spot = beside(rectFor(anchorEl));
      if (spot) moveTo(spot.left, spot.top);
    }

    // Second half of an answer: play clicking.gif right on the exact radio dot /
    // checkbox the bot ticked (then hop beside the Next page button), or
    // typing.gif beside the text box it filled in.
    function startAction() {
      const action = pendingAction || {};
      pendingAction = null;
      const kind = action.kind === 'typing' ? 'typing' : 'clicking';
      setState(kind, { restart: true });
      if (kind === 'typing') {
        const anchor = action.anchor || actionAnchor(kind);
        const spot = beside(rectFor(anchor)) || beside(rectFor(bestAnswerAnchor()));
        if (spot) moveTo(spot.left, spot.top);
        return;
      }
      // clicking.gif: land on the *exact* dot / checkbox, not just its row.
      const spot = slapSpot(action.anchor || actionAnchor(kind));
      if (spot) moveTo(spot.left, spot.top);
    }

    // Visual-only hop: park the cat directly left of the visible Next page button
    // (left − 140 px, top − 45 px, clamped into the viewport) and face it right
    // so the paw slaps the blue button itself. The button is never clicked or
    // submitted — this is animation only, exactly like the rest of the mascot.
    function hopToNextPage() {
      const next = findNextButton();
      if (!next) { setState('idle'); return; }
      setState('nextpage', { restart: true });
      const spot = safeSpot(next.rect.left - NEXT_OFFSET_X, next.rect.top - NEXT_OFFSET_Y);
      if (spot) {
        moveTo(spot.left, spot.top);
        faceRight();
      }
    }

    function enterReview() {
      const alreadyReview = currentState === 'review';
      setState('review');
      if (alreadyReview && reviewParked) return;
      const summary = document.querySelector('.quizreviewsummary, #quizreviewsummary, .reviewsummary, .quizreview, .totalgrade, .grade');
      const spot = beside(rectFor(summary));
      if (spot) {
        moveTo(spot.left, spot.top);
        reviewParked = true;
      }
    }

    /* ── Live page awareness: low-timer alarm + review score celebration ──── */

    function isAttemptPage() {
      try {
        const path = String((typeof location !== 'undefined' && location.pathname) || '');
        return path.includes('/mod/quiz/attempt.php') || path.includes('/attempt.php');
      } catch (error) {
        return false;
      }
    }

    // "0:04:37" / "4:37" / "4 mins 37 secs" / "45 secs" → seconds remaining.
    function parseRemainingSeconds(text) {
      const raw = norm(text).toLowerCase();
      if (!raw) return null;
      const clock = raw.match(/(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?/);
      if (clock) {
        const first = Number(clock[1]);
        const second = Number(clock[2]);
        if (clock[3] == null) return first * 60 + second;
        return first * 3600 + second * 60 + Number(clock[3]);
      }
      const hours = raw.match(/(\d+)\s*(?:hours?|hrs?|h)\b/);
      const mins = raw.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
      const secs = raw.match(/(\d+)\s*(?:seconds?|secs?|s)\b/);
      if (hours || mins || secs) {
        return (hours ? Number(hours[1]) * 3600 : 0)
          + (mins ? Number(mins[1]) * 60 : 0)
          + (secs ? Number(secs[1]) : 0);
      }
      const bare = raw.match(/\b(\d{1,4})\b/);
      return bare ? Number(bare[1]) : null;
    }

    function remainingSeconds() {
      const selectors = ['#quiz-time-left', '#quiz-timer'];
      for (let i = 0; i < selectors.length; i += 1) {
        let node = null;
        try { node = document.querySelector(selectors[i]); } catch (error) { node = null; }
        if (!node) continue;
        const seconds = parseRemainingSeconds(node.innerText || node.textContent);
        if (seconds != null) return seconds;
      }
      return null;
    }

    // Polled every 10 s: shout exactly once when the attempt drops under 5 min.
    // The alarm re-arms by itself if the timer climbs back above 5 min (i.e. the
    // next attempt), so each attempt gets one panic and no nagging.
    function checkQuizTimer() {
      try {
        if (!booted || isReviewPage() || !isAttemptPage()) return;
        const seconds = remainingSeconds();
        if (seconds == null) return;
        if (seconds > TIMER_PANIC_SECONDS) { panicWarned = false; return; }
        if (seconds <= 0 || panicWarned) return;
        panicWarned = true;
        startOverlay('review', PANIC_HOLD_MS, PANIC_LINE);
      } catch (error) {
        warnOnce('timer-check', error);
      }
    }

    // Grade-ish text → percentage: "88.00 %", "Grade 44 out of 50.00" and
    // "90.00/100.00" all resolve to a 0–100 value.
    function percentFromText(text) {
      const raw = norm(text);
      if (!raw) return null;
      const percent = raw.match(/(\d{1,3}(?:[.,]\d+)?)\s*(?:%|percent)/i);
      if (percent) {
        const value = Number(percent[1].replace(',', '.'));
        if (!Number.isNaN(value) && value >= 0 && value <= 100) return value;
      }
      const fraction = raw.match(/(\d{1,4}(?:[.,]\d+)?)\s*(?:out\s+of|\/)\s*(\d{1,4}(?:[.,]\d+)?)/i);
      if (fraction) {
        const got = Number(fraction[1].replace(',', '.'));
        const max = Number(fraction[2].replace(',', '.'));
        if (!Number.isNaN(got) && !Number.isNaN(max) && max > 0 && got >= 0 && got <= max) {
          return (got / max) * 100;
        }
      }
      return null;
    }

    // Overall percentage from the review grade table only — never a single
    // question's "Grade 1.00 out of 1.00" row.
    function reviewPercent() {
      try {
        const summary = document.querySelector('.quizreviewsummary, #quizreviewsummary');
        if (summary) {
          const direct = percentFromText(summary.innerText || summary.textContent);
          if (direct != null) return direct;
          const cells = summary.querySelectorAll('td, .cell, .quizreviewsummarygrade');
          for (let i = 0; i < cells.length; i += 1) {
            const value = percentFromText(cells[i].innerText || cells[i].textContent);
            if (value != null) return value;
          }
          return null;
        }
        const fallback = document.querySelector('.totalgrade, .reviewsummary');
        return fallback ? percentFromText(fallback.innerText || fallback.textContent) : null;
      } catch (error) {
        warnOnce('review-percent', error);
        return null;
      }
    }

    // One celebration per review page load, picked from the score band. Returns
    // false (and says nothing) when the grade table is missing or unreadable, so
    // setState('review') can fall back to the "Learned X right!" line.
    function announceReviewScore() {
      if (scoreAnnounced) return false;
      const percent = reviewPercent();
      if (percent == null) return false;
      scoreAnnounced = true;
      const line = percent >= 90
        ? pickFreshLine(SCORE_HIGH_LINES)
        : (percent >= 75 ? pickFreshLine(SCORE_PASS_LINES) : pickFreshLine(SCORE_LOW_LINES));
      if (line) { lastScoreLine = line; setBubble(line, true); } // remember + show
      if (imgEl) {
        imgEl.classList.remove('qb-hop');
        void imgEl.offsetWidth;
        imgEl.classList.add('qb-hop');
      }
      return true;
    }

    /* ── Reconciliation loop (poll): never invents a click, only state ────── */

    function refresh() {
      if (!booted || !wrapEl) return;
      if (isReviewPage()) {
        enterReview();
        if (!scoreAnnounced) announceReviewScore(); // grade table may load late
        return;
      }
      if (currentState === 'review') { reviewParked = false; setState('idle'); }
      // Hold the "AHA!!" reaction and the clicking / typing action GIF.
      if (currentState === 'answering' || currentState === 'nextpage' || currentState === 'harvesting'
        || ACTION_STATES.includes(currentState)) return;

      if (!botRunning()) {
        if (currentState !== 'idle') setState('idle');
        return;
      }

      const container = activeQuestion();
      if (!container) { if (currentState !== 'idle') setState('idle'); return; }
      const key = questionKeyOf(container);
      if (!key || answeredKeys.has(key)) {
        if (currentState !== 'idle') setState('idle');
        return;
      }
      if (key === lastQuestionKey) return; // already reading/thinking about it
      lastQuestionKey = key;
      lastQuestionAt = Date.now();
      enterThinking(container);
    }

    /* ── HUD log observation (read-only, pass-through tee) ────────────────── */

    /* ── Harvesting narration (still read-only) ───────────────────────────── */

    // Lines content.js / background.js stream while a course/review harvest runs:
    //   "Auto-harvesting answers for CS6301"
    //   Harvest "data structures" page 1: HTTP 200, 3 matched card(s)
    //   Review harvest: scanning grade report for CS6301...
    //   Review harvest [3/12]: Long Quiz 2
    const HARVEST_START_RE = /harvest\s+"|auto-harvesting answers|scanning grade report|review harvest\s*\[|answer harvesting is running/;
    // Lines that carry a scoop count:
    //   Harvested 3 answers for "data structures"   (background, per keyword)
    //   Auto-harvested 12 answers for CS6301
    //   Review harvest: 5 verified answer(s), 2 eliminated wrong choice(s)
    const HARVEST_COUNT_RES = [
      /harvest(?:ed)?\s+(\d+)\s+answers?\b/,
      /review harvest:\s*(\d+)\s+verified/,
    ];
    // Harvest endings that carry no count (nothing left to dig).
    const HARVEST_DONE_RE = /review harvest:\s*nothing new|course already harvested|review harvest failed|could not load course topics|harvesting (?:request )?failed|harvest is already running|no completed quizzes/;

    // Back to idle after `ms` of quiet — re-armed by every harvest line.
    function scheduleHarvestIdle(ms) {
      if (harvestTimer) clearTimeout(harvestTimer);
      harvestTimer = setTimeout(() => {
        harvestTimer = null;
        if (currentState === 'harvesting') setState('idle');
      }, ms);
    }

    function enterHarvesting() {
      // restart=true re-shows "Digging up answers..." even if the cat is already
      // digging, and re-arms the 20 s safety timer through the state body.
      setState('harvesting', { restart: true });
    }

    function finishHarvesting(count) {
      if (count != null) setBubble(SPEECH.scooped(count), true);
      scheduleHarvestIdle(HARVEST_HOLD_MS);
    }

    // Returns true when `line` was a harvest line and nothing else should read
    // it. A count line is always swallowed (a harvest summary must never look
    // like an answer event); scoops/endings only act on a *running* harvest.
    function noteHarvestLine(line) {
      if (!line) return false;
      let count = null;
      for (let i = 0; i < HARVEST_COUNT_RES.length; i += 1) {
        const match = line.match(HARVEST_COUNT_RES[i]);
        if (match) { count = Math.max(0, Number(match[1]) || 0); break; }
      }
      if (count != null) {
        if (currentState === 'harvesting') finishHarvesting(count);
        return true;
      }
      if (currentState === 'harvesting' && HARVEST_DONE_RE.test(line)) {
        finishHarvesting(null);
        return true;
      }
      if (HARVEST_START_RE.test(line)) {
        enterHarvesting();
        return true;
      }
      return false;
    }

    // Which GIF a HUD line implies:
    //   'typing'   — a fill-in-the-blank / short-answer box got typed into
    //   'clicking' — a radio / checkbox / dropdown answer got chosen
    //   'answer'   — the bot answered, but the wording does not say how, so the
    //                active .que decides (filled text box vs. checked option)
    //   ''         — the line is not about choosing an answer
    // Manual-wait/timeout lines only *announce* that the bot is waiting, so they
    // are never treated as an action.
    function classifyLogAction(line) {
      if (!line) return '';
      if (/waiting for manual|manual [a-z]* ?timeout|no ai answer|all answered|advancing/.test(line)) return '';
      if (/\btyped\b|\btyping\b|\btext\s*(answer|input|box|field)\b|fill[- ]?(in|the[- ]blank)|\bblank\b|\bshort[- ]answer\b/.test(line)) {
        return 'typing';
      }
      if (/\bselected\b|\bselecting\b|\bselection\b|\bmatched\b|\bmatch(es|ing)?\b|\bticked\b|\bticking\b|\bclicked\b|\bclicking\b|\bchecked\b|\bchose\b|\bchosen\b|\boption\s+\d|\bdropdown\s+\d|\btier\s+\d/.test(line)) {
        return 'clicking';
      }
      if (/\banswer(ed|s|ing)?\b|saved manual/.test(line)) return 'answer';
      return '';
    }

    function onHudLog(level, text) {
      const line = String(text == null ? '' : text)
        .toLowerCase()
        .replace(/^\s*\[[^\]]*\]\s*/, ''); // drop an optional [timestamp]
      if (!line) return;

      // Harvest progress owns the cat first: these lines must never fall through
      // to the answer classifier ("3 matched card(s)" would look like a click).
      if (noteHarvestLine(line)) return;

      if (isReviewPage() || /review page:/.test(line)) {
        enterReview();
        if (/learned\s+\d+\s+right/.test(line)) refreshReviewCount();
        return;
      }
      if (/^\s*q:|^\s*question:/.test(line)) { noteQuestion(); return; }

      const actionKind = classifyLogAction(line);
      if (actionKind) {
        // `Typed:` → typing.gif, `Selected:` / `Matched:` / `Ticked` / `Option N`
        // / `Dropdown N` / `Tier N` → clicking.gif. An ambiguous answer line falls
        // back to the DOM hint (filled text box vs. checked option).
        enterAnswering(null, actionKind === 'answer' ? '' : actionKind);
        return;
      }

      if (/waiting for manual/.test(line) || /bot started|scanning/.test(line)) {
        noteQuestion();
        return;
      }
      if (/bot stopped|^\s*stop\s*$|max runtime/.test(line)) setState('idle');
    }

    // content.js declares `function logHUD(...)`, which lives on the shared
    // isolated-world global object. Tee it: read the text, then delegate the
    // exact same arguments/return value. Nothing is altered, nothing can block.
    function hookHudLog() {
      try {
        const original = window.logHUD;
        if (typeof original !== 'function') return false;
        if (original.__qbMascotTee) return true;
        const tee = function (level, text) {
          try { onHudLog(level, text); } catch (error) { /* mascot only */ }
          return original.apply(this, arguments);
        };
        tee.__qbMascotTee = true;
        window.logHUD = tee;
        return true;
      } catch (error) {
        warnOnce('log-tee', error);
        return false;
      }
    }

    function watchHudLog() {
      if (hookHudLog()) return;
      let attempts = 0;
      const retry = setInterval(() => {
        attempts += 1;
        if (hookHudLog() || attempts >= 30) clearInterval(retry);
      }, 1000);
    }

    // Belt and braces: if a HUD build ever exposes a visible log node
    // (#qb-log / .qb-log) outside its shadow root, mirror its last line.
    function readLogNode(container) {
      try {
        if (!container) return;
        const rows = container.querySelectorAll('.hud-log-line, .log-line, li, div');
        const node = rows.length ? rows[rows.length - 1] : container;
        const text = norm(node.textContent).slice(0, 240);
        if (!text || text === lastLogLine) return;
        lastLogLine = text;
        onHudLog('info', text);
      } catch (error) {
        warnOnce('log-node', error);
      }
    }

    function watchLogNodes() {
      const attach = () => {
        let container = null;
        try { container = document.querySelector('#qb-log, .qb-log'); } catch (error) { container = null; }
        if (!container) return false;
        const observer = new MutationObserver(() => readLogNode(container));
        observer.observe(container, { childList: true, subtree: true, characterData: true });
        readLogNode(container);
        return true;
      };
      if (attach()) return;
      let attempts = 0;
      const retry = setInterval(() => {
        attempts += 1;
        if (attach() || attempts >= 30) clearInterval(retry);
      }, 1000);
    }

    /* ── Passive answer listeners (capture + passive, never cancelled) ─────── */

    function isAnswerControl(node) {
      if (!node || node.nodeType !== 1) return false;
      const tag = String(node.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false;
      try {
        return !!(node.closest && node.closest('.que, .formulation'));
      } catch (error) {
        return false;
      }
    }

    function onPageAnswerEvent(event) {
      try {
        if (!booted) return;
        const target = event && event.target;
        if (!isAnswerControl(target)) return;
        const type = String((event && event.type) || '').toLowerCase();
        const kind = kindForControl(target);
        if (!kind) return;
        // A click only *chooses* for a radio/checkbox. A text box is merely
        // focused and a dropdown merely opened, so those wait for `change`.
        if (type === 'click') {
          const tag = String(target.tagName || '').toLowerCase();
          if (tag !== 'input') return;
          const inputType = String(target.type || '').toLowerCase();
          if (inputType !== 'radio' && inputType !== 'checkbox') return;
        }
        lastControl = { kind, element: target, at: Date.now() };
        enterAnswering(anchorFor(target), kind);
      } catch (error) {
        warnOnce('answer-event', error);
      }
    }

    function watchAnswerControls() {
      document.addEventListener('change', onPageAnswerEvent, { capture: true, passive: true });
      document.addEventListener('click', onPageAnswerEvent, { capture: true, passive: true });
    }

    /* ── Moodle DOM observation (debounced, read-only) ────────────────────── */

    function onMoodleMutation() {
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        try {
          refreshReviewCount();
          refresh();
        } catch (error) {
          warnOnce('mutation', error);
        }
      }, MUTATION_DEBOUNCE_MS);
    }

    function watchMoodleDom() {
      try {
        const observer = new MutationObserver(onMoodleMutation);
        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      } catch (error) {
        warnOnce('dom-observe', error);
      }
    }

    /* ── Boot ─────────────────────────────────────────────────────────────── */

    function boot() {
      if (booted) return;
      booted = true;

      try {
        mount();
      } catch (error) {
        warnOnce('mount', error);
        return;
      }

      try {
        if (isReviewPage()) {
          setState('review');
          enterReview();
        } else {
          setState('idle', { quote: true });
        }
      } catch (error) {
        warnOnce('initial-state', error);
      }

      try { watchHudLog(); } catch (error) { warnOnce('log-tee-boot', error); }
      try { watchLogNodes(); } catch (error) { warnOnce('log-watch', error); }
      try { watchAnswerControls(); } catch (error) { warnOnce('answer-watch', error); }
      try { watchMoodleDom(); } catch (error) { warnOnce('dom-watch', error); }

      try {
        tickTimer = setInterval(() => {
          try { refresh(); } catch (error) { warnOnce('tick', error); }
        }, TICK_MS);
      } catch (error) {
        warnOnce('tick-start', error);
      }

      try {
        checkQuizTimer(); // one immediate look, then every 10 s on /attempt.php
        timerCheck = setInterval(() => {
          try { checkQuizTimer(); } catch (error) { warnOnce('timer-tick', error); }
        }, TIMER_CHECK_MS);
      } catch (error) {
        warnOnce('timer-start', error);
      }

      try { refresh(); } catch (error) { warnOnce('refresh-boot', error); }
    }

    // Optional, non-invasive integration hook used only by the console or a test
    // harness. Nothing in content.js uses it:
    //   window.dispatchEvent(new CustomEvent('qb-mascot-state', { detail: { state: 'thinking' } }));
    window.addEventListener('qb-mascot-state', (event) => {
      try {
        const detail = (event && event.detail) || {};
        const next = typeof detail === 'string' ? detail : String(detail.state || '');
        if (ASSETS[next]) setState(next);
      } catch (error) {
        warnOnce('external-state', error);
      }
    });

    function start() {
      try {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            try { boot(); } catch (error) { warnOnce('boot', error); }
          }, { once: true });
        } else {
          boot();
        }
      } catch (error) {
        warnOnce('start', error);
      }
    }

    start();
  })();
} catch (error) {
  try { console.warn('[Mascot]', error); } catch (ignored) { /* never throw */ }
}
