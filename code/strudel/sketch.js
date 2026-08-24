// SoundSpace 4-channel Strudel player
//
// Each channel is a Strudel text box. Trigger from the play button,
// keys 1–4, or MIDI C4 D4 E4 F4.
//   loop      — press toggles play / stop
//   hold      — play while the key / MIDI note / button is down
//   layered   — channels stack
//   solo      — starting one channel stops the others
// @strudel/web has one scheduler, so playing channels are stacked and
// re-evaluated together as labeled patterns (ch1: …, ch2: …).

const STORAGE_KEY = 'soundspace-strudel-4ch';
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const CHANNELS = [
  { id: 1, midi: 60, key: '1', color: '#ffcc66', code: 's("bd sd")' },
  { id: 2, midi: 62, key: '2', color: '#66ccff', code: 's("hh*8").gain(0.4)' },
  { id: 3, midi: 64, key: '3', color: '#cc88ff',
    code: 'note("<c2 eb2 g2 bb2>").s("sawtooth").lpf(800).gain(0.45)' },
  { id: 4, midi: 65, key: '4', color: '#88ee99',
    code: 'note("c5*4").s("triangle").degradeBy(0.4).gain(0.28)' },
];

const channels = CHANNELS.map((ch) => ({
  ...ch,
  mode: 'loop', // 'loop' | 'hold'
  playing: false,
  error: '',
  textarea: null,
  button: null,
  loopBtn: null,
  holdBtn: null,
  el: null,
}));

let mixMode = 'layered'; // 'layered' | 'solo'

const heldNotes = new Set();
const heldKeys = new Set();

let midiStatus = 'requesting MIDI access...';
let midiInputs = [];
let engineStatus = 'starting strudel...';
let lastEvalError = '';
let strudelReady = false;
let syncing = false;
let pendingSync = false;
let engineEpoch = 0;
let lastTrigger = null;
let strudelRepl = null;

function setup() {
  const cnv = createCanvas(720, 110);
  cnv.parent('canvas-holder');
  textFont('ui-monospace, Menlo, Consolas, monospace');
  noLoop();

  restoreCodes();
  buildChannelUI();
  initMIDI();
  initEngine();

  document.getElementById('stop-all').addEventListener('click', stopAll);
  document.getElementById('mix-layered').addEventListener('click', () => setMixMode('layered'));
  document.getElementById('mix-solo').addEventListener('click', () => setMixMode('solo'));
}

function initEngine() {
  if (typeof initStrudel !== 'function') {
    engineStatus = 'could not load @strudel/web';
    redraw();
    return;
  }

  initStrudel({
    prebake: () => loadStrudelCcSounds(),
    onEvalError: (err) => {
      lastEvalError = err && err.message ? err.message : String(err);
    },
  }).then((repl) => {
    strudelRepl = repl;
    bindHush();
    strudelReady = true;
    engineStatus = 'ready — play a channel or send MIDI C D E F';
    refreshChannelUI();
    redraw();
  }).catch((err) => {
    engineStatus = 'strudel init failed: ' + (err.message || err);
    redraw();
  });
}

// ---------------------------------------------------------------- playback

function pressChannel(index, source) {
  const ch = channels[index];
  if (!ch) return;
  if (ch.mode === 'hold') {
    if (!ch.playing) startChannel(index, source);
    return;
  }
  toggleChannel(index, source);
}

function releaseChannel(index, source) {
  const ch = channels[index];
  if (!ch || ch.mode !== 'hold' || !ch.playing) return;
  stopChannel(index, source);
}

function toggleChannel(index, source) {
  const ch = channels[index];
  if (!ch) return;
  if (ch.playing) stopChannel(index, source);
  else startChannel(index, source);
}

async function startChannel(index, source) {
  const ch = channels[index];
  if (!ch || !strudelReady) return;
  engineEpoch++;
  lastTrigger = { id: ch.id, source };
  if (mixMode === 'solo') {
    for (let i = 0; i < channels.length; i++) {
      if (i !== index) {
        channels[i].playing = false;
        channels[i].error = '';
      }
    }
  }
  ch.playing = true;
  ch.error = '';
  const ok = await syncEngine();
  if (!ok && lastEvalError) {
    ch.playing = false;
    ch.error = lastEvalError;
    await syncEngine();
  }
  refreshChannelUI();
  redraw();
}

