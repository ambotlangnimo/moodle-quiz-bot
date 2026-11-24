/* ─────────────────────────────────────────────────────────────────────────────
   mascot.js — three global pixel-art cats for the Quiz Bot.

   HARD RULE: this file never touches quiz logic. It cannot click, submit,
   navigate or block anything:
     • no element.click(), no preventDefault(), no stopPropagation();
     • every page listener is passive and side-effect free;
     • state is inferred read-only (DOM observation + a pass-through tee on the
       HUD logger that only *reads* the text, then delegates unchanged);
     • the whole file is wrapped in try/catch, so a mascot bug can only ever
       disable the mascot — quiz solving, review learning and GitHub bank
       syncing keep running exactly as in previous version/content.js.

   PIXEL ENGINE (no images): a 96×96 <canvas> with `image-rendering: pixelated`
   draws hand-plotted 24×24 pixel-matrix frames at ~7 FPS. Every state is pure
   JS (tail wag, blink, ear twitch, trot cycle, glasses, laptop, pickaxe…), so
   the mascot weighs nothing and never waits on a download.

   3-CAT SQUAD, every tab ("Cat squad presence" below): the roster is
   Mochi (orange tabby, hyper speedrunner), Luna (tuxedo, deadpan genius) and
   Boba (calico, sleepy loot goblin). `CAT_SQUAD` in chrome.storage.local holds
   three assignment slots; each working tab claims the specialist for its job
   (exam → Mochi, review → Luna, harvest → Boba) and a second, third tab picks
   one of the remaining free cats, so several tabs work in parallel. Tabs with
   no cat hide the workers and show a live "🐾 Working: Mochi (Exam) • …" pill.
   When every job ends the focused tab gets Mochi back, who naps after 35 s of
   stillness and wakes the moment he is clicked or a quiz/harvest starts.

   SUMMON SQUAD ("Squad hangout" below): while idle, triple-click the cat (or
   click the little "Squad (1/3)" hover badge) to spawn all three pixel cats on
   this tab. They trot along the bottom edge and trade personality lines until
   a task starts, the cat hides, or the hangout is toggled off.

   States (all drawn by the pixel engine):
     idle       roams the bottom/side edges every 5–7 s (tail wag, blink, ear
                twitch), random cat quotes every 6–8 s (petting lines on click)
     walk       4-frame trot while gliding somewhere; flips scaleX(-1) when
                moving left
     nap        curls into a ball with rising pixel Zzz after 35 s of stillness
     thinking   "Reading the question... 👀" → "Hmm... let me think 🤔"
                (paw on chin + floating ... / ?)
     answering  "AHA!! Found it! ✨" (~0.8 s happy hop, pixel ! + sparkles)
     clicking   paw-slap onto the exact radio dot / checkbox, then a hop to the
                Next page button (input[name="next"])
     nextpage   "Next page!! 🐾➡️" (1.1 s) paw-slap on the blue button
     typing     tiny pixel laptop with alternating paw-tapping frames
     harvesting pickaxe swinging with flying pixel star particles while the HUD
                streams harvest progress → "Scooped X answers!! 🐟✨"
     review     pixel reading glasses slide onto the eyes (white lens glint); the
                cat glides down the .que blocks of /mod/quiz/review.php while
                content.js scans, showing "Scanned! Saved X answers (Y new) •
                GitHub ✓" in the bubble

   Interaction (all cosmetic — none of it can reach quiz logic):
     click          playful petting line from PET_LINES (shuffle-no-repeat)
     double-click   1.8 s answering cheer from HYPE_LINES → back to the state
     mouseenter     occasional curious hint from HOVER_LINES (12 s cooldown)
     low timer      on /attempt.php, ≤5 min left → review pose + "HALA!! ..." alarm
     review score   .quizreviewsummary ≥90% / ≥75% / <75% celebration lines

   LOCAL CAT BRAIN CORE ("Local Cat Brain Core" below) — zero API keys, zero
   network. Passive sensors only (the clipboard is never read, keystrokes are
   counted, never captured):
     page identity  hostname + cleaned document.title + course code (/[A-Z]{2,4}\d{4}/)
     typing bursts  keydown count per burst → "12 keys in a burst! Essay mode??"
     copy / cut     "I saw you copy that!! Saving braincells? 👀📋"
     cursor         throttled mousemove → pupils follow the pointer, a fast flick
                    plays the whisker-wiggle dizzy wobble
     scroll         px/s velocity → "WHOA slow down scrolling!! 🎢🙀"
     memory         CAT_BRAIN_MEMORY in chrome.storage.local (tabHopsToday,
                    petCount, copyCount, keyCount, bankCount, day)
   composeCatThought() fills template pools with that live context (late-night
   00:00–04:59 lines, YouTube / Messenger / GitHub / AI-tab commentary, bank size,
   pet and tab-hop counters) and never repeats a recent line.

   SWITCH: popup.js writes BOT_ENABLED to chrome.storage.local (mirrored to
   .sync). `false` hides the cat and the busy pill on every open tab instantly
   and stops him claiming ownership; `true` restores him where he belongs.
   No reload, ever.

   ───────────────────────────────────────────────────────────────────────────── */
