// SoundSpace p5.js space trigger
//
// The camera is the instrument. Draw rectangles ("zones") over the camera
// feed; while a hand, a person or an object is detected inside a zone, that
// zone's note plays — with the same gate / one-shot / loop behaviours and the
// same load-a-sound-per-note sampler as soundplayer. A sampler file saved by
// soundplayer loads here unchanged.
//
//   drag on empty video       draw a new zone (takes the next free note)
//   drag inside a zone        move it
//   drag its corner handle    resize it
//   click its ×               remove it
//   keys c d e f g a b        play the notes without the camera (test sounds)
//   Delete / Backspace        clear assigned sounds
//
// Detection runs inside the page with ml5.js — the same three models CVTrack
// uses (hand: MediaPipe Hands, pose: MoveNet, object: COCO-SSD). Nothing
// leaves the browser. The point that has to be inside a zone is the same
// "anchor" CVTrack publishes: the centre of a hand, the centre of a person's
// confident keypoints, the centre of an object's box.
//
//   camera → ml5 detectors → one point per hand / person / object
//          → is a point inside a zone? → noteOn / noteOff → sampler

// letter key -> MIDI note (C4 major scale), the same seven notes as soundplayer
const KEYMAP = { c: 60, d: 62, e: 64, f: 65, g: 67, a: 69, b: 71 };
const NOTES = Object.values(KEYMAP);
const LETTER = Object.fromEntries(Object.entries(KEYMAP).map(([k, n]) => [n, k]));
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const AUDIO_FILE = /\.(wav|mp3|ogg|m4a|aiff?|flac)$/i;

const CANVAS_W = 720;
const VIDEO_W = 640, VIDEO_H = 480;
const CONFIDENCE = 0.3;     // detections below this are ignored
const LINGER_MS = 250;      // a zone stays occupied this long after the last sighting — hides detector flicker
const MIN_ZONE = 0.04;      // smaller drags are clicks, not zones (fraction of the frame)
const HANDLE = 18;          // px: the resize corner and the × box
const SOURCES = ['any', 'hand', 'pose', 'object'];   // what a zone listens for
const COLORS = { hand: '#5ad1ff', pose: '#ffb347', object: '#e879f9' }; // same as CVTrack's overlay
const STORAGE_KEY = 'soundspace-regiontrigger';
const CAMERA_WAIT_MS = 8000;

// ---- camera + detection state ------------------------------------------

let video = null;
let cameraReady = false;
let cameraStatus = 'waiting for camera permission…';
let srcW = VIDEO_W, srcH = VIDEO_H;
let mirror = true;          // a webcam facing you feels natural mirrored
let objectLabels = '';      // comma-separated COCO classes, blank = all
let points = [];            // this frame: [{x, y, kind, label}], x/y 0..1 in screen space

const detectors = {
  hand: makeSlot('hand', 'hands', (cb) => ml5.handPose({ maxHands: 4, flipHorizontal: false }, cb)),
  pose: makeSlot('pose', 'people', (cb) => ml5.bodyPose('MoveNet', { modelType: 'MULTIPOSE_LIGHTNING' }, cb)),
  object: makeSlot('object', 'objects', (cb) => ml5.objectDetection('cocossd', {}, cb)),
};

// ---- zones -------------------------------------------------------------

const zones = [];           // [{note, x, y, w, h, source, occupied, lastSeen}] — x/y/w/h 0..1
let drag = null;            // {mode: 'new' | 'move' | 'resize', zone, ...}

// ---- sound (the soundplayer engine) ------------------------------------

const activeOscs = new Map();    // note -> {osc, env}, for tone mode
const activeSamples = new Map(); // note -> {file, token}
const noteSounds = new Map();    // note -> {file, name, data}
const activeNotes = new Set();   // notes currently sounding (for display)
const heldNotes = new Set();     // prevents retrigger while a zone / key holds the note
const noteModes = new Map(NOTES.map((note) => [note, 'momentary']));
const MODES = [
  { id: 'momentary', label: 'gate' },
  { id: 'play-through', label: 'one-shot' },
  { id: 'loop', label: 'loop' },
];
let soundStatus = 'drag on the video to draw a zone';
let lastNote = null;
let audioReady = false;