async function stopChannel(index, source) {
  const ch = channels[index];
  if (!ch) return;
  engineEpoch++;
  lastTrigger = { id: ch.id, source };
  ch.playing = false;
  ch.error = '';
  await syncEngine();
  refreshChannelUI();
  redraw();
}

async function stopAll() {
  engineEpoch++;
  for (const ch of channels) {
    ch.playing = false;
    ch.error = '';
  }
  lastTrigger = { id: null, source: 'stop all' };
  stopEngine();
  engineStatus = 'stopped';
  refreshChannelUI();
  redraw();
  await syncEngine();
}

async function updatePlaying() {
  if (!channels.some((ch) => ch.playing)) return;
  await syncEngine();
  refreshChannelUI();
  redraw();
}

// After evaluate(), @strudel/web overwrites window.hush with a helper that
// only returns silence and does not stop the scheduler. Always stop via the repl.
function stopEngine() {
  if (strudelRepl && typeof strudelRepl.stop === 'function') {
    strudelRepl.stop();
    bindHush();
    return;
  }
}

function bindHush() {
  window.hush = stopEngine;
}

function channelEvalLine(ch) {
  return `ch${ch.id}: ${ch.code.trim()}`;
}

function isChannelHeld(index) {
  const ch = channels[index];
  return heldKeys.has(ch.key) || heldNotes.has(ch.midi);
}

function setMode(index, mode) {
  const ch = channels[index];
  if (!ch || ch.mode === mode) return;
  ch.mode = mode;
  persistCodes();
  if (mode === 'hold' && ch.playing && !isChannelHeld(index)) {
    stopChannel(index, 'mode');
  }
  refreshChannelUI();
}

function setMixMode(mode) {
  if (mixMode === mode) return;
  mixMode = mode;
  persistCodes();
  if (mode === 'solo') {
    const keepId = lastTrigger && lastTrigger.id;
    let keep = channels.findIndex((ch) => ch.playing && ch.id === keepId);
    if (keep < 0) keep = channels.findIndex((ch) => ch.playing);
    if (keep >= 0) {
      for (let i = 0; i < channels.length; i++) {
        if (i !== keep) channels[i].playing = false;
      }
      updatePlaying();
    }
  }
  refreshChannelUI();
  redraw();
}

async function syncEngine() {
  if (!strudelReady) return false;
  if (syncing) {
    pendingSync = true;
    return true;
  }

  syncing = true;
  lastEvalError = '';
  let ok = true;

  try {
    do {
      pendingSync = false;
      const epoch = engineEpoch;
      const playing = channels.filter((ch) => ch.playing && ch.code.trim());
      if (playing.length === 0) {
        stopEngine();
        engineStatus = 'stopped';
        ok = true;
        continue;
      }

      const code = playing.map(channelEvalLine).join('\n');
      const pattern = await evaluate(code);
      bindHush();
      if (epoch !== engineEpoch) {
        pendingSync = true;
        continue;
      }
      if (!pattern) {
        engineStatus = lastEvalError || 'eval error';
        ok = false;
        continue;
      }

      engineStatus = 'playing ch ' + playing.map((ch) => ch.id).join(' + ');
      for (const ch of playing) ch.error = '';
      ok = true;
    } while (pendingSync);
    return ok;
  } catch (err) {
    lastEvalError = err.message || String(err);
    engineStatus = lastEvalError;
    return false;
  } finally {
    syncing = false;
    if (pendingSync) syncEngine();
  }
}

// ------------------------------------------------------------ MIDI input

function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    midiStatus = 'Web MIDI not supported (use Chrome/Edge)';
    redraw();
    return;
  }
  navigator.requestMIDIAccess().then((access) => {
    const rescan = () => {
      midiInputs = [];
      for (const input of access.inputs.values()) {
        input.onmidimessage = onMIDIMessage;
        midiInputs.push(input.name);
      }
      midiStatus = midiInputs.length
        ? 'MIDI: ' + midiInputs.join(', ')
        : 'MIDI: no device (waiting...)';
      redraw();
    };
    access.onstatechange = rescan;
    rescan();
  }, () => {
    midiStatus = 'MIDI access denied';
    redraw();
  });
}