try {
  (function () {
    'use strict';

    /* ── Ids, assets, speech, timings ─────────────────────────────────────── */

    const WRAP_ID = 'qb-mascot-wrap';
    const IMG_CLASS = 'qb-mascot-img';
    const BUBBLE_ID = 'qb-mascot-bubble';
    const STYLE_ID = 'qb-mascot-style';
    const PILL_ID = 'qb-mascot-pill';
    const HUD_HOST_ID = 'moodle-quiz-bot-hud';
    const SQUAD_CAT_CLASS = 'qb-squad-cat';
    const SQUAD_CANVAS_CLASS = 'qb-squad-canvas';
    const SQUAD_BUBBLE_CLASS = 'qb-squad-bubble';
    const SQUAD_BADGE_CLASS = 'qb-squad-badge';
    const SQUAD_BADGE_HIDDEN = 'qb-squad-badge-hidden';

    const SIZE = 130;        // px — square cat
    const BUBBLE_MAX = 175;  // px — widest the speech bubble can render
    const EDGE = 16;         // px — viewport margin (left / top / bottom)
    const RIGHT_GUARD = 24;  // px — extra room reserved on the right edge
    const GAP = 10;          // px — gap when parking beside a Moodle element
    // Right-edge footprint: the bubble (175 px, right-aligned to the wrap) is
    // wider than the 130 px cat, so the wider of the two drives the clamp.
    const MASCOT_WIDTH = Math.max(SIZE, BUBBLE_MAX);

    // Every state the pixel engine can draw. `walk` and `nap` are rendered from
    // idle/catnap flags rather than set through setState(), but they still live
    // here so the external `qb-mascot-state` hook can play them.
    const STATES = [
      'idle', 'walk', 'nap', 'thinking', 'answering',
      'clicking', 'nextpage', 'typing', 'harvesting', 'review',
    ];

    function isKnownState(state) {
      return STATES.indexOf(String(state || '')) >= 0;
    }

    // The two "action" animations replay the exact move the bot just made:
    // slapping a radio/checkbox/dropdown option, or typing into a text box.
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

    // Catnap + global-presence dialogs. A napping cat mumbles NAP_LINES, wakes
    // with WAKE_LINE, and the idle cat greets the tab it just followed with
    // FOLLOW_LINES (all drawn through pickFreshLine, so nothing repeats).
    const NAP_LINES = [
      'Zzz... taking a quick catnap 💤🐾',
      'Dreaming of 100% exam scores... 🐟💤',
      'Wake me up when the next quiz starts~ 😴',
    ];

    const WAKE_LINE = 'Yawn~ Ready to work!! 🐾✨';

    const FOLLOW_LINES = [
      'Meow! Followed you over here~ 🐾',
      'Done working! What are we doing on this tab? 👀',
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

    /* ── The 3-Cat Squad roster ───────────────────────────────────────────── */

    // Three specialists share the global squad. `palette` overrides the base
    // pixel palette (P) and `lines` feeds every bubble the cat speaks, so each
    // one has a distinct colour scheme, pixel accessory and voice.
    //   Mochi — warm orange tabby + red pixel bandana — hyper speedrunner
    //   Luna  — black & white tuxedo + dark pixel shades — deadpan genius
    //   Boba  — cream calico + tiny green sprout — sleepy loot goblin
    const CATS = {
      mochi: {
        id: 'mochi',
        name: 'Mochi',
        role: 'Hyper Speedrunner',
        fur: 'Orange Tabby',
        palette: {
          fur: '#f5a15c',
          furDark: '#d67b36',
          white: '#fff4e6',
          pink: '#ff9fb2',
          nose: '#e2688a',
          eye: '#3ddc84',
          pupil: '#1b2430',
        },
        lines: {
          idle: [
            'SPEEDRUN MODE ACTIVATED!! 🔥🐾',
            'Ez clap next question!! ⚡',
            'No warm-up, straight to 1.00 🏁',
            'Click Run, I already stretched my paws 🔥',
            'Faster than the page loads, purr ⚡',
            'Next question? Born ready 🐾💨',
            'Kaya natin \'to, speedrun na!! 🔥🎓',
          ],
          thinking: [
            'Reading at 2x speed... 👀⚡',
            'Scanning, no time to blink!! 🔍🔥',
            'Locking in, brain at max RPM 🧠💨',
          ],
          clicking: [
            'BOOP! Next!! ⚡🐾',
            'Tapped it before it loaded 😼💥',
            'Speed click, no hesitation!! 🔥',
          ],
          typing: [
            'FURIOUS TYPING NOISES ⌨️🔥',
            'Typing at 120 WPM, paws only ⌨️💨',
          ],
          pet: [
            'Pet me later, we are speedrunning!! 🔥😾',
            'One quick purr, then BACK TO WORK ⚡',
            'Pet = +10 speed. Confirmed. 🐾🔥',
          ],
          hype: [
            'LET\'S GOOOO!! 🔥🐾',
            'UNSTOPPABLE!! ✨⚡',
            'SPEEDRUN THE WHOLE QUIZ!! 🏁🔥',
          ],
          harvest: [
            'Digging at full sprint!! 🐾⛏️💨',
            'Scoop scoop scoop, no stopping!! 🐟⚡',
          ],
          review: [
            'Score check, quick quick quick 👀⚡',
            'Reviewing at turbo speed 🔍🔥',
          ],
          nap: [
            'Power nap: 45 seconds. Go. 💤⚡',
            'Recharging turbo... do not wake me... 💤',
          ],
          hang: [
            'Race you to the Next button!! 🔥🐾',
            'I did 400 laps around this tab today ⚡',
            'Luna, analyze THIS!! *zooms past* 🐾💨',
            'Boba wake up, we are training!! 🔥💤',
          ],
        },
      },
      luna: {
        id: 'luna',
        name: 'Luna',
        role: 'Deadpan Genius',
        fur: 'Black & White Tuxedo',
        palette: {
          fur: '#f2f0ea',
          furDark: '#2b2d3a',
          white: '#ffffff',
          pink: '#f2b8c6',
          nose: '#e58aa5',
          eye: '#7fd4ff',
          pupil: '#10131c',
        },
        lines: {
          idle: [
            'Statistically speaking, it\'s B. 🕶️',
            'My IQ is 9999. Next. ✨',
            'I have already predicted the answer. 🕶️📈',
            'Probability of a 1.00: acceptable. ✨',
            'No rush. I am always right anyway. 🕶️',
            'Observe. Analyze. Answer. Repeat. 🧠',
          ],
          thinking: [
            'Statistically speaking... 🕶️',
            'Calculating all four options. Stand by. 📈',
            'My analysis says this is trivial. 🧠',
          ],
          clicking: [
            'Correct choice. Obviously. 🕶️✨',
            'Selected. As predicted. 📈',
            'The data agrees with me. 🕶️',
          ],
          typing: [
            'Composing a statistically optimal answer ⌨️🕶️',
            'Words. Precisely chosen. ⌨️',
          ],
          pet: [
            'Your pet has been logged. 🕶️',
            'Affection detected. ...Acknowledged. ✨',
            'I allow this. Briefly. 🕶️',
          ],
          hype: [
            'My IQ is 9999. Next. ✨',
            'I predicted this success. 🕶️✨',
            'Efficiency: impeccable. 🕶️',
          ],
          harvest: [
            'Cataloguing answers with precision 🕶️⛏️',
            'Data extraction in progress. Do not disturb. 📈',
          ],
          review: [
            'Cross-referencing every answer. 🕶️🔍',
            'The score is... as calculated. ✨',
          ],
          nap: [
            'Resting my 9999 IQ. 🕶️💤',
            'Even geniuses require REM sleep. 💤',
          ],
          hang: [
            'Statistically, I am the best cat here. 🕶️',
            'Boba, your nap schedule is inefficient. 📈',
            'Mochi, speed without accuracy is chaos. 🕶️',
            'I calculated a 97% chance you two are chaos. 🕶️📈',
          ],
        },
      },
      boba: {
        id: 'boba',
        name: 'Boba',
        role: 'Sleepy Loot Goblin',
        fur: 'Cream Calico',
        palette: {
          fur: '#f6e3bd',
          furDark: '#a9773f',
          white: '#fffaf0',
          pink: '#f7b6c2',
          nose: '#d98fa0',
          eye: '#8ee08a',
          pupil: '#1b2430',
        },
        lines: {
          idle: [
            'Ooh shiny answers!! *nom nom* 🐟⛏️',
            'Are we done yet? I need a nap... 💤',
            'I found a snack in the answer bank 🐟✨',
            'Five more minutes of harvesting, then nap 😴⛏️',
            'My loot pouch is full of answers 🎒🐟',
            'Wake me when the fish— I mean quiz— is ready 🐟💤',
          ],
          thinking: [
            'Hmm... what was the question again? 🐟💤',
            'Thinking... mostly about snacks 🍪🤔',
            'Brain loading... *yawn* 💤',
          ],
          clicking: [
            'Boop! Did I get it? 🐾🐟',
            'Click click, now snack break? 🍪',
            'Picked the shiniest option ✨🐾',
          ],
          typing: [
            'Typing... snacks... typing... 🍪⌨️',
            'My paws are sleepy but dedicated ⌨️💤',
          ],
          pet: [
            'Pet me and I will share my fish 🐟😽',
            'Purrrr... wake me at the next question 💤',
            'Snacks first, pets second 🍪🐾',
          ],
          hype: [
            'SHINY ANSWERS!! *nom nom* 🐟⛏️',
            'Loot party!! 🎒✨',
            'We did it! Snack time!! 🍪🎉',
          ],
          harvest: [
            'Ooh shiny answers!! *nom nom* 🐟⛏️',
            'Loot goblin mode: ON 🎒⛏️',
            'Digging for snacks— answers! 🐾⛏️',
          ],
          review: [
            'Checking score... then checking snacks 🍪👀',
            'Did we pass? Can I nap now? 💤',
          ],
          nap: [
            'Nap time... please do not harvest without me 💤🐟',
            'Five more minutes... 🍪💤',
          ],
          hang: [
            'Snack break? Snack break. 🍪🐾',
            'Are we done yet? I need a nap... 💤',
            'Mochi stop zooming, you spill my fish 🐟😾',
            'Luna, is napping statistically optimal? 💤🕶️',
          ],
        },
      },
    };

    const CHEER_MS = 1800;             // double-click answering cheer
    const PANIC_HOLD_MS = 3200;        // low-timer review alarm
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
    const SLAP_HOLD_MS = 1100;       // clicking pose on the exact dot → Next page hop
    const NEXT_HOP_MS = 1100;        // "Next page!!" hop beside the button → idle
    const ACTION_HOLD_MS = 2500;     // typing pose → idle (clicking uses SLAP_HOLD_MS)
    const TARGET_LIFT = 40;          // px — sit this far above the target's top edge
    const NEXT_OFFSET_X = 140;       // px — park this far left of the Next page button
    const NEXT_OFFSET_Y = 45;        // px — park this far above the Next page button
    const REVIEW_COUNT_DELAY_MS = 1800;
    const TICK_MS = 1500;            // read-only state reconciliation
    const MUTATION_DEBOUNCE_MS = 220;
    const ANSWER_THROTTLE_MS = 800;
    const HARVEST_HOLD_MS = 2000;    // harvest animation lingers 2 s after the last line
    const HARVEST_STALE_MS = 20000;  // safety: 20 s of silence → back to idle
    const CONTROL_HINT_MS = 2000;    // how long the last answer control stays "fresh"
    const REVIEW_GLIDE_MS = 1100;    // review scan: hop between .que blocks
    const REVIEW_SCAN_MAX_MS = 45000; // safety: never glide forever

    /* ── Cat Squad presence + catnap tuning ───────────────────────────────── */

    // chrome.storage.local.CAT_SQUAD holds one assignment slot per cat:
    //   { mochi: { tabId, task, url, workLockUntil, updatedAt }, luna: …, boba: … }
    // `task` is 'exam' | 'harvest' | 'review' | 'idle' | ''.
    const SQUAD_KEY = 'CAT_SQUAD';
    const SQUAD_SLOTS = ['mochi', 'luna', 'boba'];
    const SQUAD_SPECIALTY = { exam: 'mochi', harvest: 'boba', review: 'luna' };
    const SQUAD_TASK_LABEL = { exam: 'Exam', harvest: 'Harvest', review: 'Review', idle: 'Idle' };
    // Which squad job a mascot state belongs to (empty → not a squad job).
    const SQUAD_STATE_TASK = {
      thinking: 'exam',
      answering: 'exam',
      clicking: 'exam',
      typing: 'exam',
      nextpage: 'exam',
      harvesting: 'harvest',
      review: 'review',
    };
    const PRESENCE_STALE_MS = 15000;       // an assignment older than this is ignored
    const PRESENCE_HEARTBEAT_MS = 4000;    // working slots keep updatedAt fresh
    const PRESENCE_INIT_TIMEOUT_MS = 2500; // chrome never answered → single-tab mode
    const WORK_LOCK_MS = 20000;            // a quiz run / harvest stays "active" this long
    // Session-level work lock (see `_activeWorkUntil`): a quiz run and a harvest
    // keep streaming these HUD lines question after question. Between two answers
    // `syncPresenceForState('idle')` briefly publishes an idle record, so without
    // the lock a freshly focused tab would steal the cat mid-exam. Both patterns
    // are anchored at the line start: harvest lines are spelled out (a bare
    // /harvest/ would match the "…or use Harvest Page." boot banner) and a quiz
    // question such as "Q: What is a stop sign?" must never end the run.
    const WORK_START_RE = /^(?:bot started|q:|question:|option\s*\d|selected\b|matched\b|typed\b|all answered|harvest\s+"|auto-harvesting answers|scanning grade report|review harvest|answer harvesting is running)/;
    const WORK_END_RE = /^(?:bot stopped|stop(?:ped)?\b|quiz complete|review scan:|harvested)/;
    const PILL_TEXT = '🐾 Cat squad is working on another tab...';
    const WORK_PILL_TEXT = '🐾 Cat squad is busy working on another tab...';
    const PILL_CLASS = 'qb-pill-visible';
    const NAP_CLASS = 'qb-napping';
    const NAP_AFTER_MS = 35000;            // idle + no interaction for 35 s → catnap
    const NAP_TICK_MS = 3000;              // how often stillness is checked
    const NAP_QUOTE_MIN_MS = 11000;        // sleepy mumbling cadence while napping
    const NAP_QUOTE_SPREAD_MS = 4000;

    // Every state in this map means "this tab is doing a squad job" (the job name
    // comes from SQUAD_STATE_TASK and drives which specialist cat it claims).
    const BUSY_LABELS = {
      thinking: 'reading a question',
      answering: 'answering a question',
      clicking: 'clicking an answer',
      typing: 'typing an answer',
      nextpage: 'moving to the next page',
      harvesting: 'harvesting answers',
      review: 'checking the score',
    };

    function taskKindForState(state) {
      return SQUAD_STATE_TASK[String(state || '')] || '';
    }

    function preferredCatFor(task) {
      return SQUAD_SPECIALTY[task] || 'mochi';
    }


    /* ── Module state ─────────────────────────────────────────────────────── */

    let wrapEl = null;
    let catEl = null;
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

    // Visual review scanner: content.js streams "Review scan: ..." and
    // "GitHub sync: ..." HUD lines; the cat wears glasses, glides down the .que
    // blocks and shows the live counts in its bubble. It only ever narrates —
    // content.js owns the scanning, saving and syncing.
    const reviewScan = {
      active: false,
      startedAt: 0,
      right: null,
      newCount: null,
      github: '',
      timer: null,
      stopTimer: null,
      index: 0,
    };

    let overlayTimer = null;   // cheer / panic overlay restore timer
    let overlayState = '';     // '' | 'answering' | 'review'
    let timerCheck = null;     // 10 s #quiz-time-left poll
    let panicWarned = false;   // one low-timer alarm per attempt
    let lastHoverAt = 0;
    let lastPetAt = 0;
    let scoreAnnounced = false;
    let lastScoreLine = '';    // celebration line, re-shown when the cat is petted

    // Cat squad presence: which cat this tab owns, what job it is doing, and the
    // live CAT_SQUAD map shared by every tab (assignments older than 15 s stale).
    let myTabId = null;
    let squadEnabled = false;      // false → single-tab fallback (no storage/tab id)
    let squadReady = false;        // the first read finished: show/hide is safe now
    let squadWatched = false;
    let squad = normalizeSquad(null);
    let squadHeartbeat = null;
    let pillEl = null;
    let lastStaleRecoveryAt = 0;
    let myCatId = null;            // cat assigned to this tab ('' / null → none)
    let myTask = '';               // this tab's claimed job kind ('exam' | …)
    let assignedCatId = 'mochi';   // cat painted on the primary <canvas>
    let claimInFlight = false;     // a read-modify-write claim is in progress
    // Session-level work lock: `Date.now() + WORK_LOCK_MS` while a quiz run or a
    // harvest is in progress on this tab, 0 otherwise. It bridges the idle gap
    // between two questions and is mirrored into CAT_SQUAD[cat].workLockUntil so
    // the other tabs can honour it without polling this one.
    let _activeWorkUntil = 0;
    let lastWorkLockPushAt = 0;
    let sawOtherTabWorking = false;  // other cats were busy; waiting to hand back

    // BOT_ENABLED mirror (the popup switch): disabled → the cat and the busy pill
    // vanish from this tab instantly and he stops claiming ownership; enabled →
    // applyPresence puts him back wherever he belongs.
    let uiEnabled = true;
    let uiEnabledWatched = false;

    // Catnap: `napping` drives the sleepy CSS mood; `lastInteractionAt` is the
    // newest real user action (page or mascot) that keeps him awake.
    let napping = false;
    let napTickTimer = null;
    let napQuoteTimer = null;
    let lastInteractionAt = Date.now();


    const answeredKeys = new Set();
    const warned = new Set();

    /* ── Tiny, never-throwing utilities ───────────────────────────────────── */

    function warnOnce(scope, error) {
      const message = scope + ': ' + ((error && error.message) || error || 'unknown error');
      if (warned.has(message)) return;
      warned.add(message);
      try { console.warn('[Mascot] ' + message); } catch (e) { /* never throw */ }
    }

    // The canvas repaints from module state every frame; this only records the
    // logical state and forces an immediate repaint, so a new animation appears
    // without waiting for the next ~7 FPS tick.
    function applyAsset(state) {
      if (!catEl) return;
      const key = isKnownState(state) ? state : 'idle';
      catEl.dataset.state = key;
      try { paintPrimary(); } catch (error) { warnOnce('pixel-draw', error); }
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

    /* ── 2D pixel-art cat engine (pure JS, no image assets) ───────────────── */

    const GRID = 24;         // logical 24 × 24 sprite matrix
    const CANVAS = 96;       // <canvas width/height> = 4 device px per sprite px
    const FRAME_MS = 143;    // ≈ 7 FPS pixel animation

    const BASE_PALETTE = {
      outline: '#241a16',
      fur: '#f5a15c',
      furDark: '#d67b36',
      white: '#fff4e6',
      pink: '#ff9fb2',
      nose: '#e2688a',
      eye: '#3ddc84',
      pupil: '#1b2430',
      metal: '#a8bccf',
      wood: '#a9713f',
      gold: '#ffd166',
      lens: 'rgba(150, 226, 255, 0.30)',
      screen: '#123047',
      code: '#7ef0c0',
    };

    // `P` is the active palette. `applyPalette(catId)` resets it to the base and
    // then applies the cat's overrides, so every draw helper stays palette-blind
    // while Mochi / Luna / Boba each paint in their own fur colours.
    const P = { ...BASE_PALETTE };

    function applyPalette(catId) {
      const cat = CATS[catId] || CATS.mochi;
      Object.keys(BASE_PALETTE).forEach((key) => { P[key] = BASE_PALETTE[key]; });
      const overrides = (cat && cat.palette) || {};
      Object.keys(overrides).forEach((key) => { P[key] = overrides[key]; });
    }

    // ── Per-cat pixel accessories + fur patterns ────────────────────────────
    // Drawn after the face so shades actually sit on the eyes and the bandana
    // reads as a collar. All coordinates are the same 24×24 sprite matrix.

    function drawMochiAccessory(dy, tick) {
      // Orange tabby stripes on the cheeks.
      px(7, 7 + dy, P.furDark, 1, 2);
      px(16, 7 + dy, P.furDark, 1, 2);
      px(8, 6 + dy, P.furDark);
      // Tiny red bandana around the neck: red band + knot + tail.
      const wag = tick % 8 < 4 ? 0 : 1;
      px(8, 12 + dy, '#a81f2d', 8, 1);
      px(9, 13 + dy, '#e63946', 7, 1);
      px(12, 14 + dy, '#e63946', 2, 1);
      px(11, 15 + dy, '#e63946', 1, 2 + wag);
      px(14, 15 + dy, '#e63946', 1, 2 - wag);
    }

    function drawLunaAccessory(dy, tick) {
      // Tuxedo cap: dark patches on both sides of a white forehead blaze.
      px(8, 5 + dy, P.furDark, 3, 2);
      px(13, 5 + dy, P.furDark, 3, 2);
      px(11, 5 + dy, P.fur, 2, 2);
      px(8, 7 + dy, P.furDark);
      px(15, 7 + dy, P.furDark);
      // Cool dark pixel shades over both eyes (bridge + temples + glint).
      px(8, 8 + dy, '#14161f', 4, 2);
      px(12, 8 + dy, '#14161f', 4, 2);
      px(11, 8 + dy, '#4a4e63');
      px(7, 8 + dy, '#14161f');
      px(16, 8 + dy, '#14161f');
      const glint = tick % 10 < 5 ? 0 : 1;
      px(9 + glint, 8 + dy, '#9be7ff');
      px(13 + glint, 8 + dy, '#9be7ff');
      // White tuxedo chest patch.
      px(10, 14 + dy, P.white, 4, 3);
    }

    function drawBobaAccessory(dy, tick) {
      // Cream calico spots (one on the head, one on the flank).
      px(14, 5 + dy, P.furDark, 2, 2);
      px(7, 8 + dy, P.furDark, 1, 1);
      px(8, 16 + dy, P.furDark, 2, 2);
      px(16, 15 + dy, P.furDark, 1, 1);
      // Tiny green sprout between the ears (stem + two leaves).
      const sway = tick % 12 < 6 ? 0 : 1;
      px(12, 2 + dy, '#3f8a3a', 1, 3);
      px(11 + sway, 1 + dy, '#6ec46a', 1, 1);
      px(13 - sway, 1 + dy, '#8ddd74', 1, 1);
      px(10 + sway, 2 + dy, '#8ddd74');
      px(14 - sway, 2 + dy, '#6ec46a');
    }

    function drawAccessory(catId, state, tick, dy) {
      if (state === 'nap') return; // sleeping ball pose: accessories would float
      if (catId === 'luna') drawLunaAccessory(dy, tick);
      else if (catId === 'boba') drawBobaAccessory(dy, tick);
      else drawMochiAccessory(dy, tick);
    }

    let ctx = null;
    let primaryCtx = null;
    let frameTick = 0;
    let frameTimer = null;
    let walkUntil = 0;       // idle + still gliding → play the trot cycle

    function paintPrimary() {
      if (!primaryCtx || !catEl) return;
      ctx = primaryCtx;
      applyPalette(assignedCatId);
      drawCatFrame(renderState(), frameTick, assignedCatId);
    }

    function px(x, y, color, w, h) {
      if (!ctx) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w == null ? 1 : w, h == null ? 1 : h);
    }

    function clearSprite() {
      if (ctx) ctx.clearRect(0, 0, GRID, GRID);
    }

    // One blob = stacked rows: each row's edge pixels become the outline and the
    // inside stays fur, so silhouettes read as rounded pixel art at 24 px.
    function drawBlob(rows, dy, fill, outline) {
      const edge = outline || P.outline;
      const lift = dy || 0;
      for (let i = 0; i < rows.length; i += 1) {
        px(rows[i].x, rows[i].y + lift, edge, rows[i].w, 1);
      }
      for (let i = 1; i < rows.length - 1; i += 1) {
        if (rows[i].w > 2) px(rows[i].x + 1, rows[i].y + lift, fill, rows[i].w - 2, 1);
      }
    }

    const BODY_ROWS = [
      { y: 13, x: 9, w: 6 },
      { y: 14, x: 8, w: 8 },
      { y: 15, x: 7, w: 10 },
      { y: 16, x: 7, w: 10 },
      { y: 17, x: 7, w: 10 },
      { y: 18, x: 7, w: 10 },
      { y: 19, x: 7, w: 10 },
      { y: 20, x: 8, w: 8 },
      { y: 21, x: 9, w: 6 },
    ];

    const HEAD_ROWS = [
      { y: 5, x: 8, w: 8 },
      { y: 6, x: 7, w: 10 },
      { y: 7, x: 6, w: 12 },
      { y: 8, x: 6, w: 12 },
      { y: 9, x: 6, w: 12 },
      { y: 10, x: 6, w: 12 },
      { y: 11, x: 6, w: 12 },
      { y: 12, x: 7, w: 10 },
      { y: 13, x: 8, w: 8 },
    ];

    // Four tail poses: the wag cycle of the idle / walk loop.
    const TAIL_PHASES = [
      [[17, 18], [18, 17], [19, 16], [20, 15], [21, 14], [21, 13]],
      [[17, 18], [18, 18], [19, 17], [20, 17], [21, 16], [22, 16]],
      [[17, 19], [18, 19], [19, 18], [20, 18], [21, 18], [21, 17]],
      [[17, 18], [18, 17], [19, 17], [20, 16], [21, 15], [22, 15]],
    ];

    function drawTail(phase, dy) {
      const tail = TAIL_PHASES[phase % TAIL_PHASES.length];
      for (let i = 0; i < tail.length; i += 1) px(tail[i][0], tail[i][1] + dy, P.outline, 2, 2);
      for (let i = 0; i < tail.length; i += 1) px(tail[i][0], tail[i][1] + dy, P.fur, 1, 1);
      const tip = tail[tail.length - 1];
      px(tip[0] + 1, tip[1] + dy, P.furDark);
    }

    function drawEars(dy, twitch) {
      const lift = twitch ? -1 : 0;
      px(7, 2 + dy + lift, P.outline, 2, 1);
      px(6, 3 + dy + lift, P.outline, 4, 1);
      px(6, 4 + dy, P.outline, 4, 1);
      px(7, 3 + dy + lift, P.pink);
      px(7, 4 + dy, P.pink, 2, 1);
      px(15, 2 + dy + lift, P.outline, 2, 1);
      px(14, 3 + dy + lift, P.outline, 4, 1);
      px(14, 4 + dy, P.outline, 4, 1);
      px(16, 3 + dy + lift, P.pink);
      px(15, 4 + dy, P.pink, 2, 1);
    }

    // Eyes / muzzle / whiskers. `happy` → closed ^ ^ eyes, `focus` → looking down
    // (reading glasses), `blink` → flat lines, `look` → pupils track the cursor
    // (−1 left, 0 centre, +1 right) fed by the local brain's mousemove sensor.
    function drawFace(dy, opts) {
      const o = opts || {};
      px(9, 6 + dy, P.furDark, 2, 1);
      px(14, 6 + dy, P.furDark, 1, 1);
      px(10, 10 + dy, P.white, 4, 3);
      px(11, 10 + dy, P.nose, 2, 1);
      px(11, 11 + dy, P.outline, 2, 1);
      px(4, 10 + dy, P.white, 2, 1);
      px(18, 10 + dy, P.white, 2, 1);
      px(5, 11 + dy, P.white, 1, 1);
      px(19, 11 + dy, P.white, 1, 1);
      if (o.happy) {
        px(9, 9 + dy, P.outline, 2, 1);
        px(9, 8 + dy, P.outline, 1, 1);
        px(13, 9 + dy, P.outline, 2, 1);
        px(14, 8 + dy, P.outline, 1, 1);
      } else if (o.blink) {
        px(9, 9 + dy, P.outline, 2, 1);
        px(13, 9 + dy, P.outline, 2, 1);
      } else {
        const look = o.look || 0;
        px(9, 8 + dy, P.eye, 2, 2);
        px(13, 8 + dy, P.eye, 2, 2);
        const pupilRow = 8 + dy + (o.focus ? 1 : 0);
        // Pupil slides inside the 2 px eye; the highlight takes the freed pixel.
        px(look > 0 ? 10 : 9, pupilRow, P.pupil);
        px(look < 0 ? 13 : 14, pupilRow, P.pupil);
        px(look > 0 ? 9 : 10, 8 + dy, P.white);
        px(look < 0 ? 14 : 13, 8 + dy, P.white);
      }
    }

    function drawPaws(dy, walking, step) {
      const leftLift = walking && step % 2 === 0 ? 1 : 0;
      const rightLift = walking && step % 2 === 1 ? 1 : 0;
      px(8, 19 + dy - leftLift, P.outline, 4, 3);
      px(9, 20 + dy - leftLift, P.white, 2, 1);
      px(13, 19 + dy - rightLift, P.outline, 4, 3);
      px(14, 20 + dy - rightLift, P.white, 2, 1);
    }

    function drawSparkle(x, y, color, big) {
      px(x, y, color);
      px(x - 1, y + 1, color);
      px(x + 1, y + 1, color);
      px(x, y + 2, color);
      if (big) { px(x, y - 1, color); px(x, y + 3, color); }
    }

    // Tiny pixel "Z": top bar, diagonal, bottom bar.
    function drawZ(x, y, size, color) {
      px(x, y, color, size, 1);
      for (let i = 1; i < size - 1; i += 1) px(x + size - 1 - i, y + i, color);
      px(x, y + size - 1, color, size, 1);
    }

    // Catnap: a curled ball with a resting head, folded ears and rising Zzz.
    function drawNap(tick) {
      drawBlob([
        { y: 16, x: 7, w: 11 },
        { y: 17, x: 6, w: 13 },
        { y: 18, x: 5, w: 15 },
        { y: 19, x: 5, w: 15 },
        { y: 20, x: 6, w: 13 },
        { y: 21, x: 7, w: 11 },
      ], 0, P.fur);
      drawBlob([
        { y: 12, x: 8, w: 9 },
        { y: 13, x: 7, w: 11 },
        { y: 14, x: 7, w: 11 },
        { y: 15, x: 8, w: 9 },
      ], 0, P.fur);
      // folded ears + closed eyes + nose
      px(7, 11, P.outline, 2, 1);
      px(8, 11, P.pink);
      px(16, 11, P.outline, 2, 1);
      px(16, 11, P.pink);
      px(9, 14, P.outline, 2, 1);
      px(14, 14, P.outline, 2, 1);
      px(12, 15, P.nose, 2, 1);
      // tail wrapped around the front of the ball
      px(5, 19, P.outline, 3, 2);
      px(5, 19, P.fur, 2, 1);
      px(17, 19, P.outline, 3, 2);
      px(18, 19, P.fur, 2, 1);
      // Zzz drifting up, two sizes
      const rise = tick % 3;
      drawZ(17, 10 - rise, 3, P.white);
      drawZ(20, 6 - rise, 2, P.gold);
    }

    function drawBody(dy, walking) {
      drawBlob(BODY_ROWS, dy, P.fur);
      // chest fluff + side stripes
      px(11, 15 + dy, P.white, 2, 3);
      px(8, 16 + dy, P.furDark, 1, 2);
      px(15, 16 + dy, P.furDark, 1, 2);
      if (walking) px(9, 21 + dy, P.furDark, 2, 1);
    }

    // Paw on chin + floating "..." (and a "?" every other beat).
    function drawThinking(tick, dy) {
      px(12, 12 + dy, P.outline, 4, 3);
      px(13, 13 + dy, P.white, 2, 1);
      const phase = Math.floor(tick / 2) % 4;
      for (let i = 0; i < 3; i += 1) {
        px(18 + i * 2, 6 + dy - (phase === i ? 1 : 0), i <= phase ? P.gold : P.white);
      }
      if (Math.floor(tick / 12) % 2 === 0) {
        px(19, 2 + dy, P.gold, 3, 1);
        px(21, 3 + dy, P.gold);
        px(20, 4 + dy, P.gold);
        px(20, 6 + dy, P.gold);
      }
    }

    // "AHA!!": hop + pixel "!" + a sparkle burst.
    function drawExcited(tick, dy) {
      px(19, 1 + dy, P.gold, 2, 4);
      px(19, 6 + dy, P.gold, 2, 2);
      const on = tick % 2 === 0;
      drawSparkle(4, 6 + dy + (on ? 0 : 1), P.white);
      drawSparkle(21, 12 + dy + (on ? 1 : 0), P.gold);
      drawSparkle(6, 16 + dy + (on ? 1 : 0), P.gold);
    }

    // Paw-slap onto the exact radio dot (clicking) or the Next page button.
    function drawSlap(tick, dy, nextPage) {
      const hit = tick % 2 === 0;
      const dotX = nextPage ? 18 : 17;
      const dotY = nextPage ? 16 : 18;
      px(13, dotY - 3 + dy + (hit ? 1 : 0), P.outline, 4, 3);
      px(14, dotY - 2 + dy + (hit ? 1 : 0), P.white, 2, 1);
      px(dotX, dotY + dy, P.outline, 5, 4);
      px(dotX + 1, dotY + 1 + dy, nextPage ? P.eye : P.gold, 3, 2);
      if (hit) drawSparkle(dotX + 2, dotY - 2 + dy, P.white, true);
    }

    // Tiny laptop: screen in front of the chest, paws tapping the keys.
    function drawLaptop(tick, dy) {
      const tap = tick % 2 === 0;
      px(5, 13 + dy, P.outline, 14, 6);
      px(6, 14 + dy, P.screen, 12, 4);
      px(7, 15 + dy, P.code, 5, 1);
      px(7, 16 + dy, P.code, 8, 1);
      px(4, 19 + dy, P.outline, 16, 3);
      px(5, 20 + dy, P.metal, 14, 1);
      px(7, 20 + dy - (tap ? 0 : 1), P.white, 3, 2);
      px(14, 20 + dy - (tap ? 1 : 0), P.white, 3, 2);
    }

    // Pickaxe swinging + flying pixel star particles.
    function drawPickaxe(tick, dy) {
      const phases = [
        { ex: 20, ey: 9, hx: 20, hy: 8 },
        { ex: 18, ey: 11, hx: 18, hy: 10 },
        { ex: 15, ey: 13, hx: 14, hy: 12 },
      ];
      const phase = phases[Math.floor(tick / 3) % phases.length];
      const steps = 6;
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        px(Math.round(16 + (phase.ex - 16) * t), Math.round(18 + (phase.ey - 18) * t) + dy, P.wood);
      }
      px(phase.hx, phase.hy + dy, P.metal, 3, 2);
      px(15, 17 + dy, P.white, 2, 1); // paw holding the handle
      if (tick % 2 === 0) {
        drawSparkle(phase.hx + 3, phase.hy + dy + 1, P.white);
        drawSparkle(4, 8 + (tick % 4), P.gold);
      } else {
        drawSparkle(phase.hx - 2, phase.hy + dy + 2, P.gold);
      }
    }

    // Reading glasses over the eyes: they drop onto the muzzle over ~350 ms, then
    // a white glint sweeps across both lenses while the scan runs.
    function drawGlasses(tick) {
      let drop = 0;
      const startedAt = reviewScan.active ? reviewScan.startedAt : reviewStartedAt;
      if (startedAt) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= 0 && elapsed < 350) drop = -4 + Math.round((elapsed / 350) * 4);
      }
      const top = 7 + drop;
      // left lens x8..11, right lens x12..15 (the eyes sit inside them)
      px(8, top - 1, P.outline, 4, 1);
      px(12, top - 1, P.outline, 4, 1);
      px(8, top + 4, P.outline, 4, 1);
      px(12, top + 4, P.outline, 4, 1);
      px(8, top, P.outline, 1, 4);
      px(11, top, P.outline, 1, 4);
      px(12, top, P.outline, 1, 4);
      px(15, top, P.outline, 1, 4);
      px(9, top, P.lens, 2, 4);
      px(13, top, P.lens, 2, 4);
      // temples resting on the cheeks
      px(7, top + 1, P.outline);
      px(16, top + 1, P.outline);
      // white lens glint sweeping left → right
      const glint = Math.floor(tick / 2) % 4;
      px(9, top + glint, P.white);
      px(13, top + glint, P.white);
      // scanning sparkle above the frames
      if (reviewScan.active && tick % 4 < 2) drawSparkle(18, top - 2, P.gold);
    }

    // Which animation actually paints: catnap wins, then a temporary overlay
    // (double-click cheer / low-timer panic), then the trot while gliding.
    function renderState() {
      if (napping) return 'nap';
      if (overlayState && isKnownState(overlayState)) return overlayState;
      if (currentState === 'idle' && Date.now() < walkUntil) return 'walk';
      return isKnownState(currentState) ? currentState : 'idle';
    }

    function drawCatFrame(state, tick, catKey) {
      if (!ctx) return;
      clearSprite();
      if (state === 'nap') { drawNap(tick); return; }
      const catId = CATS[catKey] ? catKey : assignedCatId;

      const walking = state === 'walk';
      const step = Math.floor(tick / 2) % 4;
      const bob = walking && step % 2 === 1 ? -1 : 0;
      const hop = state === 'answering' ? (tick % 2 === 0 ? -2 : -1) : 0;
      const dy = bob + hop;
      const blink = state !== 'answering' && state !== 'review' && tick % 26 === 13;
      const twitch = tick % 22 === 4;
      const tailPhase = state === 'harvesting' ? tick : Math.floor(tick / 3);

      drawTail(tailPhase, dy);
      drawBody(dy, walking);
      drawEars(dy, twitch);
      drawBlob(HEAD_ROWS, dy, P.fur);
      drawFace(dy, {
        blink,
        happy: state === 'answering' && tick % 2 === 0,
        focus: state === 'review',
        look: state === 'review' ? 0 : gazeLook, // reading glasses stare at the paper
      });
      if (state !== 'typing' && state !== 'harvesting') drawPaws(dy, walking, step);
      drawAccessory(catId, state, tick, dy);

      if (state === 'thinking') drawThinking(tick, dy);
      else if (state === 'answering') drawExcited(tick, dy);
      else if (state === 'clicking' || state === 'nextpage') drawSlap(tick, dy, state === 'nextpage');
      else if (state === 'typing') drawLaptop(tick, dy);
      else if (state === 'harvesting') drawPickaxe(tick, dy);
      else if (state === 'review' && catId !== 'luna') drawGlasses(tick); // Luna keeps her shades
    }

    // Boot the ~7 FPS pixel loop. Hidden/unfocused tabs skip the repaint (the cat
    // is either hidden there or the user cannot see him), so an idle background
    // tab costs nothing. The same loop paints the Summon Squad canvases.
    function startPixelEngine() {
      if (!catEl) return;
      try {
        primaryCtx = catEl.getContext('2d');
        if (primaryCtx) {
          primaryCtx.imageSmoothingEnabled = false;
          primaryCtx.setTransform(CANVAS / GRID, 0, 0, CANVAS / GRID, 0, 0);
        }
      } catch (error) {
        primaryCtx = null;
        warnOnce('pixel-context', error);
      }
      if (!primaryCtx) return; // no canvas support: the wrapper simply stays empty
      if (frameTimer) clearInterval(frameTimer);
      frameTimer = setInterval(() => {
        try {
          if (wrapEl && wrapEl.style.display === 'none') return;
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          frameTick += 1;
          paintPrimary();
          advanceHangoutCats();
          drawHangoutCats(frameTick);
        } catch (error) {
          warnOnce('pixel-frame', error);
        }
      }, FRAME_MS);
      frameTick = 0;
      paintPrimary();
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
/* The pixel canvas: 96×96 rendered at ${SIZE}px with nearest-neighbour scaling,
   so every sprite pixel stays a crisp square. The drop-shadow follows the cat's
   silhouette instead of the element box (the canvas itself is transparent). */
.${IMG_CLASS} {
  display: block;
  width: ${SIZE}px;
  height: ${SIZE}px;
  image-rendering: crisp-edges;
  image-rendering: pixelated;
  border: 0;
  background: transparent;
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.38));
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  transform: scaleX(1);
  transform-origin: 50% 50%;
  transition: transform 0.35s ease, filter 0.25s ease;
}
.${IMG_CLASS}.qb-facing-left { transform: scaleX(-1); }
.${IMG_CLASS}:active { cursor: grabbing; }
.${IMG_CLASS}.qb-hop { animation: qbMascotHop 0.45s ease-out; }
.${IMG_CLASS}.qb-review { animation: qbMascotGlow 2s ease-in-out infinite; }
/* Local brain: fast cursor flick → whisker-wiggle dizzy wobble. */
.${IMG_CLASS}.qb-dizzy { animation: qbMascotDizzy 0.3s ease-in-out 4; }
@keyframes qbMascotDizzy {
  0%   { rotate: 0deg; translate: 0 0; }
  25%  { rotate: -7deg; translate: -2px 1px; }
  50%  { rotate: 0deg; translate: 0 -2px; }
  75%  { rotate: 7deg; translate: 2px 1px; }
  100% { rotate: 0deg; translate: 0 0; }
}
@keyframes qbMascotHop {
  0%   { translate: 0 0; }
  45%  { translate: 0 -10px; }
  100% { translate: 0 0; }
}
@keyframes qbMascotGlow {
  0%, 100% { filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.38)); }
  50%      { filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.38)) drop-shadow(0 0 9px rgba(255, 209, 102, 0.95)); }
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