const padButtons = new Map();    // note -> the test pad button
const zoneButtons = new Map();   // note -> the "zone: any" button

// ======================================================================
// setup
// ======================================================================

function setup() {
  const cnv = createCanvas(CANVAS_W, Math.round(CANVAS_W * VIDEO_H / VIDEO_W));
  cnv.parent('canvas-holder');
  textFont('monospace');

  buildNoteSettings();
  bindControls();
  bindCanvasInput(cnv.elt);
  restoreLocal();          // zones, modes, detector choice — sounds are not stored here
  refreshDetectorButtons();
  refreshZoneButtons();
  refreshModeButtons();

  startCamera();

  // browsers refuse to make sound until a real gesture — any click will do
  document.addEventListener('pointerdown', startAudio);
  setTimeout(() => {
    if (!cameraReady) cameraStatus = 'no camera yet — allow it in the address bar, then reload';
  }, CAMERA_WAIT_MS);
}

function startAudio() {
  if (audioReady) return;
  userStartAudio();
}

// ======================================================================
// camera
// ======================================================================

function startCamera() {
  const constraints = {
    video: { width: { ideal: VIDEO_W }, height: { ideal: VIDEO_H } },
    audio: false,
  };
  video = createCapture(constraints, () => {
    // `ideal` is a hint. Size the element to what the camera actually gave
    // us — ml5 reads the element's width/height, so this keeps every model's
    // results in one coordinate space.
    srcW = video.elt.videoWidth || VIDEO_W;
    srcH = video.elt.videoHeight || VIDEO_H;
    video.size(srcW, srcH);
    resizeCanvas(CANVAS_W, Math.round(CANVAS_W * srcH / srcW));
    cameraReady = true;
    cameraStatus = `camera ${srcW}×${srcH}`;
    for (const slot of Object.values(detectors)) startSlot(slot);
  });
  video.hide();
}

// ======================================================================
// detectors — three ml5 models sharing one lifecycle (a slim detectors.js)
// ======================================================================

function makeSlot(key, label, build) {
  return { key, label, build, enabled: false, state: 'idle', model: null, running: false, results: [] };
}

function setDetector(slot, on) {
  if (slot.enabled === on) return;
  slot.enabled = on;
  if (on) loadSlot(slot);
  else stopSlot(slot);
  refreshDetectorButtons();
  saveLocal();
}

// ml5 v1 returns the model synchronously under p5 1.x and calls back when it
// has loaded; under p5 2.x the same call returns a promise instead. Handle both
// so this file survives a p5 upgrade.
function loadSlot(slot) {
  if (slot.state === 'ready') { startSlot(slot); return; }
  if (slot.state === 'loading') return;
  slot.state = 'loading';

  let built;
  try {
    built = slot.build((model, err) => {
      if (err) { failSlot(slot, err); return; }
      if (model && typeof model.detectStart === 'function') slot.model = model;
      if (slot.model) markReady(slot);
    });
  } catch (err) {
    failSlot(slot, err);
    return;
  }

  if (built && typeof built.then === 'function') {
    built.then((model) => { slot.model = model; markReady(slot); }, (err) => failSlot(slot, err));
  } else if (built) {
    slot.model = built;
  }
}

function markReady(slot) {
  if (slot.state === 'ready') return;
  slot.state = 'ready';
  startSlot(slot);
}

function failSlot(slot, err) {
  slot.state = 'error';
  slot.model = null;
  slot.running = false;
  console.error('[regiontrigger]', slot.label, err);
}

const slotBusy = (slot) => !!slot.model && (slot.model.detecting === true || slot.model.isDetecting === true);

function startSlot(slot) {
  if (slot.running || !slot.enabled || slot.state !== 'ready' || !cameraReady) return;
  slot.running = true;
  launchSlot(slot);
}