function onMIDIMessage(msg) {
  const [status, note, velocity] = msg.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && velocity > 0) noteOn(note);
  else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) noteOff(note);
}

function noteOn(note) {
  if (heldNotes.has(note)) return;
  heldNotes.add(note);
  const index = channels.findIndex((ch) => ch.midi === note);
  if (index >= 0) pressChannel(index, 'midi ' + noteName(note));
}

function noteOff(note) {
  heldNotes.delete(note);
  const index = channels.findIndex((ch) => ch.midi === note);
  if (index >= 0) releaseChannel(index, 'midi ' + noteName(note));
}

// -------------------------------------------------------- keyboard input

function isEscapeKey(event) {
  return event.key === 'Escape' || event.key === 'Esc' || event.code === 'Escape' || event.keyCode === 27;
}

function keyPressed() {
  if (keyCode === ESCAPE) {
    stopAll();
    return false;
  }
}

function onDocumentKey(event) {
  const editing = isEditingText();

  if (isEscapeKey(event)) {
    event.preventDefault();
    if (editing) document.activeElement.blur();
    stopAll();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    const index = focusedChannelIndex();
    if (index < 0) return;
    if (channels[index].playing) updatePlaying();
    else startChannel(index, 'ctrl+enter');
    return;
  }

  if (editing) return;
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

  const index = channels.findIndex((ch) => ch.key === event.key);
  if (index < 0 || heldKeys.has(event.key)) return;
  heldKeys.add(event.key);
  pressChannel(index, 'key ' + event.key);
}

window.addEventListener('keydown', onDocumentKey, true);
document.addEventListener('keyup', (event) => {
  heldKeys.delete(event.key);
  const index = channels.findIndex((ch) => ch.key === event.key);
  if (index >= 0) releaseChannel(index, 'key ' + event.key);
});
window.addEventListener('blur', releaseHeldChannels);

function releaseHeldChannels() {
  heldKeys.clear();
  heldNotes.clear();
  let any = false;
  for (const ch of channels) {
    if (ch.mode === 'hold' && ch.playing) {
      ch.playing = false;
      any = true;
    }
  }
  if (!any) return;
  engineEpoch++;
  lastTrigger = { id: null, source: 'blur' };
  syncEngine().then(() => {
    refreshChannelUI();
    redraw();
  });
}

function isEditingText() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable;
}

function focusedChannelIndex() {
  return channels.findIndex((ch) => ch.textarea && ch.textarea.elt === document.activeElement);
}

// -------------------------------------------------------- channel UI

function buildChannelUI() {
  const root = document.getElementById('channels');
  root.innerHTML = '';

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const row = document.createElement('section');
    row.className = 'channel';
    row.style.setProperty('--ch', ch.color);

    const head = document.createElement('div');
    head.className = 'channel-head';

    const dot = document.createElement('span');
    dot.className = 'channel-dot';

    const title = document.createElement('span');
    title.className = 'channel-title';
    title.textContent = 'CH' + ch.id;

    const map = document.createElement('span');
    map.className = 'channel-map';
    map.textContent = 'MIDI ' + noteName(ch.midi) + '  ·  key ' + ch.key;

    const modes = document.createElement('div');
    modes.className = 'channel-modes';
    const makeMode = (mode, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = label;
      btn.addEventListener('click', () => setMode(i, mode));
      modes.appendChild(btn);
      return btn;
    };
    ch.loopBtn = makeMode('loop', 'loop');
    ch.holdBtn = makeMode('hold', 'hold');

    const button = createButton('play');
    button.parent(head);
    button.addClass('btn');
    button.elt.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.elt.setPointerCapture(event.pointerId);
      pressChannel(i, 'button');
    });
    button.elt.addEventListener('pointerup', () => releaseChannel(i, 'button'));
    button.elt.addEventListener('pointercancel', () => releaseChannel(i, 'button'));

    head.prepend(modes);
    head.prepend(map);
    head.prepend(title);
    head.prepend(dot);
    row.appendChild(head);

    const textarea = createElement('textarea');
    textarea.parent(row);
    textarea.value(ch.code);
    textarea.attribute('spellcheck', 'false');
    textarea.attribute('autocomplete', 'off');
    textarea.attribute('aria-label', 'channel ' + ch.id + ' strudel code');
    textarea.input(() => {
      ch.code = textarea.value();
      persistCodes();
    });

    const error = document.createElement('p');
    error.className = 'channel-error';

    row.appendChild(error);
    root.appendChild(row);

    ch.el = row;
    ch.button = button;
    ch.errorEl = error;
    ch.textarea = textarea;
  }
  refreshChannelUI();
}