/* Catnap: dimmed + slow breathing. Still draggable and clickable. */
#${WRAP_ID}.qb-napping { opacity: 0.92; }
#${WRAP_ID}.qb-napping .${IMG_CLASS} {
  animation: qbMascotBreathe 4.6s ease-in-out infinite;
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.3));
}
@keyframes qbMascotBreathe {
  0%, 100% { scale: 1 1; }
  50%      { scale: 1.035 1.035; }
}

/* The one cat lives on a single tab; every other tab gets this status pill
   instead (HUD palette, so it reads as part of the bot's chrome). */
#${PILL_ID} {
  position: fixed;
  left: 20px;
  bottom: 20px;
  z-index: 2147483646;
  max-width: min(460px, calc(100vw - 40px));
  box-sizing: border-box;
  padding: 9px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, #1e2a47 0%, #0f3460 100%);
  border: 1px solid rgba(255, 179, 71, 0.45);
  color: #ffd166;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.25s ease, visibility 0.25s ease;
}
#${PILL_ID}.${PILL_CLASS} { opacity: 1; visibility: visible; }

/* ── Summon Squad: hover badge + the two extra trotting cats ───────────── */

#${WRAP_ID} .${SQUAD_BADGE_CLASS} {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  box-sizing: border-box;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(15, 52, 96, 0.94);
  border: 1px solid rgba(255, 179, 71, 0.55);
  color: #ffd166;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.3;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
  user-select: none;
  -webkit-user-select: none;
}
#${WRAP_ID}:hover .${SQUAD_BADGE_CLASS} { opacity: 1; pointer-events: auto; }
#${WRAP_ID} .${SQUAD_BADGE_CLASS}.${SQUAD_BADGE_HIDDEN} { display: none; }
#${WRAP_ID} .${SQUAD_BADGE_CLASS}:hover { background: #0f3460; }