// detectStop() only raises a flag; the old loop finishes its frame first.
// Wait for it to drain before starting again, or two loops run at once.
function launchSlot(slot) {
  if (!slot.running) return;
  if (slotBusy(slot)) { requestAnimationFrame(() => launchSlot(slot)); return; }
  slot.model.detectStart(video, (results) => { slot.results = results || []; });
}

function stopSlot(slot) {
  if (slotBusy(slot)) slot.model.detectStop();
  slot.running = false;
  slot.results = [];
}

function slotStatus(slot) {
  if (!slot.enabled) return 'off';
  if (slot.state === 'loading') return 'loading…';
  if (slot.state === 'error') return 'failed';
  if (slot.state === 'ready' && !slot.running) return 'waiting for camera';
  return 'on';
}

// ---- detections → one point each, in screen space (0..1, mirrored) -----

function normPt(px, py) {
  const x = px / srcW;
  return { x: mirror ? 1 - x : x, y: py / srcH };
}

function centroid(pts) {
  const n = pts.length;
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
}

function collectPoints() {
  const out = [];

  if (detectors.hand.running) {
    for (const hand of detectors.hand.results) {
      if (!hand.keypoints || !hand.keypoints.length) continue;
      const conf = hand.confidence == null ? 1 : hand.confidence;
      if (conf < CONFIDENCE) continue;
      const c = centroid(hand.keypoints);
      out.push({ ...normPt(c.x, c.y), kind: 'hand', label: String(hand.handedness || '').toLowerCase() });
    }
  }

  if (detectors.pose.running) {
    for (const pose of detectors.pose.results) {
      if (!pose.keypoints) continue;
      const solid = pose.keypoints.filter((kp) => (kp.confidence == null ? 1 : kp.confidence) >= CONFIDENCE);
      if (solid.length < 3) continue;   // need a few solid keypoints to call it a person
      const c = centroid(solid);
      out.push({ ...normPt(c.x, c.y), kind: 'pose', label: 'person' });
    }
  }

  if (detectors.object.running) {
    const allow = objectAllowlist();
    for (const obj of detectors.object.results) {
      const conf = obj.confidence == null ? 1 : obj.confidence;
      if (conf < CONFIDENCE) continue;
      const label = String(obj.label || '').toLowerCase();
      if (allow && !allow.has(label)) continue;
      out.push({ ...normPt(obj.x + obj.width / 2, obj.y + obj.height / 2), kind: 'object', label });
    }
  }

  return out;
}

function objectAllowlist() {
  const names = objectLabels.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return names.length ? new Set(names) : null;
}

// ======================================================================
// zones — is a point inside? that is the whole trigger
// ======================================================================

const zoneFor = (note) => zones.find((z) => z.note === note) || null;
const freeNote = () => NOTES.find((note) => !zoneFor(note)) ?? null;
const zoneAccepts = (zone, p) => zone.source === 'any' || zone.source === p.kind;

function pointInZone(zone, p) {
  return p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h;
}

function updateZones(now) {
  for (const zone of zones) {
    if (drag && drag.zone === zone) continue;   // don't fire while it is being drawn or moved
    const hit = points.some((p) => zoneAccepts(zone, p) && pointInZone(zone, p));
    if (hit) zone.lastSeen = now;
    const occupied = hit || now - zone.lastSeen < LINGER_MS;
    if (occupied && !zone.occupied) {
      zone.occupied = true;
      noteOn(zone.note);
    } else if (!occupied && zone.occupied) {
      zone.occupied = false;
      noteOff(zone.note);
    }
  }
}

function addZone(note, x, y) {
  const zone = { note, x, y, w: 0, h: 0, source: 'any', occupied: false, lastSeen: -1e9 };
  zones.push(zone);
  return zone;
}

function removeZone(zone) {
  const i = zones.indexOf(zone);
  if (i < 0) return;
  zones.splice(i, 1);
  if (zone.occupied) noteOff(zone.note);
  refreshZoneButtons();
  saveLocal();
}