function refreshChannelUI() {
  for (const ch of channels) {
    if (!ch.el) continue;
    ch.el.classList.toggle('playing', ch.playing);
    ch.button.html(ch.playing ? 'stop' : 'play');
    ch.button.elt.classList.toggle('on', ch.playing);
    ch.button.elt.disabled = !strudelReady;
    if (ch.loopBtn) ch.loopBtn.classList.toggle('on', ch.mode === 'loop');
    if (ch.holdBtn) ch.holdBtn.classList.toggle('on', ch.mode === 'hold');
    ch.errorEl.textContent = ch.error;
  }
  const stopAllBtn = document.getElementById('stop-all');
  if (stopAllBtn) stopAllBtn.disabled = !strudelReady;
  const layeredBtn = document.getElementById('mix-layered');
  const soloBtn = document.getElementById('mix-solo');
  if (layeredBtn) layeredBtn.classList.toggle('on', mixMode === 'layered');
  if (soloBtn) soloBtn.classList.toggle('on', mixMode === 'solo');
}

function persistCodes() {
  const payload = {
    version: 3,
    mixMode,
    channels: channels.map((ch) => ({ code: ch.code, mode: ch.mode })),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // ignore quota / private mode
  }
}

function restoreChannelMode(value) {
  if (value === 'hold' || value === 'once') return 'hold';
  if (value === 'loop') return 'loop';
  return null;
}

function restoreCodes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    if (saved.mixMode === 'layered' || saved.mixMode === 'solo') mixMode = saved.mixMode;
    if ((saved.version === 2 || saved.version === 3) && Array.isArray(saved.channels)) {
      for (let i = 0; i < channels.length; i++) {
        const item = saved.channels[i];
        if (!item) continue;
        if (typeof item.code === 'string') channels[i].code = item.code;
        const mode = restoreChannelMode(item.mode);
        if (mode) channels[i].mode = mode;
      }
      return;
    }
    if (saved.version === 1 && Array.isArray(saved.codes)) {
      for (let i = 0; i < channels.length; i++) {
        if (typeof saved.codes[i] === 'string') channels[i].code = saved.codes[i];
      }
    }
  } catch (err) {
    // keep defaults
  }
}

// --------------------------------------------------------------- display

function noteName(n) {
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

function draw() {
  background('#1a1a2e');

  fill('#e0e0ff');
  noStroke();
  textSize(16);
  textAlign(LEFT, TOP);
  text('SoundSpace 4ch Strudel', 20, 16);

  textSize(12);
  fill('#8888aa');
  text(midiStatus, 20, 42);
  text(engineStatus, 20, 60);
  text('keys 1–4 / MIDI C D E F  ·  loop or hold  ·  ' + mixMode + '  ·  Ctrl/⌘+Enter  ·  Esc stops all', 20, 78);

  const meterW = 12;
  const meterH = 18;
  const meterGap = 6;
  const metersWidth = channels.length * (meterW + meterGap) - meterGap;
  const metersX = width - 20 - metersWidth;
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const x = metersX + i * (meterW + meterGap);
    noStroke();
    fill(ch.playing ? ch.color : '#2e2e4e');
    rect(x, 16, meterW, meterH, 3);
  }

  if (lastTrigger) {
    fill('#ffcc66');
    textAlign(RIGHT, TOP);
    const label = lastTrigger.id
      ? 'last: ch' + lastTrigger.id + ' · ' + lastTrigger.source
      : lastTrigger.source;
    text(label, width - 20, 42);
  }
}
