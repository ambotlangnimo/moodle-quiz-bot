'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { ROOT, loadScripts, plain } = require('./helpers');

function createMinimalDocGlobals() {
  const noop = () => {};
  const fakeEl = () => ({
    id: '',
    className: '',
    style: { cssText: '' },
    children: [],
    childNodes: [],
    isConnected: false,
    textContent: '',
    innerText: '',
    setAttribute: noop,
    getAttribute: () => '',
    append: noop,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    classList: { add: noop, remove: noop, toggle: noop },
    attachShadow: () => fakeEl(),
    getElementById: () => null,
  });
  return {
    location: { hostname: 'quizlet.com', pathname: '/set/1', href: 'https://quizlet.com/set/1', origin: 'https://quizlet.com', search: '' },
    document: {
      readyState: 'loading',
      body: fakeEl(),
      documentElement: fakeEl(),
      addEventListener: noop,
      getElementById: () => null,
      createElement: () => fakeEl(),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    sessionStorage: { getItem: () => null, setItem: noop },
  };
}

test('content.js matching cleanup, grade parsing, and 2-row swap deduction work', () => {
  const { ctx } = loadScripts(['config.js', 'storage.js', 'content.js'], {
    globals: createMinimalDocGlobals(),
  });

  assert.equal(ctx.cleanSubStatement('1. Protocol that sends email — Choose...'), 'Protocol that sends email —');
  assert.equal(ctx.cleanSubStatement('123'), '');

  // Select answered check rejects placeholder option index 0 and "Choose..."
  assert.equal(ctx.isSelectAnswerChosen({ disabled: false, selectedIndex: 0, value: '0', options: [{ text: 'Choose...' }] }), false);
  assert.equal(ctx.isSelectAnswerChosen({ disabled: false, selectedIndex: 1, value: '2', options: [{ text: 'Choose...' }, { text: 'SMTP' }] }), true);

  // parseGradeFromReview extracts numeric marks and determines correctness
  const mockScope = {
    querySelectorAll: () => [{ innerText: 'Mark 1.00 out of 1.00' }],
    querySelector: () => null,
    innerText: 'Mark 1.00 out of 1.00',
    className: 'que multichoice correct',
  };
  assert.deepEqual(plain(ctx.parseGradeFromReview(mockScope)), { earned: 1, max: 1, correct: true });

  const mockWrong = {
    querySelectorAll: () => [{ innerText: 'Mark 0.00 out of 1.00' }],
    querySelector: () => null,
    innerText: 'Mark 0.00 out of 1.00',
    className: 'que multichoice incorrect',
  };
  assert.deepEqual(plain(ctx.parseGradeFromReview(mockWrong)), { earned: 0, max: 1, correct: false });
});

test('universal-harvester.js parses highlighted Q&A blocks and rejects UI noise', () => {
  const { ctx } = loadScripts(['config.js', 'storage.js', 'universal-harvester.js'], {
    globals: createMinimalDocGlobals(),
  });
  const h = ctx.__qbHarvesterInternals;
  assert.ok(h, 'Harvester test hook should be exposed');

  const pairs = h.parseHighlightedSelection(`
    1. Which layer of the OSI model handles routing?
    Correct Answer: Network Layer

    2. What port does HTTPS use by default?
    ✅ 443
  `);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].question, 'Which layer of the OSI model handles routing?');
  assert.equal(pairs[0].answer, 'Network Layer');
  assert.equal(pairs[0].verified, true);
  assert.equal(pairs[1].answer, '443');
  assert.equal(pairs[1].verified, true);

  // UI stop words must be rejected
  assert.equal(h.makePair('What is TCP?', 'Show Answer', false), null);
});

test('build-userscript.js produces a valid, deduplicated userscript bundle', () => {
  cp.execFileSync(process.execPath, [path.join(ROOT, 'build-userscript.js')], { cwd: ROOT });
  const bundlePath = path.join(ROOT, 'moodle-quiz-bot.user.js');
  cp.execFileSync(process.execPath, ['--check', bundlePath]);

  const bundle = fs.readFileSync(bundlePath, 'utf8');
  const defaultsCount = (bundle.match(/const DEFAULTS = Object\.freeze\(/g) || []).length;
  assert.equal(defaultsCount, 1, 'config.js must be bundled once, not duplicated');

  const storageCount = (bundle.match(/const STORAGE_KEYS = \{/g) || []).length;
  assert.equal(storageCount, 1, 'storage.js must be bundled once, not duplicated');

  // Verify parity actions exist in the generated userscript
  for (const action of ['getAnswerKey', 'searchWeb', 'resolveCustomModel', 'fetchImageBase64', 'checkOllama']) {
    assert.ok(bundle.includes(`'${action}'`), `Userscript shim must handle ${action}`);
  }
});