function clearZones() {
  for (const zone of [...zones]) removeZone(zone);
  soundStatus = 'zones cleared';
}

function cycleSource(zone) {
  zone.source = SOURCES[(SOURCES.indexOf(zone.source) + 1) % SOURCES.length];
  refreshZoneButtons();
  saveLocal();
}

// ---- pointer: draw / move / resize on the canvas -----------------------

function bindCanvasInput(canvas) {
  const norm = (e) => {
    const b = canvas.getBoundingClientRect();
    return {
      x: constrain((e.clientX - b.left) / b.width, 0, 1),
      y: constrain((e.clientY - b.top) / b.height, 0, 1),
    };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = norm(e);
    const px = { x: p.x * width, y: p.y * height };

    // topmost zone first — the last one drawn sits on top
    for (let i = zones.length - 1; i >= 0; i--) {
      const zone = zones[i];
      const box = zoneBox(zone);
      if (inBox(px, box.x + box.w - HANDLE, box.y, HANDLE, HANDLE)) { removeZone(zone); return; }
      if (inBox(px, box.x + box.w - HANDLE, box.y + box.h - HANDLE, HANDLE, HANDLE)) {
        drag = { mode: 'resize', zone };
      } else if (inBox(px, box.x, box.y, box.w, box.h)) {
        drag = { mode: 'move', zone, dx: p.x - zone.x, dy: p.y - zone.y };
      } else {
        continue;
      }
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const note = freeNote();
    if (note === null) {
      soundStatus = 'all seven notes have a zone — remove one first';
      return;
    }
    drag = { mode: 'new', zone: addZone(note, p.x, p.y), ax: p.x, ay: p.y };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = norm(e);
    const zone = drag.zone;
    if (drag.mode === 'new') {
      zone.x = Math.min(drag.ax, p.x);
      zone.y = Math.min(drag.ay, p.y);
      zone.w = Math.abs(p.x - drag.ax);
      zone.h = Math.abs(p.y - drag.ay);
    } else if (drag.mode === 'move') {
      zone.x = constrain(p.x - drag.dx, 0, 1 - zone.w);
      zone.y = constrain(p.y - drag.dy, 0, 1 - zone.h);
    } else if (drag.mode === 'resize') {
      zone.w = constrain(p.x - zone.x, MIN_ZONE, 1 - zone.x);
      zone.h = constrain(p.y - zone.y, MIN_ZONE, 1 - zone.y);
    }
  });

  const finish = () => {
    if (!drag) return;
    const zone = drag.zone;
    if (drag.mode === 'new' && (zone.w < MIN_ZONE || zone.h < MIN_ZONE)) {
      zones.splice(zones.indexOf(zone), 1);   // a click, not a zone
    } else if (drag.mode === 'new') {
      soundStatus = `zone ${LETTER[zone.note].toUpperCase()} added — put a hand in it`;
    }
    drag = null;
    refreshZoneButtons();
    saveLocal();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  // drop a sound straight onto a zone, like dropping it onto a soundplayer key
  canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = zoneAt(norm(e)) ? 'copy' : 'none';
  });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const zone = zoneAt(norm(e));
    const file = e.dataTransfer.files[0];
    if (!zone) { soundStatus = 'drop the file inside a zone'; return; }
    if (file) assignSound(zone.note, file);
  });
}

const inBox = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
const zoneBox = (z) => ({ x: z.x * width, y: z.y * height, w: z.w * width, h: z.h * height });
const zoneAt = (p) => [...zones].reverse().find((z) => pointInZone(z, p)) || null;

// ======================================================================
// playback — identical to soundplayer, so the two stay interchangeable
// ======================================================================

