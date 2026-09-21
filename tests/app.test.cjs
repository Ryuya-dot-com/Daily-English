// Exercise real application logic with a controlled clock/audio/DOM, without a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'docs/data.json'), 'utf8'));
const code = fs.readFileSync(path.join(root, 'docs/app.js'), 'utf8');
const flush = () => new Promise(setImmediate);

async function app(settings = {}) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.handlers = {}; this.hidden = false; this.checked = false; this.textContent = ''; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, callback) { this.handlers[key] = callback; }
    focus() {}
  }
  const elements = Object.fromEntries([...fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map((m) => [m[1], new Element()]));
  let now = 0, id = 0, mode = 'ok', release;
  const preferences = { order: 'ordered', mode: 'challenge', ...settings };
  const frames = new Map(), timers = new Map(), sources = [];
  const document = { hidden: false, getElementById: (key) => elements[key], createElement: () => new Element(),
    querySelector: (selector) => ({ value: preferences[selector.match(/name="([^"]+)"/)[1]] }),
    addEventListener: (key, cb) => { document[key] = cb; } };
  class AudioContext {
    state = 'running';
    destination = {};
    async resume() { this.state = 'running'; }
    async decodeAudioData() { return {}; }
    createBufferSource() {
      const node = { connect() {}, disconnect() {}, start() { node.started = true; }, stop() { node.stopped = true; }, finish() { node.onended?.(); } };
      sources.push(node); return node;
    }
  }
  const context = vm.createContext({ document, window: { AudioContext }, console: { error() {} },
    performance: { now: () => now }, AbortSignal,
    requestAnimationFrame: (cb) => { frames.set(++id, cb); return id; },
    cancelAnimationFrame: (key) => frames.delete(key),
    setTimeout: (cb, delay) => { timers.set(++id, { cb, at: now + delay }); return id; },
    clearTimeout: (key) => timers.delete(key),
    fetch: async (url) => {
      if (url === 'data.json') return { ok: true, json: async () => data };
      if (mode === 'fail') throw new Error('Offline');
      if (mode === 'hold') await new Promise((resolve) => { release = resolve; });
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
  });
  vm.runInContext(code, context);
  await flush();
  return { elements, sources, document, preferences,
    run: (code) => vm.runInContext(code, context),
    mode: (value) => { mode = value; }, release: () => release(),
    async step(ms) {
      now += ms;
      const current = [...frames]; frames.clear();
      for (const [, cb] of current) cb(now);
      for (const [key, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(key); timer.cb(); }
      }
      await flush();
    },
  };
}

(async () => {
  let a = await app();
  assert.equal(a.elements.sections.children.length, 4);
  await a.run('start()'); await a.step(0);
  assert.equal(a.elements.japanese.textContent, data.sections[0].sentences[0].japanese);
  assert.equal(a.elements.english.textContent, '');
  await a.step(2999);
  assert.equal(a.run('phase'), 'thinking'); assert.equal(a.sources.length, 0);
  await a.step(1);
  assert.equal(a.run('phase'), 'answer'); assert.equal(a.sources.length, 1);
  assert.equal(a.elements.english.textContent, data.sections[0].sentences[0].english);
  assert.equal(a.elements.timer.attrs['aria-valuenow'], '0.0');
  a.sources.at(-1).finish(); await a.step(10000);
  assert.equal(a.run('index'), 0, 'Manual mode waits for Next');
  a.run('next()'); await flush(); await a.step(0);
  await a.step(1000); a.run('pause()'); await a.step(5000);
  assert.equal(a.run('remaining'), 2000);
  await a.run('resume()'); await a.step(0); await a.step(1999);
  assert.equal(a.run('phase'), 'thinking'); await a.step(1);
  assert.equal(a.run('phase'), 'answer');
  a.document.hidden = true; a.document.visibilitychange();
  assert.equal(a.run('phase'), 'paused');
  assert.equal(a.sources.at(-1).stopped, true);
  a.run('home()'); await a.step(20000); assert.equal(a.run('phase'), 'setup');

  a = await app(); a.elements.auto.checked = true;
  await a.run('start()'); await a.step(0); await a.step(3000);
  await a.step(5000); assert.equal(a.run('index'), 0, 'Wait for actual audio end');
  a.sources.at(-1).finish(); await a.step(1999); assert.equal(a.run('index'), 0);
  a.run('playAnswer()'); await a.step(5000); assert.equal(a.run('index'), 0, 'Replay cancels auto advance');
  a.sources.at(-1).finish(); await a.step(2000); assert.equal(a.run('index'), 1);
  await a.step(0); await a.step(3000);
  a.sources.at(-1).finish(); a.run('next()'); await a.step(2000);
  assert.equal(a.run('index'), 2, 'Manual next cancels old auto timer');

  a = await app(); a.mode('fail'); await a.run('start()');
  assert.equal(a.run('phase'), 'error'); assert.equal(a.sources.length, 0);
  a.mode('ok'); await a.run('showQuestion()'); await a.step(0);
  assert.equal(a.run('phase'), 'thinking');
  a.run('home()'); a.mode('hold'); const pending = a.run('start()'); await flush();
  a.run('home()'); a.mode('ok'); a.release(); await pending;
  assert.equal(a.run('phase'), 'setup', 'A stale fetch must not reopen practice');

  a = await app(); a.run('selectSection(sections[3])'); await a.run('start()');
  assert.equal(a.run('queue.length'), 13);
  assert.deepEqual(Array.from(a.run('shuffle(queue).map(x => x.id).sort()')), data.sections[3].sentences.map(x => x.id).sort());
  a.run('index = queue.length - 1'); await a.run('showQuestion()'); await a.step(0); await a.step(3000);
  a.run('next()'); assert.equal(a.run('phase'), 'complete');
  assert.match(a.elements['complete-detail'].textContent, /13文/);
  await a.run('start()'); assert.equal(a.run('index'), 0);

  a = await app({ mode: 'study' }); await a.run('start()');
  assert.equal(a.run('phase'), 'answer', 'Study shows English immediately');
  assert.equal(a.elements.japanese.textContent, data.sections[0].sentences[0].japanese);
  assert.equal(a.elements.english.textContent, data.sections[0].sentences[0].english);
  assert.equal(a.elements.answer.hidden, false);
  assert.equal(a.elements.timer.hidden, true);
  assert.equal(a.elements['timer-number'].hidden, true);
  assert.equal(a.sources.length, 1, 'Study plays audio without waiting three seconds');
  a.sources.at(-1).finish(); await a.step(60000);
  assert.equal(a.run('index'), 0, 'Study has no time limit');
  assert.equal(a.sources.length, 1, 'No latent countdown replays the answer');
  await a.elements.replay.handlers.click(); assert.equal(a.sources.length, 2);
  a.run('pause()'); assert.equal(a.elements.answer.hidden, true);
  await a.run('resume()'); assert.equal(a.elements.answer.hidden, false);
  assert.equal(a.run('phase'), 'answer');
  a.run('next()'); await flush();
  assert.equal(a.elements.english.textContent, data.sections[0].sentences[1].english);
  a.run('home()'); a.mode('hold'); const studyPending = a.run('start()'); await flush();
  const beforeBackgroundLoad = a.sources.length;
  a.document.hidden = true; a.mode('ok'); a.release(); await studyPending;
  assert.equal(a.run('phase'), 'paused', 'Background loading cannot start study audio');
  assert.equal(a.sources.length, beforeBackgroundLoad);
  a.document.hidden = false; await a.run('resume()');
  assert.equal(a.sources.length, beforeBackgroundLoad + 1);
  a.run('home()'); a.preferences.mode = 'challenge'; await a.run('start()'); await a.step(0);
  assert.equal(a.elements.timer.hidden, false, 'Changing back restores the timer');
  assert.equal(a.elements['timer-number'].hidden, false);
  assert.equal(a.elements.answer.hidden, true);
  await a.step(2999); assert.equal(a.run('phase'), 'thinking');
  await a.step(1); assert.equal(a.run('phase'), 'answer');
  a.run('home()'); a.preferences.mode = 'study'; await a.run('start()');
  assert.equal(a.elements.timer.hidden, true, 'Changing to study hides the timer again');

  a = await app({ mode: 'study' }); a.elements.auto.checked = true;
  await a.run('start()'); await a.step(10000);
  assert.equal(a.run('index'), 0);
  a.sources.at(-1).finish(); await a.step(1999); assert.equal(a.run('index'), 0);
  await a.step(1); assert.equal(a.run('index'), 1); assert.equal(a.run('phase'), 'answer');
  a.sources.at(-1).finish(); a.run('pause()'); await a.step(5000);
  assert.equal(a.run('index'), 1, 'Pausing cancels auto advance in study mode');
  await a.run('resume()'); a.sources.at(-1).finish(); await a.step(2000);
  assert.equal(a.run('index'), 2);
  a.run('index = queue.length - 1'); await a.run('showQuestion()');
  a.sources.at(-1).finish(); await a.step(2000); assert.equal(a.run('phase'), 'complete');

  a = await app({ mode: 'study' }); a.mode('fail'); await a.run('start()');
  assert.equal(a.run('phase'), 'error');
  assert.doesNotMatch(a.elements['audio-error-text'].textContent, /タイマー/);
  a.mode('ok'); await a.run('showQuestion()'); assert.equal(a.run('phase'), 'answer');
  console.log('PASS: study/challenge switching, immediate study answer/audio, no study timer, 3-second timing, pause/resume, background pause, replay, manual/auto advance, load failure/retry, stale requests, sections, shuffle and completion');
})().catch((error) => { console.error(error); process.exitCode = 1; });