.${SQUAD_CAT_CLASS} {
  position: fixed;
  left: 0;
  top: 0;
  width: 96px;
  height: 96px;
  z-index: 2147483646;
  pointer-events: none;
  transition:
    left 0.9s cubic-bezier(0.22, 1, 0.36, 1),
    top 0.9s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: left, top;
}
.${SQUAD_CANVAS_CLASS} {
  display: block;
  width: 96px;
  height: 96px;
  image-rendering: crisp-edges;
  image-rendering: pixelated;
  border: 0;
  background: transparent;
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.34));
  transform: scaleX(1);
  transform-origin: 50% 50%;
  transition: transform 0.3s ease;
}
.${SQUAD_CANVAS_CLASS}.qb-facing-left { transform: scaleX(-1); }
.${SQUAD_BUBBLE_CLASS} {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  max-width: 150px;
  box-sizing: border-box;
  white-space: normal;
  overflow-wrap: break-word;
  padding: 6px 10px;
  border-radius: 14px 14px 4px 14px;
  background: linear-gradient(135deg, #1e2a47 0%, #0f3460 100%);
  border: 1px solid rgba(255, 179, 71, 0.45);
  color: #ffe9b8;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 11px;
  line-height: 1.35;
  text-align: left;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}
.${SQUAD_BUBBLE_CLASS}.qb-bubble-visible { opacity: 1; visibility: visible; }
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
    // While idle, the pixel engine plays the 4-frame trot for the duration of
    // the glide, so roaming reads as walking instead of sliding.
    function moveTo(x, y) {
      if (!wrapEl) return;
      const spot = safeSpot(x, y);
      const dx = spot.left - pos.left;
      if (Math.abs(dx) > 6) {
        facing = dx < 0 ? 'left' : 'right';
        if (catEl) catEl.classList.toggle('qb-facing-left', facing === 'left');
      }
      if (currentState === 'idle' && !napping) {
        const distance = Math.abs(dx) + Math.abs(spot.top - pos.top);
        walkUntil = Date.now() + Math.min(1400, 450 + distance * 2);
      }
      applyPosition(spot.left, spot.top);
    }

    // Force the un-mirrored pose (scaleX(1)): the Next page hop always keeps the
    // paw pointing right at the blue button, whatever way the cat last walked.
    function faceRight() {
      facing = 'right';
      if (catEl) catEl.classList.remove('qb-facing-left');
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

    // Idle chatter: the local brain composes from live context (title, course,
    // time, bank size, tab hops…) and falls back to the active cat's own voice.
    function randomQuote() {
      if (hangout.active) return pickCatLine(assignedCatId, 'hang') || pickFreshLine(HANG_LINES);
      return composeCatThought('idle') || pickCatLine(assignedCatId, 'idle') || pickFreshLine(IDLE_QUOTES);
    }

    // Temporary animation overlay (double-click cheer, low-timer panic): play
    // `state`'s animation for `ms` with `line` in the bubble, then restore
    // whatever the real state machine currently wants. currentState never moves,
    // so quiz logic and the reconciliation loop are untouched by it.
    function startOverlay(state, ms, line) {
      if (!catEl || !bubbleEl) return;
      if (!isKnownState(state)) return;
      if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
      overlayState = state;
      if (catEl.dataset.state !== state) {
        applyAsset(state);
      }
      catEl.classList.remove('qb-hop', 'qb-review');
      void catEl.offsetWidth; // restart the hop animation
      catEl.classList.add('qb-hop');
      if (line) setBubble(line, true);
      overlayTimer = setTimeout(restoreAfterOverlay, ms);
    }

    function restoreAfterOverlay() {
      overlayTimer = null;
      overlayState = '';
      if (!catEl) return;
      const real = isKnownState(currentState) ? currentState : 'idle';
      if (catEl.dataset.state !== real) {
        applyAsset(real);
      }
      if (real === 'review') catEl.classList.add('qb-review');
      else catEl.classList.remove('qb-review');
    }

    /* ── Cat squad presence: three cats shared by every tab ───────────────── */

    // Cosmetic coordination only: nothing here can click, submit or block page
    // code. Every tab reads and writes the same map:
    //
    //   chrome.storage.local.CAT_SQUAD = {
    //     mochi: { tabId, task, url, workLockUntil, updatedAt },
    //     luna:  { … },
    //     boba:  { … },
    //   }
    //
    // Rule A (specialist claim): a tab entering a working state claims the free
    // cat for its job — exam → Mochi, review → Luna, harvest → Boba — falling
    // back to any free slot. A second tab starting another job claims one of the
    // remaining cats, so up to three tabs work in parallel with their own cat.
    // The claim refreshes `updatedAt` every PRESENCE_HEARTBEAT_MS, so a
    // closed/crashed tab frees its cat after PRESENCE_STALE_MS.
    //
    // Rule A+ (session work lock): a quiz run and a harvest dip back to idle
    // between two questions, so `workLockUntil` keeps that cat reserved on the
    // working tab (shown as "Working") through the gaps; no other tab may steal
    // it while the deadline is in the future.
    //
    // Rule B (follow the active tab): when no cat is working, Mochi belongs to
    // the tab the user is looking at. Ownership changes only on real user
    // signals — a tab switch, focusing another window, a page load, or another
    // tab handing him over — so the 1.5 s reconciler can never trade cats back
    // and forth. Tabs with no cat hide the workers and show a live squad pill:
    //   🐾 Working: Mochi (Exam) • Boba (Harvest)

    function pageUrl() {
      try { return String(location.href || '').slice(0, 500); } catch (error) { return ''; }
    }

    function normalizeSlot(raw) {
      const value = raw && typeof raw === 'object' ? raw : {};
      const tabId = value.tabId;
      return {
        tabId: typeof tabId === 'number' && Number.isFinite(tabId) ? tabId : null,
        task: typeof value.task === 'string' ? value.task : '',
        url: typeof value.url === 'string' ? value.url : '',
        workLockUntil: Number(value.workLockUntil) || 0,
        updatedAt: Number(value.updatedAt) || 0,
      };
    }

    function normalizeSquad(raw) {
      const value = raw && typeof raw === 'object' ? raw : {};
      const next = {};
      SQUAD_SLOTS.forEach((id) => { next[id] = normalizeSlot(value[id]); });
      return next;
    }

    // An assignment is only honoured for PRESENCE_STALE_MS; a working cat keeps
    // touching updatedAt via the heartbeat, so silence means "that tab went away".
    function slotIsFresh(slot) {
      return !!slot && slot.updatedAt > 0 && (Date.now() - slot.updatedAt) < PRESENCE_STALE_MS;
    }

    // A slot is "working" when it holds a real job and is either fresh (heartbeat
    // alive) or inside its session work lock (between two questions of a run).
    function slotIsWorking(slot) {
      if (!slot || !slot.task || slot.task === 'idle') return false;
      if (slotIsFresh(slot)) return true;
      return slot.workLockUntil > 0 && Date.now() < slot.workLockUntil;
    }

    function workingSlots() {
      const list = [];
      SQUAD_SLOTS.forEach((id) => { if (slotIsWorking(squad[id])) list.push(id); });
      return list;
    }

    // Another tab holds a live session work lock: a quiz run or a harvest is in
    // progress there even if the cat is between two questions right now.
    function otherTabWorkLocked() {
      if (myTabId == null) return false;
      return SQUAD_SLOTS.some((id) => {
        const slot = squad[id];
        return slot.tabId != null && slot.tabId !== myTabId && slot.workLockUntil > 0 && Date.now() < slot.workLockUntil;
      });
    }

    // True while another tab must keep its cat: a fresh working claim (Rule A) or
    // a live work lock (Rule A+). The owner never blocks itself.
    function otherTabIsBusy() {
      if (!squadEnabled || myTabId == null) return false;
      const busy = SQUAD_SLOTS.some((id) => {
        const slot = squad[id];
        return slot.tabId != null && slot.tabId !== myTabId && slotIsWorking(slot);
      });
      return busy || otherTabWorkLocked();
    }

    function slotTaskLabel(slot) {
      if (!slot || !slot.task || slot.task === 'idle') return 'Working';
      return SQUAD_TASK_LABEL[slot.task] || 'Working';
    }

    // "🐾 Working: Mochi (Exam) • Boba (Harvest)" — the live squad pill shown on
    // every tab that has no cat of its own while one or more cats are busy.
    function squadStatusPill() {
      const parts = [];
      SQUAD_SLOTS.forEach((id) => {
        const slot = squad[id];
        const busy = slotIsWorking(slot) || (slot.tabId != null && slot.workLockUntil > 0 && Date.now() < slot.workLockUntil);
        if (!busy) return;
        parts.push((CATS[id] ? CATS[id].name : id) + ' (' + slotTaskLabel(slot) + ')');
      });
      if (!parts.length) return WORK_PILL_TEXT;
      return '🐾 Working: ' + parts.join(' • ');
    }

    function writeSquad(next) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        chrome.storage.local.set({ [SQUAD_KEY]: next }, () => {
          try { void chrome.runtime.lastError; } catch (error) { /* no listener left */ }
        });
      } catch (error) {
        warnOnce('squad-write', error);
      }
    }

    // Callback style (not promises) so older Chromium builds and a suspended
    // MV3 worker all behave the same; `finish` guarantees exactly one answer.
    function readSquad(callback) {
      let answered = false;
      const finish = (value) => {
        if (answered) return;
        answered = true;
        callback(value);
      };
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
          finish(null);
          return;
        }
        chrome.storage.local.get(SQUAD_KEY, (data) => {
          try {
            if (chrome.runtime.lastError) { finish(null); return; }
          } catch (error) { /* ignore */ }
          finish(data ? data[SQUAD_KEY] : null);
        });
      } catch (error) {
        warnOnce('squad-read', error);
        finish(null);
      }
    }

    function requestTabId(callback) {
      let answered = false;
      const finish = (value) => {
        if (answered) return;
        answered = true;
        callback(value);
      };
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          finish(null);
          return;
        }
        chrome.runtime.sendMessage({ action: 'GET_CURRENT_TAB_ID' }, (response) => {
          try {
            if (chrome.runtime.lastError) { finish(null); return; }
          } catch (error) { /* ignore */ }
          finish(response && typeof response.tabId === 'number' ? response.tabId : null);
        });
      } catch (error) {
        warnOnce('presence-tab-id', error);
        finish(null);
      }
    }

    // Read-modify-write of the shared map. `mutate` receives a normalized copy
    // and edits it in place; the result is mirrored locally first so the UI
    // reacts immediately, then persisted for the other tabs.
    function updateSquad(mutate) {
      if (!squadEnabled || myTabId == null) return;
      readSquad((stored) => {
        const next = normalizeSquad(stored || squad);
        try { mutate(next); } catch (error) { warnOnce('squad-mutate', error); return; }
        squad = next;
        refreshAssignedCat();
        writeSquad(next);
        applyPresence();
      });
    }

    // Rule A+: keep this tab's session work lock visible in its slot without
    // disturbing which cat it owns. Claims a cat first if there is none yet.
    function publishWorkLock() {
      if (!squadEnabled || myTabId == null) return;
      const task = taskKindForState(currentState);
      if (!myCatId || !squad[myCatId] || squad[myCatId].tabId !== myTabId) {
        if (task) claimBusy(currentState);
        return;
      }
      if (task) myTask = task;
      updateSquad((next) => {
        const slot = next[myCatId];
        if (!slot || slot.tabId !== myTabId) return;
        next[myCatId] = { ...slot, task: myTask || slot.task, url: pageUrl(), workLockUntil: _activeWorkUntil, updatedAt: Date.now() };
      });
    }

    // Claim the specialist cat for a job (exam → Mochi, harvest → Boba,
    // review → Luna), falling back to any free slot. The read happens right
    // before the write and the jitter staggers simultaneous starts, so two tabs
    // starting together normally end up with two different cats.
    function claimSquad(task) {
      if (!uiEnabled) return;
      const wanted = task || 'exam';
      if (!squadEnabled || myTabId == null) {
        myTask = wanted;
        myCatId = preferredCatFor(wanted);
        refreshAssignedCat();
        applyPresence();
        return;
      }
      if (myCatId && squad[myCatId] && squad[myCatId].tabId === myTabId) {
        const slot = squad[myCatId];
        if (slot.task === wanted || (slot.task === 'idle' && slot.workLockUntil > Date.now())) {
          myTask = wanted; // the session work lock already reserves this cat
          if (slot.task !== wanted) {
            updateSquad((next) => {
              const current = next[myCatId];
              if (!current || current.tabId !== myTabId) return;
              next[myCatId] = { ...current, task: wanted, updatedAt: Date.now() };
            });
          }
          refreshAssignedCat();
          applyPresence();
          return;
        }
      }
      if (claimInFlight) { myTask = wanted; refreshAssignedCat(); applyPresence(); return; }
      claimInFlight = true;
      const jitter = 20 + Math.floor(Math.random() * 180);
      setTimeout(() => {
        readSquad((stored) => {
          const next = normalizeSquad(stored);
          // Free every slot this tab held before choosing its specialist.
          SQUAD_SLOTS.forEach((id) => {
            if (next[id].tabId === myTabId) {
              next[id] = { tabId: null, task: '', url: '', workLockUntil: 0, updatedAt: Date.now() };
            }
          });
          const preferred = preferredCatFor(wanted);
          const order = [preferred].concat(SQUAD_SLOTS.filter((id) => id !== preferred));
          let chosen = null;
          for (let i = 0; i < order.length; i += 1) {
            const slot = next[order[i]];
            const taken = slot.tabId != null && slot.tabId !== myTabId
              && (slotIsFresh(slot) || (slot.workLockUntil > 0 && Date.now() < slot.workLockUntil));
            if (!taken) { chosen = order[i]; break; }
          }
          claimInFlight = false;
          squad = next;
          if (!chosen) {
            // All three cats are working elsewhere: no cat here, show the pill.
            myCatId = null;
            myTask = '';
            refreshAssignedCat();
            applyPresence();
            return;
          }
          next[chosen] = {
            tabId: myTabId,
            task: wanted,
            url: pageUrl(),
            workLockUntil: _activeWorkUntil,
            updatedAt: Date.now(),
          };
          myCatId = chosen;
          myTask = wanted;
          assignedCatId = chosen;
          applyCatIdentity();
          writeSquad(next);
          applyPresence();
        });
      }, jitter);
    }

    // Feed every HUD line through here (before any other reader). A quiz run and a
    // harvest re-arm a 20 s work lock, so the cat stays put through the idle gap
    // between two questions; "Bot stopped" / "Quiz complete" / "Review scan:" /
    // "Harvested" end it immediately.
    function noteWorkLockLine(line) {
      if (!line) return;
      if (WORK_END_RE.test(line)) {
        if (!_activeWorkUntil) return;
        _activeWorkUntil = 0;
        lastWorkLockPushAt = 0; // the next run publishes at once
        // The run really ended. If the cat is already idle on this tab, hand the
        // slot back and bring Mochi home; otherwise just clear the work lock and
        // let the state change to idle do the hand-back (one storage write only).
        if (currentState === 'idle') { releaseBusy(); return; }
        publishWorkLock();
        return;
      }
      if (!WORK_START_RE.test(line)) return;
      _activeWorkUntil = Date.now() + WORK_LOCK_MS;
      if (Date.now() - lastWorkLockPushAt < 4000) return; // ≤ one storage write / 4 s
      lastWorkLockPushAt = Date.now();
      publishWorkLock();
    }

    function claimBusy(state) {
      if (!uiEnabled) return; // the popup switch is off: this tab must not claim
      if (!BUSY_LABELS[state]) return;
      const task = taskKindForState(state);
      if (!task) return;
      claimSquad(task);
    }

    // Idle hand-back. Inside a run/harvest (`_activeWorkUntil` in the future) the
    // slot stays reserved for this tab but reads task 'idle', so the other tabs
    // keep showing "Working" through the gap between two questions. Once the run
    // really ends the slot is freed and the focused tab gets Mochi back.
    function releaseBusy() {
      if (!uiEnabled) return;
      const keep = _activeWorkUntil > Date.now();
      if (!squadEnabled || myTabId == null) {
        myCatId = null;
        myTask = '';
        refreshAssignedCat();
        applyPresence();
        return;
      }
      if (!myCatId) {
        myTask = '';
        applyPresence();
        return;
      }
      if (myTask === 'idle' && keep) { applyPresence(); return; }
      if (keep) {
        myTask = 'idle';
        updateSquad((next) => {
          const slot = next[myCatId];
          if (!slot || slot.tabId !== myTabId) return;
          next[myCatId] = { ...slot, task: 'idle', url: pageUrl(), workLockUntil: _activeWorkUntil, updatedAt: Date.now() };
        });
        return;
      }
      myCatId = null;
      myTask = '';
      updateSquad((next) => {
        SQUAD_SLOTS.forEach((id) => {
          if (next[id].tabId === myTabId) {
            next[id] = { tabId: null, task: '', url: '', workLockUntil: 0, updatedAt: Date.now() };
          }
        });
        const jobsLeft = SQUAD_SLOTS.some((id) => slotIsWorking(next[id]));
        if (jobsLeft) return; // a cat still works elsewhere: this tab keeps the pill
        if (!tabVisible()) return;
        // Every job finished: the primary cat returns to this (focused) tab.
        next.mochi = { tabId: myTabId, task: 'idle', url: pageUrl(), workLockUntil: 0, updatedAt: Date.now() };
        myCatId = 'mochi';
        myTask = 'idle';
      });
    }

    // Rule B: take the idle Mochi onto this (visible) tab. `follow` greets the
    // user only when he came from another tab, so a plain page load stays quiet.
    function claimIdle(follow) {
      if (!uiEnabled) return;
      if (!squadEnabled || myTabId == null) return;
      if (!tabVisible()) return;
      // A working cat on this tab always wins over an idle claim.
      const holdsSlot = !!myCatId && !!squad[myCatId] && squad[myCatId].tabId === myTabId;
      if (holdsSlot && slotIsWorking(squad[myCatId])) {
        applyPresence();
        return;
      }
      if (myTask && myTask !== 'idle' && holdsSlot) { applyPresence(); return; }
      if (otherTabIsBusy() || otherTabWorkLocked()) return; // Rule A always wins
      const previousOwner = squad.mochi.tabId;
      if (squad.mochi.tabId === myTabId && squad.mochi.task === 'idle' && slotIsFresh(squad.mochi)) {
        myCatId = 'mochi';
        myTask = 'idle';
        refreshAssignedCat();
        applyPresence();
        return;
      }
      readSquad((stored) => {
        const next = normalizeSquad(stored);
        const jobsLeft = SQUAD_SLOTS.some((id) => slotIsWorking(next[id]) && next[id].tabId !== myTabId);
        if (jobsLeft || otherTabWorkLocked()) { squad = next; applyPresence(); return; }
        // Only one idle mascot follows the user: fold every idle assignment away.
        SQUAD_SLOTS.forEach((id) => {
          if (next[id].task === 'idle' || next[id].tabId == null) {
            next[id] = { tabId: null, task: '', url: '', workLockUntil: 0, updatedAt: Date.now() };
          }
        });
        next.mochi = { tabId: myTabId, task: 'idle', url: pageUrl(), workLockUntil: 0, updatedAt: Date.now() };
        squad = next;
        myCatId = 'mochi';
        myTask = 'idle';
        refreshAssignedCat();
        writeSquad(next);
        applyPresence();
        if (follow && previousOwner != null && previousOwner !== myTabId) {
          const line = pickFreshLine(FOLLOW_LINES);
          if (line) setBubble(line, true);
          scheduleQuote();
        }
      });
    }

    function tabVisible() {
      try {
        return document.visibilityState === 'visible';
      } catch (error) {
        return true;
      }
    }

    function documentHasFocus() {
      try {
        return typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      } catch (error) {
        return true;
      }
    }

    // Polled by the existing 1.5 s reconciler. Ownership never moves merely
    // because two tabs poll each other (that would trade cats forever); it only
    // moves on two one-shot recoveries: a working claim older than
    // PRESENCE_STALE_MS means that tab was closed/crashed, and a finished
    // run/harvest ("Bot stopped" / "Harvested" / "Quiz complete") hands Mochi
    // back to the tab the user is actually looking at.
    function presenceTick() {
      if (!uiEnabled) return;
      if (!squadReady) return;
      applyPresence();
      if (!squadEnabled) return;
      const busyElsewhere = otherTabIsBusy() || otherTabWorkLocked();
      if (busyElsewhere) {
        sawOtherTabWorking = true; // Rule A / A+ still holds at least one cat
        return;
      }
      // The other tabs stopped working. Focus decides, so two visible windows can
      // never trade the idle cat back and forth.
      if (sawOtherTabWorking) {
        sawOtherTabWorking = false;
        if (tabVisible() && documentHasFocus()) { claimIdle(true); return; }
      }
      if (!myCatId && taskKindForState(currentState)) { claimBusy(currentState); return; }
      if (myCatId && squad[myCatId] && squad[myCatId].tabId === myTabId) return; // this tab shows a cat
      const owner = squad.mochi;
      if (owner.tabId === myTabId) return;
      if (owner.tabId != null && owner.task === 'idle' && slotIsFresh(owner)) return; // another tab shows Mochi
      if (Date.now() - lastStaleRecoveryAt < PRESENCE_STALE_MS) return;
      if (!tabVisible() || !documentHasFocus()) return;
      lastStaleRecoveryAt = Date.now();
      claimIdle(false); // the stale owner vanished: take the idle cat back
    }

    // Rule B follow-through for "work finished while I was already watching this
    // tab": a hand-off published by another tab is claimed by the focused tab.
    // The tab-id tie-break (`myTabId < previousOwner`) keeps it deterministic.
    function maybeFollowIdle(previousOwner) {
      if (!squadEnabled || myTabId == null) return;
      if (otherTabIsBusy() || otherTabWorkLocked()) return; // another cat still works
      if (previousOwner == null || previousOwner === myTabId) return;
      if (myTabId >= previousOwner) return;                // deterministic winner only
      if (!tabVisible() || !documentHasFocus()) return;
      claimIdle(true); // "Done working! What are we doing on this tab?"
    }

    function showCat() {
      if (!wrapEl) return;
      if (wrapEl.style.display === 'none') wrapEl.style.display = 'block';
      if (!booted || currentState !== 'idle' || napping) { refreshSquadBadge(); return; }
      if (!roamTimer) scheduleRoam();
      if (!quoteTimer) scheduleQuote();
      refreshSquadBadge();
    }

    function hideCat() {
      if (!wrapEl) return;
      if (wrapEl.style.display !== 'none') wrapEl.style.display = 'none';
      if (bubbleEl) bubbleEl.classList.remove('qb-bubble-visible');
      if (roamTimer) { clearTimeout(roamTimer); roamTimer = null; }
      if (quoteTimer) { clearTimeout(quoteTimer); quoteTimer = null; }
      stopSquadHangout();
      refreshSquadBadge();
    }

    function showPill(show, text) {
      if (!pillEl) return;
      if (!uiEnabled) { pillEl.classList.remove(PILL_CLASS); return; }
      const label = text || PILL_TEXT;
      if (pillEl.textContent !== label) pillEl.textContent = label;
      let visible = true;
      try { visible = document.visibilityState === 'visible'; } catch (error) { /* assume */ }
      pillEl.classList.toggle(PILL_CLASS, !!show && visible);
    }

    // Single source of truth for "which cat is painted here?". A working cat on
    // this tab always shows; otherwise, while any cat works elsewhere, every
    // other tab stays hidden and narrates the squad in the status pill.
    function applyPresence() {
      if (!wrapEl) return;
      // Disabled in the popup: nothing of the mascot exists on this tab at all.
      if (!uiEnabled) { hideCat(); showPill(false); return; }
      if (!squadReady) { hideCat(); showPill(false); return; }
      if (!squadEnabled) {
        // Single-tab fallback: show the specialist for the current job.
        if (!myCatId) myCatId = preferredCatFor(myTask || taskKindForState(currentState) || 'exam');
        refreshAssignedCat();
        showCat();
        showPill(false);
        return;
      }

      // If another tab took this slot (rare simultaneous claim), forget it so the
      // next reconciliation tick can claim one of the remaining free cats.
      if (myCatId && (!squad[myCatId] || squad[myCatId].tabId !== myTabId)) {
        myCatId = null;
        if (myTask === 'idle') myTask = '';
        refreshAssignedCat();
      }

      // A cat assigned to this tab: working, or idle while no job runs anywhere.
      let mine = null;
      SQUAD_SLOTS.forEach((id) => {
        if (mine) return;
        const slot = squad[id];
        if (slot.tabId !== myTabId) return;
        if (slotIsWorking(slot) || (slot.task === 'idle' && slotIsFresh(slot))) mine = id;
      });
      const mineWorking = !!mine && slotIsWorking(squad[mine]);
      const busyElsewhere = SQUAD_SLOTS.some((id) => {
        const slot = squad[id];
        return slot.tabId != null && slot.tabId !== myTabId && slotIsWorking(slot);
      }) || otherTabWorkLocked();

      if (mine && (mineWorking || !busyElsewhere)) {
        myCatId = mine;
        myTask = squad[mine].task || 'idle';
        refreshAssignedCat();
        showCat();
        showPill(false);
        return;
      }
      if (busyElsewhere || (mine == null && workingSlots().length)) {
        hideCat();
        showPill(true, squadStatusPill());
        return;
      }

      // Every job finished. Only one tab paints Mochi: the fresh idle owner, or
      // a visible tab in the split second before the first claim lands.
      const owner = squad.mochi;
      const ownerIdle = owner.tabId != null && owner.task === 'idle' && slotIsFresh(owner);
      if (ownerIdle && owner.tabId === myTabId) {
        myCatId = 'mochi';
        myTask = 'idle';
        refreshAssignedCat();
        showCat();
        showPill(false);
        return;
      }
      if (!ownerIdle && !myCatId && tabVisible()) {
        assignedCatId = 'mochi';
        applyCatIdentity();
        showCat();
        showPill(false);
        return;
      }
      hideCat();
      showPill(false);
    }

    /* ── Instant enable/disable (BOT_ENABLED) ─────────────────────────────── */

    // popup.js writes BOT_ENABLED to chrome.storage.local and mirrors it to
    // .sync; local wins when present, `!== false` means enabled.
    function readBotEnabled(callback) {
      const done = (value) => { try { callback(value !== false); } catch (error) { /* ignore */ } };
      try {
        if (typeof chrome === 'undefined' || !chrome.storage) { done(true); return; }
        chrome.storage.local.get('BOT_ENABLED', (local) => {
          try { if (chrome.runtime.lastError) { done(true); return; } } catch (error) { /* ignore */ }
          if (local && local.BOT_ENABLED !== undefined) { done(local.BOT_ENABLED); return; }
          try {
            chrome.storage.sync.get('BOT_ENABLED', (sync) => {
              try { if (chrome.runtime.lastError) { done(true); return; } } catch (error) { /* ignore */ }
              done(sync ? sync.BOT_ENABLED : undefined);
            });
          } catch (error) { done(true); }
        });
      } catch (error) { done(true); }
    }

    // Disabled: cats + pill gone and every idle timer stopped. Enabled: the
    // shared CAT_SQUAD map decides which cat comes back on this tab.
    function applyUiEnabled(enabled) {
      const next = enabled !== false;
      const changed = next !== uiEnabled;
      uiEnabled = next;
      if (!next) {
        hideCat();
        showPill(false);
        if (wrapEl) wrapEl.style.display = 'none';
        if (pillEl) pillEl.classList.remove(PILL_CLASS);
        if (napQuoteTimer) { clearTimeout(napQuoteTimer); napQuoteTimer = null; }
        if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
        overlayState = '';
        return;
      }
      if (changed) applyPresence();
    }

    function watchUiEnabled() {
      if (uiEnabledWatched) return;
      uiEnabledWatched = true;
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            try {
              if (areaName !== 'local' && areaName !== 'sync') return;
              if (!changes || !changes.BOT_ENABLED) return;
              const value = changes.BOT_ENABLED.newValue;
              applyUiEnabled(value === undefined ? true : value);
            } catch (error) { warnOnce('ui-toggle-change', error); }
          });
        }
      } catch (error) { /* storage events unavailable */ }
      readBotEnabled((enabled) => applyUiEnabled(enabled));
    }

    // Every state change runs through here: working states claim the specialist
    // cat for their job, idle hands it back to whichever tab the user is on.
    function syncPresenceForState(state) {
      // Starting a quiz / harvest always wakes the cat up, even before the shared
      // map is ready (the state's own bubble takes over right after).
      if (state === 'idle') wakeFromNap(null);
      else if (BUSY_LABELS[state]) wakeFromNap(WAKE_LINE);
      if (!uiEnabled) return; // disabled in the popup: never claim a cat
      const task = taskKindForState(state);
      if (task) {
        stopSquadHangout(); // a real job always ends the hangout
        claimBusy(state);
        return;
      }
      if (state === 'idle') releaseBusy();
    }

    /* ── Summon Squad hangout (idle + cosmetic only) ──────────────────────── */

    const SQUAD_SIZE = 96;               // px — exact 4× scale of the 24×24 sprite
    const SQUAD_TAP_MS = 800;            // triple-click window
    const HANG_LINE_MIN_MS = 3800;       // squad chatter cadence
    const HANG_LINE_SPREAD_MS = 2600;
    const HANG_BUBBLE_MS = 3600;         // how long a secondary cat's bubble stays
    const HANG_LINES = [
      'Squad assemble!! 🐾✨',
      'Best squad in the whole browser 🐾',
      'Three cats, zero bugs. Probably. 🐾🔥',
    ];

    const hangout = {
      active: false,
      cats: [],
      lineTimer: null,
      taps: [],
    };
    let squadBadgeEl = null;

    function pickCatLine(catId, kind) {
      const cat = CATS[catId] || CATS.mochi;
      const pool = cat && cat.lines ? cat.lines[kind] : null;
      return Array.isArray(pool) && pool.length ? pickFreshLine(pool) : '';
    }

    // Swap the primary canvas to the cat this tab now owns (new palette,
    // accessory, aria-label and badge title), then repaint at once.
    function applyCatIdentity() {
      if (hangout.active) stopSquadHangout();
      const cat = CATS[assignedCatId] || CATS.mochi;
      if (catEl) {
        catEl.dataset.cat = assignedCatId;
        catEl.setAttribute('aria-label', 'Quiz bot pixel cat ' + cat.name + ' — ' + cat.fur + ', ' + cat.role);
      }
      if (wrapEl) wrapEl.dataset.cat = assignedCatId;
      paintPrimary();
      refreshSquadBadge();
    }

    function refreshAssignedCat() {
      const next = myCatId && CATS[myCatId] ? myCatId : (myTask ? preferredCatFor(myTask) : 'mochi');
      if (next === assignedCatId) { refreshSquadBadge(); return; }
      assignedCatId = next;
      applyCatIdentity();
    }

    function refreshSquadBadge() {
      if (!squadBadgeEl) return;
      const count = hangout.active ? 3 : 1;
      const label = 'Squad (' + count + '/3)';
      if (squadBadgeEl.textContent !== label) squadBadgeEl.textContent = label;
      squadBadgeEl.title = hangout.active
        ? 'Send Mochi, Luna & Boba home (triple-click the cat also toggles)'
        : 'Summon Squad — hang out with Mochi, Luna & Boba';
      const allowed = uiEnabled && booted && currentState === 'idle' && !napping
        && catShown() && !otherTabIsBusy();
      squadBadgeEl.classList.toggle(SQUAD_BADGE_HIDDEN, !allowed);
    }

    function canHangout() {
      return booted && uiEnabled && currentState === 'idle' && !napping
        && catShown() && !otherTabIsBusy();
    }

    // Triple-click detector: three taps inside SQUAD_TAP_MS toggle the hangout.
    // Returns true when it consumed the click (so it does not also count as a pet).
    function noteSquadTap() {
      const now = Date.now();
      hangout.taps = hangout.taps.filter((at) => now - at < SQUAD_TAP_MS);
      hangout.taps.push(now);
      if (hangout.taps.length < 3) return false;
      hangout.taps = [];
      toggleSquadHangout();
      return true;
    }

    function onSquadBadgeClick() {
      try {
        markInteraction();
        suppressClickUntil = Date.now() + 250; // do not also trigger a pet line
        toggleSquadHangout();
      } catch (error) {
        warnOnce('squad-badge', error);
      }
    }

    function toggleSquadHangout() {
      if (hangout.active) {
        stopSquadHangout();
        setBubble('Squad dismissed! Solo cat life again 🐾', true);
        scheduleQuote();
        return;
      }
      if (!canHangout()) {
        setBubble('Not now — we are working! 💼🐾', true);
        return;
      }
      startSquadHangout();
    }


    function hangoutSpot(index, total) {
      const maxLeft = Math.max(EDGE, window.innerWidth - SQUAD_SIZE - EDGE);
      const span = Math.max(0, maxLeft - EDGE);
      const left = EDGE + span * ((index + 0.6) / Math.max(1, total + 0.4));
      const maxTop = Math.max(EDGE, window.innerHeight - SQUAD_SIZE - EDGE);
      const band = Math.min(80, maxTop * 0.2);
      const top = maxTop - (index % 2 === 0 ? 0 : band);
      return { left, top };
    }

    function spawnHangoutCat(id, index, total) {
      const spot = hangoutSpot(index, total);
      const wrap = document.createElement('div');
      wrap.className = SQUAD_CAT_CLASS;
      wrap.style.left = Math.round(spot.left) + 'px';
      wrap.style.top = Math.round(spot.top) + 'px';

      const bubble = document.createElement('div');
      bubble.className = SQUAD_BUBBLE_CLASS;

      const canvas = document.createElement('canvas');
      canvas.className = SQUAD_CANVAS_CLASS;
      canvas.width = CANVAS;
      canvas.height = CANVAS;
      canvas.setAttribute('aria-hidden', 'true');
      let catCtx = null;
      try {
        catCtx = canvas.getContext('2d');
        if (catCtx) {
          catCtx.imageSmoothingEnabled = false;
          catCtx.setTransform(CANVAS / GRID, 0, 0, CANVAS / GRID, 0, 0);
        }
      } catch (error) {
        catCtx = null;
        warnOnce('squad-context', error);
      }

      wrap.appendChild(bubble);
      wrap.appendChild(canvas);
      const host = document.body || document.documentElement;
      if (host) host.appendChild(wrap);

      return {
        id,
        wrap,
        canvas,
        ctx: catCtx,
        bubble,
        bubbleTimer: null,
        x: spot.left,
        y: spot.top,
        walkUntil: 0,
        nextMoveAt: Date.now() + 600 + Math.random() * 1400,
        tickOffset: 3 + index * 7,
      };
    }

    function startSquadHangout() {
      if (hangout.active || !canHangout()) return;
      hangout.active = true;
      // A triple-click also fires dblclick; drop any cheer overlay it started.
      if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
      overlayState = '';
      if (catEl) {
        catEl.classList.remove('qb-hop', 'qb-review');
        applyAsset(renderState());
      } else {
        paintPrimary();
      }
      const extras = SQUAD_SLOTS.filter((id) => id !== assignedCatId);
      extras.forEach((id, index) => {
        try { hangout.cats.push(spawnHangoutCat(id, index, extras.length)); } catch (error) { warnOnce('squad-spawn', error); }
      });
      const line = pickCatLine(assignedCatId, 'hang') || pickFreshLine(HANG_LINES);
      if (line) setBubble(line, true);
      scheduleHangoutLine(900);
      refreshSquadBadge();
    }

    function stopSquadHangout() {
      if (!hangout.active) return;
      hangout.active = false;
      if (hangout.lineTimer) { clearTimeout(hangout.lineTimer); hangout.lineTimer = null; }
      hangout.cats.forEach((cat) => {
        if (cat.bubbleTimer) { clearTimeout(cat.bubbleTimer); cat.bubbleTimer = null; }
        try {
          if (cat.wrap && cat.wrap.parentNode) cat.wrap.parentNode.removeChild(cat.wrap);
        } catch (error) { /* already detached */ }
      });
      hangout.cats = [];
      refreshSquadBadge();
    }


    function showSquadBubble(cat, line) {
      if (!cat || !cat.bubble) return;
      cat.bubble.textContent = line;
      cat.bubble.classList.add('qb-bubble-visible');
      if (cat.bubbleTimer) clearTimeout(cat.bubbleTimer);
      cat.bubbleTimer = setTimeout(() => {
        cat.bubbleTimer = null;
        if (cat.bubble) cat.bubble.classList.remove('qb-bubble-visible');
      }, HANG_BUBBLE_MS);
    }

    // Move the extra cats in short trots along the bottom band. The CSS
    // transition does the gliding; walkUntil just selects the trot frames.
    function advanceHangoutCats() {
      if (!hangout.active || !hangout.cats.length) return;
      const now = Date.now();
      const maxLeft = Math.max(EDGE, window.innerWidth - SQUAD_SIZE - EDGE);
      const maxTop = Math.max(EDGE, window.innerHeight - SQUAD_SIZE - EDGE);
      const band = Math.min(80, maxTop * 0.2);
      hangout.cats.forEach((cat) => {
        if (!cat.wrap || now < cat.nextMoveAt) return;
        const nextLeft = EDGE + Math.random() * Math.max(1, maxLeft - EDGE);
        const nextTop = maxTop - Math.random() * band;
        const dx = nextLeft - cat.x;
        if (Math.abs(dx) > 6 && cat.canvas) {
          cat.canvas.classList.toggle('qb-facing-left', dx < 0);
        }
        const distance = Math.abs(dx) + Math.abs(nextTop - cat.y);
        cat.walkUntil = now + Math.min(1400, 450 + distance * 2);
        cat.x = nextLeft;
        cat.y = nextTop;
        cat.wrap.style.left = Math.round(nextLeft) + 'px';
        cat.wrap.style.top = Math.round(nextTop) + 'px';
        cat.nextMoveAt = now + 2200 + Math.random() * 3600;
      });
    }

    function drawHangoutCats(tick) {
      if (!hangout.active) return;
      const now = Date.now();
      hangout.cats.forEach((cat) => {
        if (!cat.ctx) return;
        ctx = cat.ctx;
        applyPalette(cat.id);
        drawCatFrame(now < cat.walkUntil ? 'walk' : 'idle', tick + cat.tickOffset, cat.id);
      });
    }

    // Round-robin chatter: one cat speaks every 4–6 s, in its own personality.
    function scheduleHangoutLine(delay) {
      if (hangout.lineTimer) clearTimeout(hangout.lineTimer);
      hangout.lineTimer = setTimeout(() => {
        hangout.lineTimer = null;
        if (!hangout.active) return;
        if (!canHangout()) { stopSquadHangout(); return; }
        const speakers = [assignedCatId].concat(hangout.cats.map((cat) => cat.id));
        const id = speakers[Math.floor(Math.random() * speakers.length)];
        const line = pickCatLine(id, 'hang') || pickFreshLine(HANG_LINES);
        if (line) {
          const extra = hangout.cats.filter((cat) => cat.id === id)[0];
          if (!extra) setBubble(line, true);
          else showSquadBubble(extra, line);
        }
        scheduleHangoutLine(HANG_LINE_MIN_MS + Math.random() * HANG_LINE_SPREAD_MS);
      }, delay || HANG_LINE_MIN_MS);
    }


    /* ── Local Cat Brain Core — zero API keys, zero network ──────────────── */

    // Everything below is local: page identity, a privacy-safe keystroke count, a
    // copy reaction, cursor movement and scroll velocity feed a template composer.
    // No fetch(), no provider call, no key — the cat is chatty offline.
    const BRAIN_KEY = 'CAT_BRAIN_MEMORY';
    const BRAIN_SAVE_MS = 1200;         // debounce: one storage write per burst
    const TYPE_BURST_MS = 1400;         // a pause this long closes a typing burst
    const TYPE_BURST_MIN = 12;          // keys per burst before he comments
    const CURSOR_SAMPLE_MS = 90;        // mousemove sampling floor (~11 Hz)
    const CURSOR_DIZZY_SPEED = 3800;    // px/s → whisker-wiggle dizzy (a real flick)
    const DIZZY_HOLD_MS = 1200;
    const DIZZY_COOLDOWN_MS = 12000;
    const SCROLL_SPEED = 3400;          // px/s → "WHOA slow down scrolling!!"
    const SCROLL_COOLDOWN_MS = 9000;
    const THOUGHT_MEMORY = 14;          // remember this many lines to avoid repeats
    const COPY_LINE = 'I saw you copy that!! Saving braincells? 👀📋';
    const DIZZY_LINES = [
      'Whoa— dizzy!! My whiskers are spinning!! 🌀🙀',
      'Slow paws!! You are making me seasick. 🐾💫',
      'Wheee— my eyes cannot keep up!! 😵‍💫',
      'Is the mouse running a marathon? 😹💨',
    ];
    const SCROLL_LINES = [
      'WHOA slow down scrolling!! 🎢🙀',
      'You are scrolling like the answer is hiding! 🐾💨',
      'SCROLL SLOWER. My paws are smoking. 🔥🐾',
      'Racing to the bottom? The questions are still up there! 😾⬆️',
    ];
    const TYPING_BRAIN_LINES = [
      '{keys} keys in a burst! Essay mode?? ✍️😼',
      'Tap tap tap… {keys} keystrokes. I heard all of them. 👂🐾',
      'Your keyboard is getting a workout: {keys} keys! ⌨️💪',
      'Writing a novel over there? {keys} keys already! 📖😹',
    ];
    const GENERIC_BRAIN_LINES = [
      'Just vibing on {host}. 🐾',
      'Still here! Still a cat. 🐱',
      'Plot twist: the answer was in your notes all along. 📓',
      'My tail is a metronome for your productivity. 🎵',
      'Blink test… yep, still working. 😼',
      'I give this tab a 9/10 for nap-ability. 😴',
      'If in doubt, re-read the question. Trust me. 🙀',
      'Your mouse cursor is my favourite toy. 🐁',
      'Whisker status: fully calibrated. ✨',
      'Ten more minutes and I am napping on your keyboard. ⌨️',
      'Psst… stretch your shoulders. I will wait. 🧘',
      'I have no thumbs, yet here we are, working. 🐾',
      'Reminder: you are doing better than you think. 💛',
      'Loading more brain cells… ▓▓▓░░ 60% 🧠',
    ];
    const TITLE_BRAIN_LINES = [
      '"{title}" — sounds important. Ears up! 🐱📖',
      'So we are on "{title}" now. Noted. 📝',
      '"{title}"? I could summarise that in one meow. 😼',
      'This page is called "{title}". Fancy. 🎩',
      '"{title}"… reading it with my strongest reading glasses. 🤓',
    ];


    const COURSE_BRAIN_LINES = [
      '{course} again? We own this subject now. 💪',
      '{course} detected. Braincells, assemble! 🧠⚡',
      'A wild {course} problem appears. I believe in you. 🐾',
      '{course}? My whiskers say you already know this. ✨',
    ];
    const BANK_BRAIN_LINES = [
      'I am carrying {bank} answers in my little cat backpack. 🎒',
      '{bank} answers stored. That is a lot of fish. 🐟',
      'My brain bank holds {bank} questions and counting! 🧠📚',
    ];
    const HOP_BRAIN_LINES = [
      '{hops} tabs today. My paws are tired. 🐾',
      'Tab hop #{hops}. I am basically a parkour cat now. 🏃',
      'We have visited {hops} tabs today — adventurous! 🗺️',
    ];
    const PET_BRAIN_LINES = [
      'That is {pets} pets so far. I am keeping score. 😽',
      '{pets} pets! My fur has never been fluffier. ✨',
      'Pet #{pets} accepted. Purring engaged. 💛',
    ];
    const NIGHT_LINES = [
      'It is {time}. The late-night study arc is real. 🌙😾',
      '{time}?? Sleep is also a strategy, you know. 🛏️',
      'Night owl mode: ON. I will keep watch. 🦉🐾',
      'At {time} even my whiskers are sleepy. 😴',
      'Late-night brain: 10% logic, 90% vibes. 🌌',
      'The house is quiet, {host} is open. Cozy. 🌙',
    ];
    // Site-specific commentary, keyed by the hostname buckets below.
    const SITE_LINES = {
      youtube: [
        'YouTube again? One video, then back to work. Promise? 📺😼',
        'I will allow exactly one cat video. Then we study. 🐈📹',
        'Autoplay is a trap and you know it. ⏭️🙀',
        'Is this "research"? Because it looks like cat videos. 🐾👀',
      ],
      messenger: [
        'Chatting? Say hi from me. 🐾💬',
        'Tell them a cat says the answers are in the notes. 😼📚',
        'Messenger pings and my ears twitch every time. 👂✨',
        'One reply, then back to the questions. Deal? 🤝🐾',
      ],
      github: [
        'GitHub! Pushing answers or pushing code? 🐙✨',
        'Green squares are basically catnip for you. 🟩😹',
        'Commit early, commit often, then pet the cat. 🐾💾',
        'I reviewed your commits. Very fluffy. LGTM. ✅',
      ],
      ai: [
        'Another AI tab? Am I not enough?! 😾🤖',
        'Ask them, sure… but I already had the vibe of the answer. 🔮',
        'Two AIs and one cat in one browser. Bold. 🧠🐾',
        'I hope that one also knows the answers. 👀✨',
      ],
    };
    const AI_HOSTS_RE = /(^|\.)(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|perplexity\.ai|copilot\.microsoft\.com|deepseek\.com|grok\.com|x\.ai)$/i;
    const STUDY_HOSTS_RE = /(amaes\.com|amauoed\.com|quizlet\.com|studocu\.com|brainly\.|coursehero\.com|scribd\.com|moodle)/i;

    // `gazeLook` is read by drawFace(): -1 pupils left, 0 centre, +1 right.
    let gazeLook = 0;
    let dizzyTimer = null;

    const brain = {
      started: false,
      loaded: false,
      saveTimer: null,
      day: '',
      tabHopsToday: 0,
      petCount: 0,
      copyCount: 0,
      keyCount: 0,
      bankCount: 0,
      host: '',
      cleanTitle: '',
      courseCode: '',
      timeStr: '',
      lastThought: '',
      recent: [],
      typing: { keys: 0, timer: null },
      cursor: { x: 0, y: 0, at: 0, speed: 0, lastDizzyAt: 0, samples: 0 },
      scroll: { y: 0, at: 0, lastAlarmAt: 0 },
    };

    /* ── Brain: live context (all local, all read-only) ───────────────────── */

    function todayKey() {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return now.getFullYear() + '-' + month + '-' + day;
    }

    // Site buckets used for the commentary below.
    function siteKind(host) {
      const value = String(host || brain.host || '').toLowerCase();
      if (!value) return '';
      if (/(^|\.)(youtube\.com|youtu\.be)$/.test(value)) return 'youtube';
      if (/(^|\.)(messenger\.com|facebook\.com|web\.whatsapp\.com|discord\.com|instagram\.com|t\.me|telegram\.org)$/.test(value)) return 'messenger';
      if (/(^|\.)(github\.com|gist\.github\.com|gitlab\.com)$/.test(value)) return 'github';
      if (AI_HOSTS_RE.test(value)) return 'ai';
      return '';
    }

    function cleanPageTitle(raw) {
      let text = norm(raw);
      if (!text) return '';
      text = text
        .replace(/^\(\d+\+?\)\s*/, '')  // "(3) Messenger"
        .replace(/\s*[·|–—-]\s*(?:YouTube|Messenger|GitHub|Google\s+Chrome|Moodle|Quizlet|Studocu|Brainly|Course\s*Hero|Scribd)\s*$/i, '')
        .replace(/\s*\|\s*.*$/, '')     // "Course | Site"
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 64) text = text.slice(0, 61).trim() + '…';
      return text;
    }

    // ECON1012 / IT3010 / CS101 → the course code the cat can nod at.
    function courseCodeFrom(text) {
      const raw = String(text || '');
      const strict = raw.match(/\b[A-Z]{2,4}\d{4}\b/);
      if (strict) return strict[0];
      // Tab titles are often lowercased upstream: retry, then normalise.
      const loose = raw.match(/\b([A-Za-z]{2,4})(\d{4})\b/);
      return loose ? (loose[1] + loose[2]).toUpperCase() : '';
    }

    function refreshBrainContext() {
      try {
        if (typeof location !== 'undefined' && location.hostname) {
          brain.host = String(location.hostname).replace(/^www\./i, '');
        }
      } catch (error) { /* keep the old host */ }
      const rawTitle = (typeof document !== 'undefined' && document.title) || '';
      brain.cleanTitle = cleanPageTitle(rawTitle);
      brain.courseCode = courseCodeFrom(rawTitle) || courseCodeFrom(brain.cleanTitle);
      let time = '';
      try { time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (error) { time = ''; }
      brain.timeStr = time;
      return brain;
    }

    function isLateNight() {
      const hour = new Date().getHours();
      return hour >= 0 && hour < 5; // 00:00 – 04:59
    }

    /* ── Brain: the dynamic sentence composer ─────────────────────────────── */

    function thoughtContext(extra) {
      refreshBrainContext();
      const ctx = {
        title: brain.cleanTitle || 'this page',
        host: brain.host || 'this page',
        course: brain.courseCode,
        time: brain.timeStr || '',
        bank: brain.bankCount ? String(brain.bankCount) : '',
        hops: brain.tabHopsToday ? String(brain.tabHopsToday) : '',
        pets: brain.petCount ? String(brain.petCount) : '',
        keys: brain.keyCount ? String(brain.keyCount) : '',
      };
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach((key) => { ctx[key] = String(extra[key]); });
      }
      return ctx;
    }

    // `{slot}` → live value. A line that needs data we do not have is dropped
    // instead of showing an empty hole ("{course} again?" with no code).
    function fillThought(template, ctx) {
      let missing = false;
      const filled = String(template || '').replace(/\{(\w+)\}/g, (match, key) => {
        const value = ctx[key];
        if (!value) { missing = true; return ''; }
        return value;
      });
      return missing ? '' : filled;
    }

    function rememberThought(line) {
      brain.lastThought = line;
      brain.recent.push(line);
      while (brain.recent.length > THOUGHT_MEMORY) brain.recent.shift();
    }

    // The whole brain in one call: collect every pool that fits the moment, fill
    // the slots, then pick a line that was not used recently. `kind` is
    // 'idle' | 'pet' | 'hype' | 'typing' | 'copy' | 'scroll' | 'dizzy'.
    function composeCatThought(kind, extra) {
      try {
        const mode = kind || 'idle';
        const ctx = thoughtContext(extra);
        const pool = [];
        const add = (list) => { if (Array.isArray(list)) list.forEach((line) => pool.push(line)); };
        if (mode === 'copy') add([COPY_LINE]);
        else if (mode === 'scroll') add(SCROLL_LINES);
        else if (mode === 'dizzy') add(DIZZY_LINES);
        else if (mode === 'typing') add(TYPING_BRAIN_LINES);
        else if (mode === 'pet') { add(PET_LINES); add(PET_BRAIN_LINES); add(TITLE_BRAIN_LINES); }
        else if (mode === 'hype') {
          add(HYPE_LINES);
          add(TITLE_BRAIN_LINES);
          if (brain.courseCode) add(COURSE_BRAIN_LINES);
          if (isLateNight()) add(NIGHT_LINES);
        } else {
          add(GENERIC_BRAIN_LINES);
          if (isLateNight()) add(NIGHT_LINES);
          const site = siteKind();
          if (site) add(SITE_LINES[site]);
          add(TITLE_BRAIN_LINES);
          if (brain.courseCode) add(COURSE_BRAIN_LINES);
          if (brain.bankCount) add(BANK_BRAIN_LINES);
          if (brain.tabHopsToday > 1) add(HOP_BRAIN_LINES);
          if (brain.petCount) add(PET_BRAIN_LINES);
        }
        const fresh = [];
        const seen = new Set();
        pool.forEach((template) => {
          const line = fillThought(template, ctx);
          if (!line || seen.has(line)) return;
          seen.add(line);
          if (brain.recent.indexOf(line) !== -1) return;
          if (line === lastBubbleText) return;
          fresh.push(line);
        });
        const candidates = fresh.length ? fresh : Array.from(seen);
        if (!candidates.length) return mode === 'idle' ? pickFreshLine(IDLE_QUOTES) : '';
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        rememberThought(pick);
        return pick;
      } catch (error) {
        warnOnce('brain-compose', error);
        return '';
      }
    }

    /* ── Brain: persistence (CAT_BRAIN_MEMORY in chrome.storage.local) ────── */

    // Daily counters: tabHopsToday + keystroke/copy counts restart on a new day,
    // petCount and the bank count are lifetime numbers.
    function rollBrainDay() {
      const today = todayKey();
      if (brain.day === today) return;
      brain.day = today;
      brain.tabHopsToday = 0;
      brain.keyCount = 0;
      brain.copyCount = 0;
    }

    function saveBrain() {
      if (brain.saveTimer) return; // debounced: one write per burst
      brain.saveTimer = setTimeout(() => {
        brain.saveTimer = null;
        try {
          if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
          const payload = {
            day: brain.day,
            tabHopsToday: brain.tabHopsToday,
            petCount: brain.petCount,
            copyCount: brain.copyCount,
            keyCount: brain.keyCount,
            bankCount: brain.bankCount,
            updatedAt: Date.now(),
          };
          chrome.storage.local.set({ [BRAIN_KEY]: payload }, () => {
            try { void chrome.runtime.lastError; } catch (error) { /* no listener left */ }
          });
        } catch (error) { warnOnce('brain-save', error); }
      }, BRAIN_SAVE_MS);
    }

    function loadBrain() {
      rollBrainDay();
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
          brain.loaded = true;
          return;
        }
        // Only study hosts pay for reading the (large) answer cache; every other
        // tab reuses the count persisted in CAT_BRAIN_MEMORY.
        const keys = [BRAIN_KEY];
        if (STUDY_HOSTS_RE.test(brain.host || '')) keys.push('answerkey_cache');
        chrome.storage.local.get(keys, (data) => {
          try {
            if (!chrome.runtime.lastError && data && data[BRAIN_KEY] && typeof data[BRAIN_KEY] === 'object') {
              const stored = data[BRAIN_KEY];
              brain.day = typeof stored.day === 'string' && stored.day ? stored.day : brain.day;
              brain.tabHopsToday = Number(stored.tabHopsToday) || 0;
              brain.petCount = Number(stored.petCount) || 0;
              brain.copyCount = Number(stored.copyCount) || 0;
              brain.keyCount = Number(stored.keyCount) || 0;
              brain.bankCount = Number(stored.bankCount) || 0;
            }
            // One read buys both the stats and the live stored-answer count.
            const cache = data && data.answerkey_cache;
            if (cache && typeof cache === 'object') brain.bankCount = Object.keys(cache).length;
          } catch (error) { warnOnce('brain-load', error); }
          rollBrainDay();
          brain.loaded = true;
          refreshBankCount();
        });
      } catch (error) {
        warnOnce('brain-load', error);
        brain.loaded = true;
      }
    }

    // Free refresh on study hosts (storage.js already holds the cache in memory);
    // everywhere else the persisted count is reused, so no tab pays for a 100 KB
    // read just to say "I have 240 answers".
    function refreshBankCount() {
      try {
        if (typeof answerKeyCount !== 'function') return;
        if (!STUDY_HOSTS_RE.test(brain.host || '')) return;
        Promise.resolve(answerKeyCount()).then((count) => {
          const next = Number(count) || 0;
          if (next === brain.bankCount) return;
          brain.bankCount = next;
          saveBrain();
        }).catch(() => {});
      } catch (error) { /* storage helpers unavailable */ }
    }

    function recordTabHop() {
      try {
        rollBrainDay();
        brain.tabHopsToday += 1;
        saveBrain();
      } catch (error) { warnOnce('brain-hop', error); }
    }

    function recordPet() {
      try {
        brain.petCount += 1;
        saveBrain();
      } catch (error) { warnOnce('brain-pet', error); }
    }

    /* ── Brain: real-time sensors (privacy-safe, never block the page) ─────── */

    // Typing bursts: COUNT ONLY. The `key` is inspected to decide "printable
    // character?" and thrown away — nothing typed is stored or logged.
    function onBrainKeydown(event) {
      try {
        if (!uiEnabled || !event) return;
        const key = event.key;
        if (typeof key !== 'string' || key.length !== 1) return;
        brain.keyCount += 1;
        brain.typing.keys += 1;
        saveBrain();
        if (brain.typing.timer) return;
        brain.typing.timer = setTimeout(flushTypingBurst, TYPE_BURST_MS);
      } catch (error) { warnOnce('brain-keydown', error); }
    }

    function flushTypingBurst() {
      brain.typing.timer = null;
      const keys = brain.typing.keys;
      brain.typing.keys = 0;
      if (keys < TYPE_BURST_MIN) return;
      if (!catActive() || currentState !== 'idle' || overlayState) return;
      const line = composeCatThought('typing', { keys: String(keys) });
      if (!line) return;
      setBubble(line, true);
      scheduleQuote();
    }

    // Copy / cut: a pure reaction. The clipboard itself is never read.
    function onBrainCopy() {
      try {
        if (!uiEnabled) return;
        brain.copyCount += 1;
        saveBrain();
        if (!catShown()) return;
        markInteraction();
        if (napping) { wakeFromNap(COPY_LINE); return; }
        // Only chatty while idle: a working-state bubble (answer picked, page
        // turning …) is information the user needs more than a joke.
        if (currentState !== 'idle' || overlayState) return;
        setBubble(COPY_LINE, true);
        scheduleQuote();
      } catch (error) { warnOnce('brain-copy', error); }
    }

    // Cursor: throttled sampling drives the pupils (eye tracking) and a fast
    // flick triggers the whisker-wiggle dizzy reaction.
    function onBrainMousemove(event) {
      try {
        if (!uiEnabled || !event || !wrapEl || wrapEl.style.display === 'none') return;
        const sample = brain.cursor;
        const now = Date.now();
        if (sample.at && now - sample.at < CURSOR_SAMPLE_MS) return;
        const x = Number(event.clientX) || 0;
        const y = Number(event.clientY) || 0;
        const dt = sample.at ? now - sample.at : 0;
        if (dt > 0) sample.speed = Math.hypot(x - sample.x, y - sample.y) / (dt / 1000);
        sample.x = x;
        sample.y = y;
        sample.at = now;
        sample.samples += 1;
        updateGaze(x);
        if (sample.speed < CURSOR_DIZZY_SPEED) return;
        if (now - sample.lastDizzyAt < DIZZY_COOLDOWN_MS) return;
        if (!catActive() || currentState !== 'idle' || overlayState) return;
        sample.lastDizzyAt = now;
        dizzyReaction();
      } catch (error) { warnOnce('brain-mousemove', error); }
    }

    // Pupils lean towards the cursor: ±1 sprite pixel, read by drawFace().
    function updateGaze(cursorX) {
      const rect = rectFor(catEl);
      if (!rect) return;
      const offset = cursorX - (rect.left + rect.width / 2);
      gazeLook = Math.abs(offset) < 26 ? 0 : (offset < 0 ? -1 : 1);
    }

    function dizzyReaction() {
      try {
        if (catEl) {
          catEl.classList.remove('qb-dizzy');
          void catEl.offsetWidth; // restart the wobble
          catEl.classList.add('qb-dizzy');
          if (dizzyTimer) clearTimeout(dizzyTimer);
          dizzyTimer = setTimeout(() => {
            dizzyTimer = null;
            if (catEl) catEl.classList.remove('qb-dizzy');
          }, DIZZY_HOLD_MS);
        }
      } catch (error) { warnOnce('brain-dizzy', error); }
      const line = composeCatThought('dizzy');
      if (!line) return;
      setBubble(line, true);
      scheduleQuote();
    }

    // Scroll velocity (px/s), measured between two passive scroll events.
    function onBrainScroll() {
      try {
        if (!uiEnabled) return;
        const now = Date.now();
        const y = Number(window.scrollY || window.pageYOffset || 0);
        const state = brain.scroll;
        if (!state.at) { state.y = y; state.at = now; return; }
        const dt = now - state.at;
        if (dt < 80) return;
        const speed = Math.abs(y - state.y) / (dt / 1000);
        state.y = y;
        state.at = now;
        if (speed < SCROLL_SPEED) return;
        if (now - state.lastAlarmAt < SCROLL_COOLDOWN_MS) return;
        if (!catActive() || currentState !== 'idle' || overlayState) return;
        state.lastAlarmAt = now;
        const line = composeCatThought('scroll');
        if (!line) return;
        setBubble(line, true);
        scheduleQuote();
      } catch (error) { warnOnce('brain-scroll', error); }
    }

    // Boot the brain: stats first, then the passive listeners. Nothing here can
    // click, type, navigate or cancel a page event.
    function startBrain() {
      if (brain.started) return;
      brain.started = true;
      refreshBrainContext();
      loadBrain();
      try {
        document.addEventListener('keydown', onBrainKeydown, { capture: true, passive: true });
        document.addEventListener('copy', onBrainCopy, { capture: true, passive: true });
        document.addEventListener('cut', onBrainCopy, { capture: true, passive: true });
        document.addEventListener('mousemove', onBrainMousemove, { passive: true });
        window.addEventListener('scroll', onBrainScroll, { passive: true });
        window.addEventListener('popstate', refreshBrainContext, { passive: true });
        window.addEventListener('hashchange', refreshBrainContext, { passive: true });
        // SPA route changes rewrite <title>: follow it so the commentary stays live.
        const titleNode = document.querySelector('title');
        if (titleNode && typeof MutationObserver === 'function') {
          new MutationObserver(() => refreshBrainContext())
            .observe(titleNode, { childList: true, characterData: true, subtree: true });
        }
      } catch (error) { warnOnce('brain-sensors', error); }
      // A bank write (harvest / learned answer) updates the count in the bubble.
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            try {
              if (areaName !== 'local' || !changes || !changes.answerkey_cache) return;
              const cache = changes.answerkey_cache.newValue;
              if (!cache || typeof cache !== 'object') return;
              brain.bankCount = Object.keys(cache).length;
              saveBrain();
            } catch (error) { warnOnce('brain-bank-change', error); }
          });
        }
      } catch (error) { /* storage events unavailable */ }
    }

    /* ── Catnap: "doing cat things" while idle ────────────────────────────── */

    function catShown() {
      return !!wrapEl && wrapEl.style.display !== 'none';
    }

    // Awake *and* actually on screen: roaming, chatter and naps only run then.
    function catOnScreen() {
      if (!booted || !catShown()) return false;
      let visible = true;
      try { visible = document.visibilityState === 'visible'; } catch (error) { /* assume */ }
      return visible;
    }

    function catActive() {
      return !napping && catOnScreen();
    }

    function markInteraction() {
      lastInteractionAt = Date.now();
    }

    // Polled every NAP_TICK_MS: 35 s of stillness on an idle cat → catnap.
    function napTick() {
      if (!booted || napping || drag || overlayState) return;
      if (currentState !== 'idle' || !catOnScreen()) return;
      if (Date.now() - lastInteractionAt < NAP_AFTER_MS) return;
      enterNap();
    }

    function enterNap() {
      if (napping || !wrapEl || !bubbleEl) return;
      napping = true;
      stopSquadHangout(); // the squad goes home before the catnap
      if (roamTimer) { clearTimeout(roamTimer); roamTimer = null; }
      if (quoteTimer) { clearTimeout(quoteTimer); quoteTimer = null; }
      wrapEl.classList.add(NAP_CLASS);
      setBubble(pickCatLine(assignedCatId, 'nap') || pickFreshLine(NAP_LINES), true);
      scheduleNapQuote();
      refreshSquadBadge();
    }

    // Sleepy mumbling every 11–15 s: gentle proof the cat is still there.
    function scheduleNapQuote() {
      if (napQuoteTimer) clearTimeout(napQuoteTimer);
      napQuoteTimer = setTimeout(() => {
        napQuoteTimer = null;
        if (!napping) return;
        if (catOnScreen()) setBubble(pickCatLine(assignedCatId, 'nap') || pickFreshLine(NAP_LINES), true);
        scheduleNapQuote();
      }, NAP_QUOTE_MIN_MS + Math.random() * NAP_QUOTE_SPREAD_MS);
    }

    // Any click / quiz start / harvest wakes him instantly. `line` is optional so
    // a state change can wake him silently while its own bubble speaks.
    function wakeFromNap(line) {
      if (!napping) {
        if (line) setBubble(line, true);
        return;
      }
      napping = false;
      lastInteractionAt = Date.now();
      if (napQuoteTimer) { clearTimeout(napQuoteTimer); napQuoteTimer = null; }
      if (wrapEl) wrapEl.classList.remove(NAP_CLASS);
      if (line) setBubble(line, true);
      else if (bubbleEl) bubbleEl.classList.remove('qb-bubble-visible');
      if (currentState === 'idle' && catShown()) scheduleQuote();
      refreshSquadBadge();
    }

    /* ── Squad wiring: storage, visibility, heartbeat, first claim ─────────── */

    function watchPresenceChanges() {
      if (squadWatched) return;
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
        chrome.storage.onChanged.addListener((changes, areaName) => {
          try {
            if (areaName !== 'local' || !changes || !changes[SQUAD_KEY]) return;
            const previousOwner = squad.mochi.tabId;
            const wasBusy = otherTabIsBusy();
            squad = normalizeSquad(changes[SQUAD_KEY].newValue);
            squadReady = true;
            applyPresence(); // hide + pill, or reveal the cat assigned to this tab
            if (otherTabIsBusy()) {
              if (hangout.active) stopSquadHangout();
              return;
            }
            if (wasBusy) maybeFollowIdle(previousOwner); // idle hand-off → follow it
          } catch (error) {
            warnOnce('squad-change', error);
          }
        });
        squadWatched = true;
      } catch (error) {
        warnOnce('squad-watch', error);
      }
    }

    // While this tab works it re-stamps its slot so the other tabs keep honouring
    // the claim and a crashed tab frees its cat after PRESENCE_STALE_MS. Idle
    // slots are deliberately left to go stale: focus decides who inherits Mochi.
    function startPresenceHeartbeat() {
      if (squadHeartbeat) return;
      squadHeartbeat = setInterval(() => {
        try {
          if (!squadEnabled || myTabId == null) return;
          const id = myCatId && CATS[myCatId] ? myCatId : null;
          if (!id || !squad[id] || squad[id].tabId !== myTabId) return;
          if (myTask === 'idle') return;
          const next = { ...squad };
          next[id] = { ...next[id], task: myTask || next[id].task, url: pageUrl(), workLockUntil: _activeWorkUntil, updatedAt: Date.now() };
          squad = next;
          writeSquad(next);
        } catch (error) {
          warnOnce('squad-heartbeat', error);
        }
      }, PRESENCE_HEARTBEAT_MS);
    }

    function onVisibilityChange() {
      try {
        if (document.visibilityState === 'visible') {
          markInteraction();
          wakeFromNap(null); // coming back to the tab gets him up
          recordTabHop();    // local brain stat: how many tabs today
          if (!uiEnabled) return;
          // Switching tabs must never steal the cat while a quiz run or a harvest
          // is still going on elsewhere — not even during its idle gap between two
          // questions. That tab keeps #qb-mascot-wrap; this one stays hidden and
          // shows the busy pill until the run/harvest finishes.
          if (otherTabIsBusy()) { applyPresence(); return; }
          claimIdle(true);   // Rule B: the idle cat follows the active tab
        }
        applyPresence();
      } catch (error) {
        warnOnce('visibility', error);
      }
    }

    // Same idea for a second window: clicking into it focuses the document
    // without changing visibility, and the cat should hop over with the user —
    // unless another tab is still working or holds a live work lock.
    function onTabFocus() {
      try {
        markInteraction();
        if (!uiEnabled) return;
        if (otherTabIsBusy()) { applyPresence(); return; }
        claimIdle(true);
        applyPresence();
      } catch (error) {
        warnOnce('focus', error);
      }
    }

    // Boot: learn this tab's id, read the shared squad, then show/hide its cat.
    // If the worker never answers we degrade to a one-cat-per-tab mascot instead
    // of hiding the cats forever.
    function initPresence() {
      applyPresence(); // hidden while the assignment is still unknown
      watchPresenceChanges();
      setTimeout(() => {
        if (squadReady) return;
        squadReady = true;
        applyPresence();
      }, PRESENCE_INIT_TIMEOUT_MS);
      requestTabId((tabId) => {
        myTabId = tabId;
        squadEnabled = typeof tabId === 'number';
        readSquad((stored) => {
          squad = normalizeSquad(stored);
          squadReady = true;
          startPresenceHeartbeat();
          if (!squadEnabled) { applyPresence(); return; }
          // Boot may land mid-review (score page): honour that working state
          // instead of quietly claiming an idle cat. Otherwise appear quietly,
          // no greeting on a plain page load.
          if (BUSY_LABELS[currentState]) claimBusy(currentState);
          else claimIdle(false);
          applyPresence();
        });
      });
    }

    /* ── DOM: draggable cat + wrapped speech bubble ───────────────────────── */

    function mount() {
      if (wrapEl && wrapEl.isConnected) return;
      injectStyles();

      wrapEl = document.createElement('div');
      wrapEl.id = WRAP_ID;

      bubbleEl = document.createElement('div');
      bubbleEl.id = BUBBLE_ID;

      catEl = document.createElement('canvas');
      catEl.className = IMG_CLASS;
      catEl.width = CANVAS;
      catEl.height = CANVAS;
      catEl.setAttribute('role', 'img');
      catEl.setAttribute('aria-label', 'Quiz bot pixel cat Mochi — Orange Tabby, Hyper Speedrunner');
      catEl.dataset.state = 'idle';
      catEl.dataset.cat = 'mochi';
      startPixelEngine();
      applyAsset('idle');
      catEl.addEventListener('click', onMascotClick);
      catEl.addEventListener('mousedown', onDragStart);
      catEl.addEventListener('dblclick', onMascotDoubleClick);
      catEl.addEventListener('mouseenter', onMascotHover, { passive: true });

      // Tiny hover badge: "Squad (1/3)" → click summons / dismisses the squad.
      squadBadgeEl = document.createElement('div');
      squadBadgeEl.className = SQUAD_BADGE_CLASS + ' ' + SQUAD_BADGE_HIDDEN;
      squadBadgeEl.setAttribute('role', 'button');
      squadBadgeEl.setAttribute('aria-label', 'Summon the cat squad');
      squadBadgeEl.textContent = 'Squad (1/3)';
      squadBadgeEl.addEventListener('click', onSquadBadgeClick);

      wrapEl.appendChild(bubbleEl);
      wrapEl.appendChild(catEl);
      wrapEl.appendChild(squadBadgeEl);

      // Paint the very first frame already parked bottom-right (no animation).
      const start = safeSpot(window.innerWidth - SIZE - 20, window.innerHeight - SIZE - 20);
      pos = { left: start.left, top: start.top };
      wrapEl.style.left = Math.round(start.left) + 'px';
      wrapEl.style.top = Math.round(start.top) + 'px';
      // Hidden until the shared CAT_SQUAD map says this tab owns a cat — that is
      // what keeps exactly one cat per working tab across all tabs.
      wrapEl.style.display = 'none';

      (document.body || document.documentElement).appendChild(wrapEl);
      alignBubble();

      // Status pill shown on the tabs that do NOT own one of the working cats.
      if (!pillEl || !pillEl.isConnected) {
        pillEl = document.createElement('div');
        pillEl.id = PILL_ID;
        pillEl.textContent = PILL_TEXT;
        (document.body || document.documentElement).appendChild(pillEl);
      }

      refreshSquadBadge();

      document.addEventListener('mousemove', onDragMove, { passive: true });
      document.addEventListener('mouseup', onDragEnd, true);
      window.addEventListener('resize', onWindowResize, { passive: true });
    }

    // Single click: a playful petting reaction. The same click handler swallows
    // the second click of a double click (PET_COOLDOWN_MS) so the cheer takes over.
    function onMascotClick() {
      if (Date.now() < suppressClickUntil) return;
      // Clicking a sleeping cat wakes him up instead of petting him.
      if (napping) { markInteraction(); wakeFromNap(WAKE_LINE); return; }
      // Triple-click (or the hover badge) toggles the Summon Squad hangout.
      if (noteSquadTap()) return;
      const now = Date.now();
      if (now - lastPetAt < PET_COOLDOWN_MS) return;
      lastPetAt = now;
      markInteraction();
      recordPet(); // local brain stat: how many pets so far
      try {
        if (currentState === 'idle') {
          const line = composeCatThought('pet') || pickCatLine(assignedCatId, 'pet') || pickFreshLine(PET_LINES);
          if (line) setBubble(line, true);
          scheduleQuote();
          return;
        }
        if (currentState === 'thinking') { setBubble(pickCatLine(assignedCatId, 'thinking') || pickFreshLine(THINKING_LINES), true); return; }
        if (currentState === 'answering') { setBubble(SPEECH.answering, true); return; }
        if (currentState === 'clicking') { setBubble(pickCatLine(assignedCatId, 'clicking') || pickFreshLine(CLICKING_LINES), true); return; }
        if (currentState === 'nextpage') { setBubble(SPEECH.nextpage, true); return; }
        if (currentState === 'harvesting') { setBubble(SPEECH.harvesting, true); return; }
        if (currentState === 'typing') { setBubble(pickCatLine(assignedCatId, 'typing') || pickFreshLine(TYPING_LINES), true); return; }
        if (lastScoreLine) { setBubble(lastScoreLine, true); return; }
        setBubble(SPEECH.review, true);
      } catch (error) {
        warnOnce('click', error);
      }
    }

    // Double click: 1.8 s of the answering cheer, then straight back to whatever
    // the state machine wants (idle / review / an action pose).
    function onMascotDoubleClick() {
      if (Date.now() < suppressClickUntil) return;
      try {
        markInteraction();
        wakeFromNap(null); // a cheer never happens from inside a catnap
        // Double-click chat: the local brain composes a fresh hype line, then the
        // active cat's own hype voice.
        const line = composeCatThought('hype') || pickCatLine(assignedCatId, 'hype') || pickFreshLine(HYPE_LINES);
        startOverlay('answering', CHEER_MS, line);
      } catch (error) {
        warnOnce('double-click', error);
      }
    }

    // Hover: now and then a subtle hint — at most once per HOVER_COOLDOWN_MS and
    // only while idling, so it never talks over the bot's action bubbles.
    function onMascotHover() {
      try {
        if (!booted || drag || overlayState) return;
        markInteraction();
        if (napping) return; // never talk over a catnap
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
      markInteraction();
      const rect = rectFor(wrapEl) || { left: pos.left, top: pos.top };
      drag = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        // A plain click must still be able to show the "Yawn~" wake line, so the
        // catnap only ends once the cat is actually being carried around.
        napAtStart: napping,
      };
      wrapEl.classList.add('qb-dragging');
    }

    function onDragMove(event) {
      if (!drag || !wrapEl) return;
      const travelled = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (!drag.moved && travelled < 4) return;
      drag.moved = true;
      if (drag.napAtStart) wakeFromNap(null); // carrying him around wakes him
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
      if (!catActive()) return; // hidden tab or catnap: chatter resumes on reveal
      if (quoteTimer) clearTimeout(quoteTimer);
      quoteTimer = setTimeout(() => {
        quoteTimer = null;
        showRandomQuote();
      }, QUOTE_MIN_MS + Math.random() * QUOTE_SPREAD_MS);
    }

    function showRandomQuote() {
      if (!bubbleEl || currentState !== 'idle' || !catActive()) return;
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
      const state = isKnownState(next) ? next : 'idle';
      if (!catEl || !bubbleEl) return;
      const opts = options || {};
      const changed = currentState !== state;
      currentState = state;
      if (changed) syncPresenceForState(state);

      if (changed) {
        if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (reviewTimer) { clearTimeout(reviewTimer); reviewTimer = null; }
        if (harvestTimer) { clearTimeout(harvestTimer); harvestTimer = null; }
        if (quoteTimer) { clearTimeout(quoteTimer); quoteTimer = null; }
        if (roamTimer) { clearTimeout(roamTimer); roamTimer = null; }
        // A queued action only survives the "AHA!!" reaction it was queued for.
        if (state !== 'answering') pendingAction = null;

        if (catEl.dataset.state !== state) {
          applyAsset(state);
        }
        catEl.classList.remove('qb-hop', 'qb-review');
        if (state === 'answering' || state === 'nextpage' || state === 'harvesting' || ACTION_STATES.includes(state)) {
          void catEl.offsetWidth; // restart the hop animation
          catEl.classList.add('qb-hop');
        } else if (state === 'review') {
          catEl.classList.add('qb-review');
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
        setBubble(pickCatLine(assignedCatId, 'thinking') || pickFreshLine(READING_LINES), true);
        if (thinkTimer) clearTimeout(thinkTimer);
        thinkTimer = setTimeout(() => {
          thinkTimer = null;
          if (currentState === 'thinking') {
            setBubble(pickCatLine(assignedCatId, 'thinking') || pickFreshLine(THINKING_LINES), true);
          }
        }, READING_HOLD_MS);
        return;
      }

      if (state === 'answering') {
        // Brief "AHA!! Found it! ✨" reaction, then the matching action animation.
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
        setBubble(pickCatLine(assignedCatId, state === 'typing' ? 'typing' : 'clicking')
          || pickFreshLine(state === 'typing' ? TYPING_LINES : CLICKING_LINES), true);
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
        setBubble(pickCatLine(assignedCatId, 'harvest') || SPEECH.harvesting, true);
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

      // review — the visual scanner owns the bubble while it is running.
      if (reviewScan.active) { setBubble(reviewScanBubble(), true); return; }
      setBubble(pickCatLine(assignedCatId, 'review') || SPEECH.review, true);
      if (reviewTimer) clearTimeout(reviewTimer);
      reviewTimer = setTimeout(() => {
        reviewTimer = null;
        if (currentState !== 'review') return;
        if (reviewScan.active) return; // scan counts own the bubble
        if (announceReviewScore()) return; // e.g. "SHEESH!! High score!! ..."
        if (scoreAnnounced) return; // celebration already shown by an earlier pass
        setBubble(SPEECH.learned(countRight()), true);
      }, REVIEW_COUNT_DELAY_MS);
    }

    function refreshReviewCount() {
      if (currentState !== 'review') return;
      if (reviewScan.active) return; // the scan bubble already shows the count
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
      if (currentState !== 'idle' || !catActive()) return;
      roamTimer = setTimeout(() => {
        roamTimer = null;
        roamOnce();
      }, ROAM_MIN_MS + Math.random() * ROAM_SPREAD_MS);
    }

    function roamOnce() {
      if (currentState !== 'idle' || drag) { scheduleRoam(); return; }
      if (!catActive()) return; // hidden or napping: roaming resumes on reveal
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
    // pose (`clicking` or `typing`) parked beside the control that was answered.
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

    // Second half of an answer: play the clicking pose right on the exact radio
    // dot / checkbox the bot ticked (then hop beside the Next page button), or
    // the typing pose beside the text box it filled in.
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
      // clicking: land on the *exact* dot / checkbox, not just its row.
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
      // While the visual scanner is running it owns the cat's position.
      if (reviewScan.active) return;
      if (alreadyReview && reviewParked) return;
      const summary = document.querySelector('.quizreviewsummary, #quizreviewsummary, .reviewsummary, .quizreview, .totalgrade, .grade');
      const spot = beside(rectFor(summary));
      if (spot) {
        moveTo(spot.left, spot.top);
        reviewParked = true;
      }
    }

    /* ── Visual review scanner (glasses + glide + live counts) ────────────── */

    // The bubble line the user sees while content.js scans: the live scan count
    // followed by the GitHub sync badge ("Scanned! Saved 12 answers (4 new) •
    // GitHub ✓").
    function reviewScanBubble() {
      if (reviewScan.right == null) return 'Checking every answer... 👓';
      let text = 'Scanned! Saved ' + reviewScan.right + ' answers';
      if (reviewScan.newCount != null) text += ' (' + reviewScan.newCount + ' new)';
      if (reviewScan.github) text += ' • ' + reviewScan.github;
      return text;
    }

    // Every visible .que block, top to bottom: the scanner walks this list.
    function reviewScanBlocks() {
      try {
        return Array.from(document.querySelectorAll('.que'))
          .filter((que) => {
            const rect = rectFor(que);
            return !!rect && rect.height > 40;
          })
          .sort((a, b) => {
            const ra = rectFor(a);
            const rb = rectFor(b);
            return (ra ? ra.top : 0) - (rb ? rb.top : 0);
          });
      } catch (error) {
        return [];
      }
    }

    // Glide down to the next question block, glasses on, bubble live.
    function reviewScanStep() {
      if (!reviewScan.active) return;
      const blocks = reviewScanBlocks();
      if (!blocks.length) return;
      const block = blocks[reviewScan.index % blocks.length];
      reviewScan.index += 1;
      const spot = beside(rectFor(block));
      if (spot) {
        moveTo(spot.left, spot.top);
        faceRight();
      }
      if (reviewScan.right == null) setBubble(reviewScanBubble(), true);
    }

    function stopReviewScan() {
      reviewScan.active = false;
      if (reviewScan.timer) { clearInterval(reviewScan.timer); reviewScan.timer = null; }
      if (reviewScan.stopTimer) { clearTimeout(reviewScan.stopTimer); reviewScan.stopTimer = null; }
    }

    function scheduleReviewScanStop(ms) {
      if (reviewScan.stopTimer) clearTimeout(reviewScan.stopTimer);
      reviewScan.stopTimer = setTimeout(() => {
        reviewScan.stopTimer = null;
        stopReviewScan();
      }, ms);
    }

    function enterReviewScan() {
      if (reviewScan.active) {
        setBubble(reviewScanBubble(), true);
        return;
      }
      reviewScan.active = true;
      reviewScan.startedAt = Date.now();
      reviewScan.right = null;
      reviewScan.newCount = null;
      reviewScan.github = '';
      reviewScan.index = 0;
      if (reviewScan.timer) clearInterval(reviewScan.timer);
      reviewScan.timer = setInterval(() => {
        try { reviewScanStep(); } catch (error) { warnOnce('review-glide', error); }
      }, REVIEW_GLIDE_MS);
      scheduleReviewScanStop(REVIEW_SCAN_MAX_MS);
      reviewParked = false;
      setState('review', { restart: true });
      setBubble(reviewScanBubble(), true);
      reviewScanStep();
    }

    // "Review scan: verified & saved 12 answers (4 new)" → live bubble counts.
    function noteReviewScanResult(right, newCount) {
      if (!reviewScan.active) enterReviewScan();
      reviewScan.right = Math.max(0, Number(right) || 0);
      reviewScan.newCount = newCount == null ? null : Math.max(0, Number(newCount) || 0);
      setBubble(reviewScanBubble(), true);
      scheduleReviewScanStop(5000);
    }

    // "GitHub sync: +4 pushed ✓" → append the sync badge to the same bubble.
    // Failures/skips leave the bubble clean (content.js already warns in the HUD).
    function noteGitHubSync(ok, pushed) {
      if (!reviewScan.active) return;
      reviewScan.github = ok ? (pushed > 0 ? 'GitHub +' + pushed + ' ✓' : 'GitHub ✓') : '';
      setBubble(reviewScanBubble(), true);
      if (ok) scheduleReviewScanStop(3500);
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
        wakeFromNap(null); // a low-timer alarm never fires from inside a catnap
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
      if (reviewScan.active) return false; // scanner counts own the bubble
      if (scoreAnnounced) return false;
      const percent = reviewPercent();
      if (percent == null) return false;
      scoreAnnounced = true;
      const line = percent >= 90
        ? pickFreshLine(SCORE_HIGH_LINES)
        : (percent >= 75 ? pickFreshLine(SCORE_PASS_LINES) : pickFreshLine(SCORE_LOW_LINES));
      if (line) { lastScoreLine = line; setBubble(line, true); } // remember + show
      if (catEl) {
        catEl.classList.remove('qb-hop');
        void catEl.offsetWidth;
        catEl.classList.add('qb-hop');
      }
      return true;
    }

    /* ── Reconciliation loop (poll): never invents a click, only state ────── */

    function refresh() {
      if (!booted || !wrapEl) return;
      try { presenceTick(); } catch (error) { warnOnce('presence-tick', error); }
      if (isReviewPage()) {
        enterReview();
        if (!scoreAnnounced) announceReviewScore(); // grade table may load late
        return;
      }
      if (currentState === 'review') { reviewParked = false; setState('idle'); }
      if (reviewScan.active) stopReviewScan(); // navigated away from the review page
      // Hold the "AHA!!" reaction and the clicking / typing action pose.
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

    // Which action pose a HUD line implies:
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

      // Session work lock first: it must see every line, including the harvest
      // summaries that the harvest narration swallows right below.
      noteWorkLockLine(line);

      // Harvest progress owns the cat first: these lines must never fall through
      // to the answer classifier ("3 matched card(s)" would look like a click).
      if (noteHarvestLine(line)) return;

      // Review scanner: "Review scan: checking all answers..." puts the reading
      // glasses on and starts the glide; the result / sync lines update the live
      // bubble. These checks run before the review-page branch below so the
      // counts are never swallowed by the generic score narration.
      if (/review scan:\s*checking all answers/.test(line)) { enterReviewScan(); return; }
      const scanResult = line.match(/review scan:\s*verified & saved\s+(\d+)\s+answers?(?:\s*\((\d+)\s+new\))?/);
      if (scanResult) {
        noteReviewScanResult(Number(scanResult[1]), scanResult[2] == null ? null : Number(scanResult[2]));
        return;
      }
      if (/^review scan:/.test(line)) {
        if (reviewScan.active) scheduleReviewScanStop(2500); // "no questions to check"
        return;
      }
      if (/^github sync:/.test(line)) {
        const pushed = line.match(/\+\s*(\d+)/);
        noteGitHubSync(/✓/.test(line), pushed ? Number(pushed[1]) : 0);
        return;
      }

      if (isReviewPage() || /review page:/.test(line)) {
        enterReview();
        if (/learned\s+\d+\s+right/.test(line)) refreshReviewCount();
        return;
      }
      if (/^\s*q:|^\s*question:/.test(line)) { noteQuestion(); return; }

      const actionKind = classifyLogAction(line);
      if (actionKind) {
        // `Typed:` → typing, `Selected:` / `Matched:` / `Ticked` / `Option N`
        // / `Dropdown N` / `Tier N` → clicking. An ambiguous answer line falls
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

      // Claim/release the one shared cat (hidden until the record says this tab
      // owns it), then start the catnap watchdog.
      try {
        initPresence();
      } catch (error) {
        warnOnce('presence-boot', error);
      }

      // Popup switch: the cat (and the busy pill) hide or come back instantly on
      // every open tab, no reload. The local brain boots its passive sensors.
      try { watchUiEnabled(); } catch (error) { warnOnce('ui-toggle-boot', error); }
      try { startBrain(); } catch (error) { warnOnce('brain-boot', error); }

      try {
        lastInteractionAt = Date.now();
        document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
        window.addEventListener('focus', onTabFocus, { passive: true });
        // "The user is here" bookkeeping only: passive listeners that just stamp
        // a timestamp, so nothing about page behaviour changes.
        const interactionEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
        interactionEvents.forEach((name) => {
          document.addEventListener(name, markInteraction, { capture: true, passive: true });
        });
        napTickTimer = setInterval(() => {
          try { napTick(); } catch (error) { warnOnce('nap-tick', error); }
        }, NAP_TICK_MS);
      } catch (error) {
        warnOnce('nap-boot', error);
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
        if (isKnownState(next)) setState(next);
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