function noteOn(note, velocity = 100) {
  if (heldNotes.has(note)) return;
  heldNotes.add(note);
  const vol = map(velocity, 0, 127, 0, 1);
  const mode = noteModes.get(note) || 'momentary';

  if (mode === 'loop' && activeNotes.has(note)) {
    stopNote(note);
  } else {
    if (mode === 'play-through' && activeNotes.has(note)) stopNote(note);
    startNote(note, vol, mode);
  }
  lastNote = note;
}

function noteOff(note) {
  heldNotes.delete(note);
  if ((noteModes.get(note) || 'momentary') === 'momentary') stopNote(note);
}

function startNote(note, vol, mode) {
  const assigned = noteSounds.get(note);
  if (assigned && assigned.file.isLoaded()) {
    const sf = assigned.file;
    const token = {};
    sf.stop();
    activeSamples.set(note, { file: sf, token });
    sf.onended(() => {
      const current = activeSamples.get(note);
      if (current && current.token === token) {
        activeSamples.delete(note);
        activeNotes.delete(note);
      }
    });
    if (mode === 'loop') sf.loop(0, 1, vol);
    else sf.play(0, 1, vol);
  } else {
    const osc = new p5.Oscillator('triangle');
    const env = new p5.Envelope();
    env.setADSR(0.005, 0.08, 0.6, 0.3);
    env.setRange(vol * 0.5, 0);
    osc.freq(midiToFreq(note));
    osc.amp(0);
    osc.start();
    env.triggerAttack(osc);
    activeOscs.set(note, { osc, env });
    if (mode === 'play-through') {
      setTimeout(() => {
        const current = activeOscs.get(note);
        if (current && current.osc === osc) stopNote(note);
      }, 350);
    }
  }
  activeNotes.add(note);
}

function stopNote(note) {
  const sample = activeSamples.get(note);
  if (sample) {
    activeSamples.delete(note);
    sample.file.stop();
  }
  const voice = activeOscs.get(note);
  if (voice) {
    voice.env.triggerRelease(voice.osc);
    setTimeout(() => voice.osc.stop(), 400); // after the release tail
    activeOscs.delete(note);
  }
  activeNotes.delete(note);
}

function allNotesOff() {
  for (const note of [...activeNotes]) stopNote(note);
  heldNotes.clear();
  for (const zone of zones) zone.occupied = false;
}

// ---- keyboard: test the sounds without a camera ------------------------

const typingInField = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
};

function keyPressed() {
  if (typingInField()) return;
  if (keyCode === DELETE || keyCode === BACKSPACE) { clearAssignedSounds(); return; }
  const note = KEYMAP[key.toLowerCase()];
  if (note !== undefined) noteOn(note);
}

function keyReleased() {
  if (typingInField()) return;
  const note = KEYMAP[key.toLowerCase()];
  if (note !== undefined) noteOff(note);
}

// ---- sounds per note ---------------------------------------------------

function assignSound(note, file) {
  if (!file.type.startsWith('audio/') && !AUDIO_FILE.test(file.name)) {
    soundStatus = 'not an audio file: ' + file.name;
    return;
  }
  const reader = new FileReader();
  soundStatus = `loading ${file.name} for ${noteName(note)}…`;
  reader.onload = () => loadSound(reader.result, (sf) => {
    stopNote(note);
    const previous = noteSounds.get(note);
    if (previous) previous.file.stop();
    noteSounds.set(note, { file: sf, name: file.name, data: reader.result });
    soundStatus = `${file.name} assigned to ${noteName(note)}`;
    refreshZoneButtons();
  }, () => {
    soundStatus = 'failed to load ' + file.name;
  });
  reader.onerror = () => { soundStatus = 'failed to read ' + file.name; };
  reader.readAsDataURL(file);
}

function clearAssignedSounds() {
  allNotesOff();
  for (const assigned of noteSounds.values()) assigned.file.stop();
  noteSounds.clear();
  soundStatus = 'all note sounds cleared';
  refreshZoneButtons();
}

// ======================================================================
// the note columns: test pad · zone source · load · gate / one-shot / loop
// ======================================================================

function buildNoteSettings() {
  const settings = document.getElementById('note-settings');

  for (const note of NOTES) {
    const group = document.createElement('div');
    group.className = 'note-setting';

    // a pad to hear the note by mouse / finger, like a soundplayer key
    const pad = document.createElement('button');
    pad.className = 'btn note-pad';
    pad.innerHTML = `${LETTER[note].toUpperCase()}<small>${noteName(note)}</small>`;
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      noteOn(note);
    });
    const release = () => noteOff(note);
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
    padButtons.set(note, pad);
    group.appendChild(pad);

    const zoneButton = document.createElement('button');
    zoneButton.className = 'btn';
    zoneButton.textContent = 'no zone';
    zoneButton.addEventListener('click', () => {
      const zone = zoneFor(note);
      if (zone) cycleSource(zone);
    });
    zoneButtons.set(note, zoneButton);
    group.appendChild(zoneButton);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*,.wav,.mp3,.ogg,.m4a,.aiff,.aif,.flac';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) assignSound(note, file);
      fileInput.value = '';
    });
    const loadButton = document.createElement('button');
    loadButton.className = 'btn';
    loadButton.textContent = 'load';
    loadButton.setAttribute('aria-label', `load sound for ${noteName(note)}`);
    loadButton.addEventListener('click', () => fileInput.click());
    group.appendChild(loadButton);
    group.appendChild(fileInput);

    for (const mode of MODES) {
      const button = document.createElement('button');
      button.className = 'btn';
      button.textContent = mode.label;
      button.dataset.note = note;
      button.dataset.mode = mode.id;
      button.setAttribute('aria-label', `${noteName(note)} ${mode.label} trigger`);
      button.addEventListener('click', () => {
        stopNote(note);
        heldNotes.delete(note);
        const zone = zoneFor(note);
        if (zone) zone.occupied = false;   // re-enter the zone to trigger in the new mode
        noteModes.set(note, mode.id);
        refreshModeButtons();
        saveLocal();
      });
      group.appendChild(button);
    }

    settings.appendChild(group);
  }
}

function refreshModeButtons() {
  for (const button of document.querySelectorAll('#note-settings [data-mode]')) {
    const note = Number(button.dataset.note);
    button.classList.toggle('on', noteModes.get(note) === button.dataset.mode);
  }
}

function refreshZoneButtons() {
  for (const note of NOTES) {
    const zone = zoneFor(note);
    const button = zoneButtons.get(note);
    button.textContent = zone ? `zone: ${zone.source}` : 'no zone';
    button.disabled = !zone;
    padButtons.get(note).classList.toggle('zoned', !!zone);
  }
}

function refreshDetectorButtons() {
  for (const slot of Object.values(detectors)) {
    document.getElementById('det-' + slot.key).classList.toggle('on', slot.enabled);
  }
  document.getElementById('mirror').classList.toggle('on', mirror);
}

function bindControls() {
  for (const slot of Object.values(detectors)) {
    document.getElementById('det-' + slot.key).addEventListener('click', () => setDetector(slot, !slot.enabled));
  }
  const labels = document.getElementById('object-labels');
  labels.addEventListener('input', () => { objectLabels = labels.value; saveLocal(); });
  document.getElementById('mirror').addEventListener('click', () => {
    mirror = !mirror;
    refreshDetectorButtons();
    saveLocal();
  });
  document.getElementById('clear-zones').addEventListener('click', clearZones);
  document.getElementById('save-settings').addEventListener('click', saveSettings);
  document.getElementById('load-settings').addEventListener('click', () => {
    document.getElementById('load-file').click();
  });
  document.getElementById('load-file').addEventListener('change', loadSettings);
}

// ======================================================================
// persistence
//   localStorage  — zones, modes, detector choice: survives a reload
//   save / load   — the same JSON as soundplayer (modes + sounds), plus zones
// ======================================================================

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      zones: zones.map(serializeZone),
      modes: NOTES.map((note) => [note, noteModes.get(note)]),
      detectors: Object.fromEntries(Object.values(detectors).map((s) => [s.key, s.enabled])),
      mirror,
      objectLabels,
    }));
  } catch (err) { /* private mode etc. — nothing to do */ }
}

function restoreLocal() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (err) { /* ignore */ }

  if (saved && typeof saved === 'object') {
    if (Array.isArray(saved.zones)) applyZones(saved.zones);
    if (Array.isArray(saved.modes)) for (const [note, mode] of saved.modes) applyMode(note, mode);
    if (typeof saved.mirror === 'boolean') mirror = saved.mirror;
    if (typeof saved.objectLabels === 'string') objectLabels = saved.objectLabels;
    document.getElementById('object-labels').value = objectLabels;
    const chosen = saved.detectors && typeof saved.detectors === 'object' ? saved.detectors : null;
    for (const slot of Object.values(detectors)) setDetector(slot, chosen ? !!chosen[slot.key] : slot.key === 'hand');
  } else {
    setDetector(detectors.hand, true);   // first visit: hands only, the quickest win
  }
}

const serializeZone = (z) => ({ note: z.note, x: z.x, y: z.y, w: z.w, h: z.h, source: z.source });

function applyZones(list) {
  for (const zone of [...zones]) removeZone(zone);
  for (const item of list) {
    const note = Number(item.note);
    if (!NOTES.includes(note) || zoneFor(note)) continue;
    const zone = addZone(note, constrain(Number(item.x) || 0, 0, 1), constrain(Number(item.y) || 0, 0, 1));
    zone.w = constrain(Number(item.w) || 0, MIN_ZONE, 1 - zone.x);
    zone.h = constrain(Number(item.h) || 0, MIN_ZONE, 1 - zone.y);
    zone.source = SOURCES.includes(item.source) ? item.source : 'any';
  }
  refreshZoneButtons();
}

function applyMode(note, mode) {
  note = Number(note);
  if (NOTES.includes(note) && MODES.some((m) => m.id === mode)) noteModes.set(note, mode);
}

function saveSettings() {
  const notes = NOTES.map((note) => {
    const assigned = noteSounds.get(note);
    return {
      note,
      mode: noteModes.get(note) || 'momentary',
      name: assigned ? assigned.name : null,
      data: assigned ? assigned.data : null,
    };
  });
  const blob = new Blob([JSON.stringify({ version: 1, notes, zones: zones.map(serializeZone) })], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'soundspace-regions.json';
  link.click();
  URL.revokeObjectURL(url);
  soundStatus = 'zones and sounds saved';
}

function loadSettings(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const saved = JSON.parse(reader.result);
      if (saved.version !== 1 || !Array.isArray(saved.notes)) throw new Error('unsupported settings file');

      allNotesOff();
      for (const assigned of noteSounds.values()) assigned.file.stop();
      noteSounds.clear();
      if (Array.isArray(saved.zones)) applyZones(saved.zones);   // a soundplayer file has none — keep ours

      let toLoad = 0, loaded = 0;
      for (const item of saved.notes) {
        const note = Number(item.note);
        if (!NOTES.includes(note)) continue;
        applyMode(note, item.mode);
        if (typeof item.data === 'string' && typeof item.name === 'string') {
          toLoad++;
          loadSound(item.data, (sf) => {
            noteSounds.set(note, { file: sf, name: item.name, data: item.data });
            loaded++;
            soundStatus = loaded === toLoad
              ? `loaded ${loaded} assigned sound${loaded === 1 ? '' : 's'}`
              : `loading assigned sounds: ${loaded}/${toLoad}`;
          }, () => { soundStatus = `failed to load ${item.name}`; });
        }
      }
      refreshModeButtons();
      saveLocal();
      if (toLoad === 0) soundStatus = 'settings loaded';
    } catch (error) {
      soundStatus = 'could not load settings: ' + error.message;
    }
    input.value = '';
  };
  reader.onerror = () => { soundStatus = 'could not read settings file'; input.value = ''; };
  reader.readAsText(file);
}

// ======================================================================
// display
// ======================================================================

function noteName(n) {
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

function shortenName(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return base.length > 14 ? base.slice(0, 13) + '…' : base;
}

function draw() {
  background('#1a1a2e');
  audioReady = getAudioContext().state === 'running';

  if (cameraReady) {
    push();
    if (mirror) { translate(width, 0); scale(-1, 1); }
    image(video, 0, 0, width, height);
    pop();
    points = collectPoints();
    updateZones(millis());
  } else {
    points = [];
  }

  drawZones();
  drawPoints();
  drawHUD();

  for (const [note, pad] of padButtons) pad.classList.toggle('on', activeNotes.has(note));
}

function drawZones() {
  for (const zone of zones) {
    const box = zoneBox(zone);
    const tint = zone.source === 'any' ? '#ffcc66' : COLORS[zone.source];
    const c = color(tint);
    c.setAlpha(zone.occupied ? 150 : 45);
    fill(c);
    stroke(tint);
    strokeWeight(zone.occupied ? 3 : 1.5);
    rect(box.x, box.y, box.w, box.h, 6);

    // corner handles: × to remove, ◢ to resize
    noStroke();
    fill(c.levels[0], c.levels[1], c.levels[2], 200);
    rect(box.x + box.w - HANDLE, box.y, HANDLE, HANDLE, 0, 6, 0, 0);
    triangle(box.x + box.w, box.y + box.h - HANDLE, box.x + box.w, box.y + box.h, box.x + box.w - HANDLE, box.y + box.h);
    fill('#1a1a2e');
    textAlign(CENTER, CENTER); textSize(12);
    text('×', box.x + box.w - HANDLE / 2, box.y + HANDLE / 2 - 1);

    // labels: letter big, then note / source / sound
    fill(zone.occupied ? '#1a1a2e' : '#e0e0ff');
    textSize(Math.min(26, box.h * 0.4));
    text(LETTER[zone.note].toUpperCase(), box.x + box.w / 2, box.y + box.h / 2 - 6);
    if (box.h > 44 && box.w > 60) {
      textSize(10);
      const assigned = noteSounds.get(zone.note);
      const line = `${noteName(zone.note)} · ${zone.source} · ${assigned ? shortenName(assigned.name) : 'tone'}`;
      text(line, box.x + box.w / 2, box.y + box.h / 2 + 14);
    }
    textAlign(LEFT, BASELINE);
  }
  strokeWeight(1);
}

function drawPoints() {
  for (const p of points) {
    const x = p.x * width, y = p.y * height;
    stroke('#1a1a2e'); strokeWeight(1.5);
    fill(COLORS[p.kind]);
    circle(x, y, 14);
    noStroke();
    fill('#e0e0ff'); textSize(10); textAlign(LEFT, BASELINE);
    text(p.label || p.kind, x + 10, y + 4);
  }
  strokeWeight(1);
}

function drawHUD() {
  noStroke();
  fill(26, 26, 46, 190);
  rect(0, 0, width, 60);

  fill('#e0e0ff'); textSize(14); textAlign(LEFT, BASELINE);
  text('SoundSpace&Body space trigger', 16, 22);

  fill('#8888aa'); textSize(11);
  const det = Object.values(detectors).map((s) => `${s.label} ${slotStatus(s)}`).join(' · ');
  text(`${cameraStatus} · ${det}`, 16, 40);
  text(soundStatus, 16, 54);

  textAlign(RIGHT, BASELINE);
  if (!audioReady) {
    fill('#ffcc66'); textSize(12);
    text('click anywhere to start audio', width - 16, 22);
  } else if (lastNote !== null) {
    fill('#ffcc66'); textSize(12);
    text(`last note: ${lastNote} (${noteName(lastNote)})`, width - 16, 22);
  }
  if (!zones.length && cameraReady) {
    fill('#8888aa'); textSize(11);
    text('drag on the video to draw a zone', width - 16, 40);
  }
  textAlign(LEFT, BASELINE);
}
