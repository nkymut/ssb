// SoundSpace&Body — spaceregion
//
// ======================================================================
// PROMPT — paste everything between the lines into an AI coding agent
// (Claude Code, Cursor, the p5 editor's assistant…) to build this page
// from scratch, or paste it with this file to change it.
// ----------------------------------------------------------------------
//
// Build a one-page p5.js sketch called "spaceregion": places in front of a
// camera become continuous knobs. Where spacetrigger asks "is someone in
// the box?" (on / off), this asks "*where* in the box?" (two numbers).
//
// Libraries: p5.js 1.9.4 (cdnjs), ml5.js v1 for detection, and
// @strudel/web 1.3.0 for the sound. No build step: index.html + sketch.js
// on a local web server (the camera needs http://localhost, or HTTPS on a
// phone). p5.sound is NOT needed — Strudel makes every sound.
//
// Show the webcam full width, optionally mirrored, with a menu listing every
// camera the machine has — built-in, USB, or a phone's front and back (their
// names only appear after permission is given, so fill the list in again once
// the video runs; stop the old stream and the detectors before asking for the
// next one, or the machine will not hand it over). Run up to three ml5
// models on it, each toggled by a button: handPose, bodyPose/MoveNet,
// objectDetection/COCO-SSD (filterable by a typed list of class names).
// Reduce each detection to ONE point — the centre of a hand's landmarks,
// of a person's confident keypoints, of an object's box — and draw it in
// its own colour (hand #5ad1ff, pose #ffb347, object #e879f9).
//
// The user drags rectangles ("regions") onto the video. While a point of
// the right kind is inside a region, that region reports two numbers:
//   x = how far across the region the point is   (left 0 → right 1)
//   y = how far UP the region the point is       (bottom 0 → top 1)
// Smooth both towards their new value instead of jumping, so a jittery
// detection does not make a zipper noise. When the point leaves, the
// region either holds its last value or falls back to a rest value — a
// per-region toggle.
//
// Each region has a preset that names its two axes and their MIDI CCs:
//   filter  X = cutoff (CC 74)   Y = resonance (CC 71)
//   space   X = reverb (CC 91)   Y = delay     (CC 93)
//   level   X = pan    (CC 10)   Y = volume    (CC  7)
// Corner handles on each region: top-left cycles the preset, bottom-left
// cycles what it listens for (any / hand / pose / object), top-right
// removes it, bottom-right resizes it; dragging the middle moves it.
//
// Read the SHAPE of a hand as well as its position: for each of the four
// fingers, is the fingertip further from the wrist than that finger's middle
// joint? Three straight fingers of four means the hand is open. Ignore the
// thumb, it is the least reliable.
//
// With a "hands" button on, the hands are the transport: the first open hand
// STARTS the sequence, closing every hand fades it out over about 200 ms and
// then stops it, and while the hands are closed the regions freeze — their
// last values stay put and no CC goes out. Act on the moment hands open or
// close, not on every frame, so pressing play by hand keeps working until the
// hands are closed and opened again. Never let a switched-off detector
// silence the page, and say plainly that a browser needs one click on the
// page before any of it can make sound.
//
// The numbers go to two places at once:
//
// 1. MIDI. A "midi" button over the top-right of the video cycles through
//    the Web MIDI outputs; while one is chosen, every change is sent as a
//    control change on a channel the user can pick. Send at most every
//    25 ms and only when the 0–127 value actually changes, or the port
//    drowns.
//
// 2. Strudel. A textarea holds a Strudel sequence the student edits and
//    runs with a play button or Ctrl/Cmd+Enter. Before evaluating, prepend
//    a preamble that defines r1x, r1y … r6x, r6y as Strudel signals
//    reading the live region values, so the sequence can say
//    .lpf(r1x.range(100, 3000)) and the camera moves the filter WITHOUT
//    re-evaluating the code. Re-running should only be needed when the
//    text changes. Keep the student's text and the preamble separate:
//    never rewrite what they typed. The open-hand gate is one more signal
//    (handsOpen) plus one appended line, all((x) => x.postgain(handsOpen));
//    if a Strudel build refuses that line, run the sequence without it and
//    say so rather than leaving the student in silence.
//
// Regions are stored as fractions of the frame (0..1), never pixels, so a
// layout survives a different camera. Keep regions, the sequence, the
// detector choice and the MIDI port in localStorage, and offer save/load
// of one JSON file holding the regions and the sequence together.
//
// Look: dark page (#1a1a2e), panels #2e2e4e, text #e0e0ff, highlight
// #ffcc66, monospace type. Draw each region on the video with a crosshair
// at its current value, and give each one a card below the video with two
// live meters, so a student can see the numbers move before trusting them.
//
// Write it for a reader who is a sound designer, not a programmer: plain
// function names (addRegion, updateRegions, sendRegion), short comments
// that say *why*, no framework, no clever abstractions.
//
// ----------------------------------------------------------------------
// ADD-ONS — write your own feature requests below, then hand the whole
// comment to the agent. One change at a time works far better than five.
// Examples to replace:
//   - "add a third number per region: how big the hand is (near / far)"
//   - "freeze all regions while I hold the space bar"
//   - "send the region values to another laptop over MQTT"
//
//   -
//   -
//   -
// ======================================================================

// How to play the page itself: README.md in this folder.

const CANVAS_W = 720;
const VIDEO_W = 640, VIDEO_H = 480;
const CONFIDENCE = 0.3;     // detections below this are ignored
const LINGER_MS = 250;      // a region stays "in use" this long after the last sighting
const MIN_REGION = 0.05;    // smaller drags are clicks, not regions (fraction of the frame)
const HANDLE = 18;          // px: the corner boxes
const SMOOTH = 0.25;        // 0 = frozen, 1 = no smoothing at all
const SEND_MS = 25;         // MIDI CC rate limit — 40 messages a second is plenty
const MAX_REGIONS = 6;      // r1..r6, because the sequence names them by number
const SOURCES = ['any', 'hand', 'pose', 'object'];   // what a region listens for
// open / closed hands: compare each fingertip's distance from the wrist with
// its middle joint's. A curled finger brings the tip back towards the wrist.
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]];   // [tip, middle joint]
const OPEN_FINGERS = 3;      // this many straight fingers (of four) = an open hand
const REACH = 1.15;          // how much further out the tip must be, to ignore noise
const HAND_LINGER_MS = 400;  // keep playing this long after the last open hand
const GATE_SMOOTH = 0.12;    // ~200 ms fade in and out, instead of a click
const FADE_OUT_MS = 350;     // let that fade finish before the transport stops
const COLORS = { hand: '#5ad1ff', pose: '#ffb347', object: '#e879f9' }; // same as CVTrack's overlay
const AXIS_COLORS = { x: '#ffcc66', y: '#66ccff' };
const STORAGE_KEY = 'soundspace-spaceregion';
const CAMERA_WAIT_MS = 8000;

// Each preset names the two axes and picks their MIDI CC numbers. `rest` is
// where an axis goes when nobody is in the region and "hold" is off.
const PRESETS = [
  { id: 'filter', x: { cc: 74, name: 'cutoff' }, y: { cc: 71, name: 'resonance' }, rest: { x: 1, y: 0 } },
  { id: 'space', x: { cc: 91, name: 'reverb' }, y: { cc: 93, name: 'delay' }, rest: { x: 0, y: 0 } },
  { id: 'level', x: { cc: 10, name: 'pan' }, y: { cc: 7, name: 'volume' }, rest: { x: 0.5, y: 0.8 } },
];

// The sequence a student sees on the first visit. r1x / r1y are the first
// region (filter), r2x / r2y the second (reverb + delay).
const DEFAULT_CODE = `setcpm(160/4)

p1: n("0 2 4 6 7 6 4 2")
  .scale("<c3:major>/2")
  .s("supersaw")
  .distort(0.7)
  .superimpose((x) => x.detune("<0.5>"))
  .lpenv(perlin.slow(3).range(1, 4))
  .lpf(r1x.range(100, 3000))
  .lpq(r1y.range(1, 20))
  .room(r2x.range(0, 0.8))
  .delay(r2y.range(0, 0.7))
  .gain(0.3)

p2: "<a1 e2>/8"
  .clip(0.6)
  .struct("x*8")
  .s("supersaw")
  .note()
  .lpf(r1x.range(200, 2000))
  .room(r2x.range(0, 0.5))
  .gain(0.35)`;

// Prepended to the student's code at every run. It defines r1x…r6y as
// Strudel signals that read the live region values, which is why moving a
// hand changes the sound without re-evaluating anything.
//
// No string literals in here on purpose: Strudel turns quoted text into
// mini-notation patterns, so 'x' would stop being the letter x.
// It is one long line on purpose: an error message about "line 7" then means
// line 6 of what the student actually typed, not line 3.
const PREAMBLE = [
  'const _rx = (i) => signal(() => SR.x(i));',
  'const _ry = (i) => signal(() => SR.y(i));',
  'const r1x = _rx(1), r1y = _ry(1), r2x = _rx(2), r2y = _ry(2), r3x = _rx(3), r3y = _ry(3);',
  'const r4x = _rx(4), r4y = _ry(4), r5x = _rx(5), r5y = _ry(5), r6x = _rx(6), r6y = _ry(6);',
  'const handsOpen = signal(() => SR.g());',
].join(' ');

// Appended when the "hands" button is on: postgain multiplies every pattern's
// output, so an open hand fades the whole page in and a fist fades it out
// without touching what the student wrote.
const GATE_LINE = 'all((x) => x.postgain(handsOpen))';

// ---- camera + detection state ------------------------------------------

let video = null;
let cameraReady = false;
let cameraStatus = 'waiting for camera permission…';
let srcW = VIDEO_W, srcH = VIDEO_H;
let mirror = true;          // a webcam facing you feels natural mirrored
let cameras = [];           // every video input the browser will admit to
let cameraId = null;        // the one we are using; null = the browser's choice
let cameraRetry = false;    // one automatic fallback if a saved camera is gone
let objectLabels = '';      // comma-separated COCO classes, blank = all
let points = [];            // this frame: [{x, y, kind, label, open}], x/y 0..1 in screen space
let openHands = 0;          // how many open hands are on screen right now
let lastOpenAt = -1e9;
let gate = 1;               // 0..1 — the sound follows this
let handsOn = true;         // the same thing as a yes/no: are hands in charge and open?
let wasHandsOn = true;      // last frame, so we can act on the moment it changes
let stopAt = null;          // when to stop the transport, once the fade has run
let starting = false;       // runCode() is async — don't start twice
let gestured = false;       // browsers keep audio silent until the page is touched once
let autoGate = true;        // "hands" button: hands start and stop the music
let gateWorks = true;       // false if this strudel build cannot take the gate line

const detectors = {
  hand: makeSlot('hand', 'hands', (cb) => ml5.handPose({ maxHands: 4, flipHorizontal: false }, cb)),
  pose: makeSlot('pose', 'people', (cb) => ml5.bodyPose('MoveNet', { modelType: 'MULTIPOSE_LIGHTNING' }, cb)),
  object: makeSlot('object', 'objects', (cb) => ml5.objectDetection('cocossd', {}, cb)),
};

// ---- regions -----------------------------------------------------------

const regions = [];         // see addRegion() for the shape
let drag = null;            // {mode: 'new' | 'move' | 'resize', region, ...}
let regionStatus = 'drag on the video to draw a region';

// ---- strudel -----------------------------------------------------------

let strudelRepl = null;
let strudelReady = false;
let strudelStatus = 'loading strudel…';
let evalError = '';
let playing = false;
let codeArea = null;

// ---- MIDI out (Web MIDI, Chrome/Edge) ----------------------------------

let midiAccess = null;
let midiOuts = [];          // MIDIOutput ports, refreshed on (dis)connect
let midiOutIndex = -1;      // -1 = off
let midiWanted = null;      // port id saved last time, reselected once access arrives
let midiChannel = 1;        // 1..16

// ---- p5 words Strudel takes over ---------------------------------------
// initStrudel() copies Strudel's whole vocabulary onto window, and two of the
// names are p5's too: color() and scale(). A moment after this page loads,
// window.scale is Strudel's musical scale and mirroring the video silently
// stops working. So: keep p5's scale here while it is still p5's (setup runs
// first), and read colours from hex ourselves — see rgb() near the bottom.
// Check this list again if you start using another p5 function in draw().
let p5Scale = null;

// ======================================================================
// setup
// ======================================================================

function setup() {
  p5Scale = window.scale;   // before initStrudel() replaces it — see above
  const cnv = createCanvas(CANVAS_W, Math.round(CANVAS_W * VIDEO_H / VIDEO_W));
  cnv.parent('canvas-holder');
  textFont('monospace');

  // the bridge the Strudel signals read every time the pattern is queried
  window.SR = {
    x: (id) => axisValue(id, 'x'),
    y: (id) => axisValue(id, 'y'),
    g: () => gate,
  };

  codeArea = document.getElementById('code');
  codeArea.value = DEFAULT_CODE;

  bindControls();
  bindCanvasInput(cnv.elt);
  restoreLocal();
  refreshDetectorButtons();
  buildRegionCards();
  initStrudelEngine();

  startCamera();

  // Browsers keep audio silent until the page has been touched once. A hand
  // in front of a camera is not a touch, so say so until it has happened.
  document.addEventListener('pointerdown', () => { gestured = true; });

  watchCamera();
  listCameras();
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', listCameras);
  }
}

// ======================================================================
// camera
// ======================================================================

function startCamera() {
  const wanted = { width: { ideal: VIDEO_W }, height: { ideal: VIDEO_H } };
  // No saved choice: let the browser pick, then remember what it gave us.
  if (cameraId) wanted.deviceId = { exact: cameraId };

  cameraStatus = 'starting the camera…';
  video = createCapture({ video: wanted, audio: false }, () => {
    // `ideal` is a hint. Size the element to what the camera actually gave
    // us — ml5 reads the element's width/height, so this keeps every model's
    // results in one coordinate space.
    srcW = video.elt.videoWidth || VIDEO_W;
    srcH = video.elt.videoHeight || VIDEO_H;
    video.size(srcW, srcH);
    resizeCanvas(CANVAS_W, Math.round(CANVAS_W * srcH / srcW));
    cameraReady = true;
    cameraRetry = false;
    rememberCamera();
    cameraStatus = `${cameraName()} ${srcW}×${srcH}`;
    listCameras();                  // labels only exist once permission is given
    for (const slot of Object.values(detectors)) startSlot(slot);
  });
  video.hide();
}

// Which camera did we actually get? The browser decides on the first run, and
// a phone's "environment" camera has a device id like any other.
function rememberCamera() {
  const stream = video && video.elt && video.elt.srcObject;
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  const settings = track && track.getSettings ? track.getSettings() : null;
  if (settings && settings.deviceId) cameraId = settings.deviceId;
}

// Let go of the camera properly: without stopping the tracks the machine keeps
// the old one open and may refuse to hand over the next one.
function stopCamera() {
  if (!video) return;
  const stream = video.elt && video.elt.srcObject;
  if (stream) for (const track of stream.getTracks()) track.stop();
  video.remove();
  video = null;
  cameraReady = false;
}

// The detectors hold on to the video element, so they have to let go before
// it is replaced — startCamera() starts them again on the new one.
function switchCamera(id) {
  if (!id || id === cameraId) return;
  cameraId = id;
  cameraRetry = false;
  // A rear camera should not be mirrored; anything pointing at you should be.
  mirror = !/back|rear|environment/i.test(cameraName());
  for (const slot of Object.values(detectors)) stopSlot(slot);
  stopCamera();
  startCamera();
  watchCamera();
  refreshDetectorButtons();
  saveLocal();
}

// A saved camera may have been unplugged since last time — fall back once.
function watchCamera() {
  setTimeout(() => {
    if (cameraReady) return;
    if (cameraId && !cameraRetry) {
      cameraRetry = true;
      cameraId = null;
      cameraStatus = 'that camera did not open — trying the default one';
      stopCamera();
      startCamera();
      watchCamera();
      return;
    }
    cameraStatus = 'no camera yet — allow it in the address bar, then reload';
  }, CAMERA_WAIT_MS);
}

// ---- the camera list ---------------------------------------------------
// Device labels are blank until the page has been given camera permission,
// which is why this is called again after the first capture starts.

async function listCameras() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: cameraLabel(d.label, i) }));
  } catch (err) {
    return;   // some browsers refuse before permission — try again later
  }
  buildCameraOptions();
}

// "HD Pro Webcam C920 (046d:082d)" is mostly noise on a small button
const cameraLabel = (label, i) =>
  (label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim() || `camera ${i + 1}`;

const cameraName = () => {
  const cam = cameras.find((c) => c.id === cameraId);
  return cam ? cam.label : 'camera';
};

function buildCameraOptions() {
  const pick = document.getElementById('camera-pick');
  if (!pick) return;
  pick.textContent = '';
  if (!cameras.length) {
    pick.appendChild(new Option('camera…', ''));
    return;
  }
  for (const cam of cameras) {
    const option = new Option(cam.label, cam.id);
    option.selected = cam.id === cameraId;
    pick.appendChild(option);
  }
}

// ======================================================================
// detectors — three ml5 models sharing one lifecycle
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
  console.error('[spaceregion]', slot.label, err);
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

// Math.hypot, not p5's dist() — Strudel has a dist() of its own and it wins
// (see "p5 words Strudel takes over" at the top).
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// how many of the four fingers are straight: 0 = fist, 4 = flat hand
function fingersOut(hand) {
  const kp = hand.keypoints;
  if (!kp || kp.length < 21) return -1;      // this model gave us no fingers
  const wrist = kp[0];
  let straight = 0;
  for (const [tip, joint] of FINGERS) {
    if (gap(wrist, kp[tip]) > gap(wrist, kp[joint]) * REACH) straight++;
  }
  return straight;
}

function collectPoints() {
  const out = [];

  if (detectors.hand.running) {
    for (const hand of detectors.hand.results) {
      if (!hand.keypoints || !hand.keypoints.length) continue;
      const conf = hand.confidence == null ? 1 : hand.confidence;
      if (conf < CONFIDENCE) continue;
      const c = centroid(hand.keypoints);
      const straight = fingersOut(hand);
      const open = straight < 0 ? true : straight >= OPEN_FINGERS;
      out.push({
        ...normPt(c.x, c.y),
        kind: 'hand',
        label: straight < 0 ? String(hand.handedness || '').toLowerCase() : (open ? 'open' : 'closed'),
        open,
      });
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
// regions — where in the box, not whether
// ======================================================================

const presetOf = (region) => PRESETS.find((p) => p.id === region.preset) || PRESETS[0];
const regionById = (id) => regions.find((r) => r.id === id) || null;
const regionAccepts = (region, p) => region.source === 'any' || region.source === p.kind;

function pointInRegion(region, p) {
  return p.x >= region.x && p.x <= region.x + region.w && p.y >= region.y && p.y <= region.y + region.h;
}

// what the Strudel signals and the meters read
function axisValue(id, axis) {
  const region = regionById(Number(id));
  return region ? region.val[axis] : 0;
}

function freeId() {
  for (let id = 1; id <= MAX_REGIONS; id++) if (!regionById(id)) return id;
  return null;
}

function addRegion(x, y) {
  const id = freeId();
  if (id === null) {
    regionStatus = `${MAX_REGIONS} regions is the limit — remove one first`;
    return null;
  }
  const preset = PRESETS[(id - 1) % PRESETS.length].id;
  const region = {
    id, x, y, w: 0, h: 0,
    preset,
    source: 'any',
    hold: true,               // keep the last value when nobody is inside
    active: false,
    lastSeen: -1e9,
    val: { x: 0, y: 0 },      // smoothed, 0..1 — what the sound actually uses
    target: { x: 0, y: 0 },
    sent: { x: -1, y: -1 },   // last MIDI value, so we only send changes
    lastSendAt: 0,
    card: null,
  };
  const rest = PRESETS.find((p) => p.id === preset).rest;
  region.val = { ...rest };
  region.target = { ...rest };
  regions.push(region);
  return region;
}

function removeRegion(region) {
  const i = regions.indexOf(region);
  if (i < 0) return;
  regions.splice(i, 1);
  buildRegionCards();
  saveLocal();
}

function clearRegions() {
  regions.length = 0;
  regionStatus = 'regions cleared';
  buildRegionCards();
  saveLocal();
}

function cyclePreset(region) {
  const i = PRESETS.findIndex((p) => p.id === region.preset);
  const next = PRESETS[(i + 1) % PRESETS.length];
  region.preset = next.id;
  region.sent = { x: -1, y: -1 };   // different CCs — resend at the next chance
  regionStatus = `r${region.id}: ${next.id} — x ${next.x.name}, y ${next.y.name}`;
  buildRegionCards();
  saveLocal();
}

function cycleSource(region) {
  region.source = SOURCES[(SOURCES.indexOf(region.source) + 1) % SOURCES.length];
  regionStatus = `r${region.id} follows ${region.source}`;
  buildRegionCards();
  saveLocal();
}

function toggleHold(region) {
  region.hold = !region.hold;
  regionStatus = `r${region.id} ${region.hold ? 'holds its value' : 'falls back to rest'} when empty`;
  buildRegionCards();
  saveLocal();
}

function updateRegions(now) {
  // Closed hands freeze everything: the regions keep their last values and
  // no CC goes out, so you can walk out of frame without smearing the sound.
  if (!handsOn) return;

  for (const region of regions) {
    if (drag && drag.region === region) continue;   // don't read it while it is being drawn

    const p = points.find((pt) => regionAccepts(region, pt) && pointInRegion(region, pt));
    if (p) {
      region.lastSeen = now;
      region.target.x = constrain((p.x - region.x) / region.w, 0, 1);
      // up = more: the natural direction for a fader
      region.target.y = 1 - constrain((p.y - region.y) / region.h, 0, 1);
    }

    region.active = !!p || now - region.lastSeen < LINGER_MS;
    if (!region.active && !region.hold) {
      const rest = presetOf(region).rest;
      region.target.x = rest.x;
      region.target.y = rest.y;
    }

    // glide instead of jumping — a detector that flickers by a few pixels
    // would otherwise sound like a zipper on the filter
    region.val.x += (region.target.x - region.val.x) * SMOOTH;
    region.val.y += (region.target.y - region.val.y) * SMOOTH;

    sendRegion(region, now);
  }
}

function sendRegion(region, now) {
  if (now - region.lastSendAt < SEND_MS) return;
  region.lastSendAt = now;
  const preset = presetOf(region);
  for (const axis of ['x', 'y']) {
    const value = Math.round(constrain(region.val[axis], 0, 1) * 127);
    if (value === region.sent[axis]) continue;      // MIDI hates being told the same thing
    region.sent[axis] = value;
    midiSend([0xb0 | (midiChannel - 1), preset[axis].cc, value]);
  }
}

// ======================================================================
// the hand gate — an open hand anywhere plays, every hand closed mutes
// ======================================================================

function updateGate(now) {
  // While the camera is being swapped there are no hands to see. Sit still
  // rather than reading that as "everybody closed their hands" and stopping.
  if (!cameraReady) return;

  openHands = points.reduce((n, p) => n + (p.kind === 'hand' && p.open ? 1 : 0), 0);
  if (openHands > 0) lastOpenAt = now;

  // With the button off, or with no hand model running, the hands are not in
  // charge — otherwise switching a detector off would silence the page.
  const handsRule = autoGate && detectors.hand.running;
  handsOn = !handsRule || now - lastOpenAt < HAND_LINGER_MS;
  gate += ((handsOn ? 1 : 0) - gate) * GATE_SMOOTH;

  // Act on the *moment* hands open or close, not on every frame: pressing
  // play by hand then keeps working until you close your hands and open them
  // again, instead of being overruled immediately.
  if (handsRule) {
    if (handsOn && !wasHandsOn) {
      stopAt = null;                       // opened again mid-fade — carry on
      if (!playing) startFromHands();      // the first open hand starts the music
    } else if (!handsOn && wasHandsOn && playing) {
      stopAt = now + FADE_OUT_MS;          // both closed: fade, then stop
    }
  }
  if (stopAt !== null && now >= stopAt) {
    stopAt = null;
    if (playing) stopSound();
  }
  wasHandsOn = handsOn;
}

async function startFromHands() {
  if (starting || playing) return;
  starting = true;
  await runCode();
  starting = false;
}

function gateText() {
  if (!autoGate) return 'hands off — play and stop by hand';
  if (!detectors.hand.running) return 'hands need the hand model — turn it on';
  if (!gestured) return 'click the page once, then open a hand';
  if (openHands > 0) return `${openHands} open hand${openHands === 1 ? '' : 's'} — playing`;
  if (stopAt !== null) return 'closing…';
  return playing ? 'closing…' : 'open a hand to start · values frozen';
}

function toggleGate() {
  autoGate = !autoGate;
  wasHandsOn = true;        // a closed hand now counts as a fresh "closed" edge
  stopAt = null;
  document.getElementById('hand-gate').classList.toggle('on', autoGate);
  regionStatus = autoGate
    ? 'open a hand to start, close both to stop'
    : 'the sound plays whatever your hands do';
  saveLocal();
  if (playing) runCode();   // the gate line is part of the code, so re-run it
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

    // topmost region first — the last one drawn sits on top
    for (let i = regions.length - 1; i >= 0; i--) {
      const region = regions[i];
      const box = regionBox(region);
      if (inBox(px, box.x + box.w - HANDLE, box.y, HANDLE, HANDLE)) { removeRegion(region); return; }
      if (inBox(px, box.x, box.y, HANDLE, HANDLE)) { cyclePreset(region); return; }
      if (inBox(px, box.x, box.y + box.h - HANDLE, HANDLE, HANDLE)) { cycleSource(region); return; }
      if (inBox(px, box.x + box.w - HANDLE, box.y + box.h - HANDLE, HANDLE, HANDLE)) {
        drag = { mode: 'resize', region };
      } else if (inBox(px, box.x, box.y, box.w, box.h)) {
        drag = { mode: 'move', region, dx: p.x - region.x, dy: p.y - region.y };
      } else {
        continue;
      }
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const region = addRegion(p.x, p.y);
    if (!region) return;
    drag = { mode: 'new', region, ax: p.x, ay: p.y };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = norm(e);
    const region = drag.region;
    if (drag.mode === 'new') {
      region.x = Math.min(drag.ax, p.x);
      region.y = Math.min(drag.ay, p.y);
      region.w = Math.abs(p.x - drag.ax);
      region.h = Math.abs(p.y - drag.ay);
    } else if (drag.mode === 'move') {
      region.x = constrain(p.x - drag.dx, 0, 1 - region.w);
      region.y = constrain(p.y - drag.dy, 0, 1 - region.h);
    } else if (drag.mode === 'resize') {
      region.w = constrain(p.x - region.x, MIN_REGION, 1 - region.x);
      region.h = constrain(p.y - region.y, MIN_REGION, 1 - region.y);
    }
  });

  const finish = () => {
    if (!drag) return;
    const region = drag.region;
    if (drag.mode === 'new' && (region.w < MIN_REGION || region.h < MIN_REGION)) {
      regions.splice(regions.indexOf(region), 1);   // a click, not a region
    } else if (drag.mode === 'new') {
      const preset = presetOf(region);
      regionStatus = `r${region.id} added — x is ${preset.x.name}, y is ${preset.y.name}`;
    }
    region.lastSeen = -1e9;   // don't let the drag itself count as a sighting
    drag = null;
    buildRegionCards();
    saveLocal();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}

const inBox = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
const regionBox = (r) => ({ x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height });

// ======================================================================
// strudel — the student's sequence, plus the preamble that lets the
// regions move its knobs without re-running the code
// ======================================================================

function initStrudelEngine() {
  if (typeof initStrudel !== 'function') {
    strudelStatus = 'could not load @strudel/web';
    return;
  }
  initStrudel({
    prebake: () => loadStrudelCcSounds(),
    onEvalError: (err) => { evalError = err && err.message ? err.message : String(err); },
  }).then((repl) => {
    strudelRepl = repl;
    bindHush();
    strudelReady = true;
    strudelStatus = typeof signal === 'function'
      ? 'ready — press play'
      : 'ready, but this strudel build has no signal() — the camera cannot reach it';
  }).catch((err) => {
    strudelStatus = 'strudel failed: ' + (err.message || err);
  });
}

// After evaluate(), @strudel/web replaces window.hush with a helper that only
// returns silence and does not stop the scheduler. Always stop via the repl.
function bindHush() {
  window.hush = stopSound;
}

async function runCode() {
  if (!strudelReady) { regionStatus = strudelStatus; return; }
  showError('');

  const withGate = autoGate && gateWorks;
  let pattern = await tryEvaluate(codeToRun(withGate));

  // Older strudel builds have no all() or no postgain(). Rather than leave the
  // student with silence, run their sequence without the gate and say so.
  if (!pattern && withGate) {
    pattern = await tryEvaluate(codeToRun(false));
    if (pattern) gateWorks = false;
  }

  if (!pattern) {
    playing = false;
    strudelStatus = 'the sequence has an error';
    showError(evalError || 'could not read the sequence');
    return;
  }

  playing = true;
  strudelStatus = gateWorks && autoGate ? 'playing — open a hand' : 'playing';
  saveLocal();
}

const codeToRun = (withGate) =>
  PREAMBLE + '\n' + codeArea.value + (withGate ? '\n' + GATE_LINE : '');

async function tryEvaluate(code) {
  evalError = '';
  try {
    const pattern = await evaluate(code);
    bindHush();
    return pattern || null;
  } catch (err) {
    evalError = err.message || String(err);
    return null;
  }
}

function stopSound() {
  if (strudelRepl && typeof strudelRepl.stop === 'function') strudelRepl.stop();
  playing = false;
  strudelStatus = 'stopped';
  bindHush();
}

function showError(message) {
  document.getElementById('code-error').textContent = message;
}

// ======================================================================
// MIDI out
// ======================================================================

const midiOutput = () => (midiOutIndex >= 0 ? midiOuts[midiOutIndex] : null);

function midiSend(bytes) {
  const out = midiOutput();
  if (!out) return;
  try { out.send(bytes); } catch (err) { /* port vanished mid-send */ }
}

function requestMidi(then) {
  if (midiAccess) { then(); return; }
  if (!navigator.requestMIDIAccess) {
    regionStatus = 'no Web MIDI in this browser — use Chrome or Edge';
    return;
  }
  navigator.requestMIDIAccess().then((access) => {
    midiAccess = access;
    access.onstatechange = refreshMidiOuts;   // plugging / unplugging devices
    refreshMidiOuts();
    then();
  }, () => { regionStatus = 'MIDI access denied'; });
}

function refreshMidiOuts() {
  const chosen = midiOutput();
  midiOuts = midiAccess ? [...midiAccess.outputs.values()] : [];
  const wanted = (chosen && chosen.id) || midiWanted;
  midiOutIndex = wanted ? midiOuts.findIndex((o) => o.id === wanted) : -1;
  if (midiOutIndex >= 0) midiWanted = null;
  refreshMidiButton();
}

function cycleMidiOut() {
  requestMidi(() => {
    if (!midiOuts.length) {
      regionStatus = 'no MIDI outputs found — connect a device or enable the IAC driver';
      midiOutIndex = -1;
      refreshMidiButton();
      return;
    }
    midiOutIndex = midiOutIndex + 1 >= midiOuts.length ? -1 : midiOutIndex + 1;
    const out = midiOutput();
    regionStatus = out ? `MIDI out: ${out.name}` : 'MIDI out off';
    for (const region of regions) region.sent = { x: -1, y: -1 };   // resend into the new port
    refreshMidiButton();
    saveLocal();
  });
}

function refreshMidiButton() {
  const button = document.getElementById('midi-out');
  const out = midiOutput();
  button.textContent = out ? `midi: ${shorten(out.name || 'output')}` : 'midi';
  button.classList.toggle('on', !!out);
  document.getElementById('midi-channel').textContent = `ch ${midiChannel}`;
}

// ======================================================================
// the cards under the video: one per region, with live meters
// ======================================================================

function buildRegionCards() {
  const holder = document.getElementById('region-cards');
  holder.textContent = '';

  for (const region of [...regions].sort((a, b) => a.id - b.id)) {
    const preset = presetOf(region);
    const card = document.createElement('div');
    card.className = 'region-card';

    const head = document.createElement('div');
    head.className = 'region-head';
    head.innerHTML = `<span class="name">r${region.id}</span><span class="preset">${preset.id}</span>`;
    card.appendChild(head);

    region.meters = {};
    for (const axis of ['x', 'y']) {
      const row = document.createElement('div');
      row.className = `region-row ${axis}`;
      const label = document.createElement('div');
      label.className = 'label';
      label.innerHTML = `<span>r${region.id}${axis} · ${preset[axis].name}</span><b>CC${preset[axis].cc}</b>`;
      const meter = document.createElement('div');
      meter.className = 'meter';
      const fill = document.createElement('span');
      meter.appendChild(fill);
      row.appendChild(label);
      row.appendChild(meter);
      card.appendChild(row);
      region.meters[axis] = fill;
    }

    const buttons = document.createElement('div');
    buttons.className = 'region-buttons';
    buttons.appendChild(cardButton(preset.id, () => cyclePreset(region)));
    buttons.appendChild(cardButton(region.source, () => cycleSource(region)));
    buttons.appendChild(cardButton(region.hold ? 'hold' : 'rest', () => toggleHold(region)));
    buttons.appendChild(cardButton('×', () => removeRegion(region)));
    card.appendChild(buttons);

    region.card = card;
    holder.appendChild(card);
  }

  if (!regions.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No regions yet — drag a box onto the video above.';
    holder.appendChild(empty);
  }
}

function cardButton(label, onClick) {
  const button = document.createElement('button');
  button.className = 'btn';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function refreshDetectorButtons() {
  for (const slot of Object.values(detectors)) {
    document.getElementById('det-' + slot.key).classList.toggle('on', slot.enabled);
  }
  document.getElementById('mirror').classList.toggle('on', mirror);
  document.getElementById('hand-gate').classList.toggle('on', autoGate);
  document.getElementById('play').classList.toggle('on', playing);
}

function bindControls() {
  for (const slot of Object.values(detectors)) {
    document.getElementById('det-' + slot.key).addEventListener('click', () => setDetector(slot, !slot.enabled));
  }
  const labels = document.getElementById('object-labels');
  labels.addEventListener('input', () => { objectLabels = labels.value; saveLocal(); });
  document.getElementById('camera-pick').addEventListener('change', (e) => switchCamera(e.target.value));
  document.getElementById('mirror').addEventListener('click', () => {
    mirror = !mirror;
    refreshDetectorButtons();
    saveLocal();
  });

  document.getElementById('midi-out').addEventListener('click', cycleMidiOut);
  document.getElementById('midi-channel').addEventListener('click', () => {
    midiChannel = midiChannel >= 16 ? 1 : midiChannel + 1;
    refreshMidiButton();
    saveLocal();
  });

  document.getElementById('hand-gate').addEventListener('click', toggleGate);
  document.getElementById('play').addEventListener('click', runCode);
  document.getElementById('stop').addEventListener('click', stopSound);
  document.getElementById('reset-code').addEventListener('click', () => {
    codeArea.value = DEFAULT_CODE;
    showError('');
    saveLocal();
  });
  codeArea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runCode(); }
  });
  codeArea.addEventListener('change', saveLocal);

  document.getElementById('clear-regions').addEventListener('click', clearRegions);
  document.getElementById('save-settings').addEventListener('click', saveSettings);
  document.getElementById('load-settings').addEventListener('click', () => {
    document.getElementById('load-file').click();
  });
  document.getElementById('load-file').addEventListener('change', loadSettings);
}

// ======================================================================
// persistence
//   localStorage  — regions, sequence, detectors: survives a reload
//   save / load   — the same two things as one JSON file, to hand in
// ======================================================================

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      regions: regions.map(serializeRegion),
      code: codeArea.value,
      detectors: Object.fromEntries(Object.values(detectors).map((s) => [s.key, s.enabled])),
      mirror,
      cameraId,
      objectLabels,
      midiChannel,
      autoGate,
      midiOut: midiOutput() ? midiOutput().id : midiWanted,
    }));
  } catch (err) { /* private mode etc. — nothing to do */ }
}

function restoreLocal() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (err) { /* ignore */ }

  if (saved && typeof saved === 'object') {
    if (Array.isArray(saved.regions)) applyRegions(saved.regions);
    if (typeof saved.code === 'string' && saved.code.trim()) codeArea.value = saved.code;
    if (typeof saved.mirror === 'boolean') mirror = saved.mirror;
    if (typeof saved.cameraId === 'string' && saved.cameraId) cameraId = saved.cameraId;
    if (typeof saved.objectLabels === 'string') objectLabels = saved.objectLabels;
    if (Number.isInteger(saved.midiChannel)) midiChannel = constrain(saved.midiChannel, 1, 16);
    if (typeof saved.autoGate === 'boolean') autoGate = saved.autoGate;
    document.getElementById('object-labels').value = objectLabels;
    if (typeof saved.midiOut === 'string') {
      midiWanted = saved.midiOut;
      requestMidi(() => {});   // permission already granted last time, so no prompt
    }
    const chosen = saved.detectors && typeof saved.detectors === 'object' ? saved.detectors : null;
    for (const slot of Object.values(detectors)) setDetector(slot, chosen ? !!chosen[slot.key] : slot.key === 'hand');
  } else {
    setDetector(detectors.hand, true);
    defaultRegions();          // first visit: something to move a hand through
  }
  refreshMidiButton();
}

// left half filters, right half is reverb and delay — the two the sequence uses
function defaultRegions() {
  const filter = addRegion(0.06, 0.30);
  if (filter) { filter.w = 0.38; filter.h = 0.55; filter.preset = 'filter'; }
  const space = addRegion(0.56, 0.30);
  if (space) { space.w = 0.38; space.h = 0.55; space.preset = 'space'; }
  for (const region of regions) {
    const rest = presetOf(region).rest;
    region.val = { ...rest };
    region.target = { ...rest };
  }
}

const serializeRegion = (r) => ({
  id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, preset: r.preset, source: r.source, hold: r.hold,
});

function applyRegions(list) {
  regions.length = 0;
  for (const item of list) {
    const region = addRegion(constrain(Number(item.x) || 0, 0, 1), constrain(Number(item.y) || 0, 0, 1));
    if (!region) break;
    region.w = constrain(Number(item.w) || 0, MIN_REGION, 1 - region.x);
    region.h = constrain(Number(item.h) || 0, MIN_REGION, 1 - region.y);
    if (PRESETS.some((p) => p.id === item.preset)) region.preset = item.preset;
    if (SOURCES.includes(item.source)) region.source = item.source;
    if (typeof item.hold === 'boolean') region.hold = item.hold;
    const rest = presetOf(region).rest;
    region.val = { ...rest };
    region.target = { ...rest };
  }
}

function saveSettings() {
  const blob = new Blob([JSON.stringify({
    version: 1,
    code: codeArea.value,
    regions: regions.map(serializeRegion),
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'soundspace-spaceregion.json';
  link.click();
  URL.revokeObjectURL(url);
  regionStatus = 'regions and sequence saved';
}

function loadSettings(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const saved = JSON.parse(reader.result);
      if (saved.version !== 1) throw new Error('unsupported settings file');
      if (Array.isArray(saved.regions)) applyRegions(saved.regions);
      if (typeof saved.code === 'string' && saved.code.trim()) codeArea.value = saved.code;
      buildRegionCards();
      saveLocal();
      regionStatus = 'loaded — press play to hear it';
    } catch (error) {
      regionStatus = 'could not load settings: ' + error.message;
    }
    input.value = '';
  };
  reader.onerror = () => { regionStatus = 'could not read settings file'; input.value = ''; };
  reader.readAsText(file);
}

// ======================================================================
// display
// ======================================================================

function shorten(name) {
  return name.length > 14 ? name.slice(0, 13) + '…' : name;
}

// p5's color() is gone by the time draw() runs (see "p5 words Strudel takes
// over" at the top), so read the hex ourselves instead of asking p5 for a
// colour object.
const RGB_CACHE = {};

function rgb(hex) {
  if (!RGB_CACHE[hex]) {
    RGB_CACHE[hex] = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  return RGB_CACHE[hex];
}

function draw() {
  background('#1a1a2e');

  if (cameraReady) {
    push();
    if (mirror) { translate(width, 0); p5Scale(-1, 1); }
    image(video, 0, 0, width, height);
    pop();
    points = collectPoints();
  } else {
    points = [];
  }

  const now = millis();
  updateGate(now);
  updateRegions(now);
  drawRegions();
  drawPoints();
  drawHUD();
  refreshMeters();
}

function drawRegions() {
  for (const region of regions) {
    const box = regionBox(region);
    const tint = region.source === 'any' ? '#ffcc66' : COLORS[region.source];
    const [tr, tg, tb] = rgb(tint);
    fill(tr, tg, tb, region.active ? 90 : 35);
    stroke(tr, tg, tb);
    strokeWeight(region.active ? 3 : 1.5);
    rect(box.x, box.y, box.w, box.h, 6);

    // the crosshair is the value: where the sound is right now
    const cx = box.x + region.val.x * box.w;
    const cy = box.y + (1 - region.val.y) * box.h;
    strokeWeight(1.5);
    stroke(AXIS_COLORS.x); line(cx, box.y, cx, box.y + box.h);
    stroke(AXIS_COLORS.y); line(box.x, cy, box.x + box.w, cy);
    noStroke();
    fill(region.active && handsOn ? '#ffffff' : '#8888aa');
    circle(cx, cy, region.active && handsOn ? 10 : 6);

    // corner handles: preset, ×, source, resize
    const preset = presetOf(region);
    fill(tr, tg, tb, 200);
    rect(box.x, box.y, HANDLE, HANDLE, 6, 0, 0, 0);
    rect(box.x + box.w - HANDLE, box.y, HANDLE, HANDLE, 0, 6, 0, 0);
    rect(box.x, box.y + box.h - HANDLE, HANDLE, HANDLE, 0, 0, 0, 6);
    triangle(box.x + box.w, box.y + box.h - HANDLE, box.x + box.w, box.y + box.h, box.x + box.w - HANDLE, box.y + box.h);
    fill('#1a1a2e');
    textAlign(CENTER, CENTER); textSize(11);
    text(preset.id[0], box.x + HANDLE / 2, box.y + HANDLE / 2 - 1);
    text('×', box.x + box.w - HANDLE / 2, box.y + HANDLE / 2 - 1);
    text(region.source === 'any' ? '◎' : region.source[0], box.x + HANDLE / 2, box.y + box.h - HANDLE / 2 - 1);

    // name and what the two axes are doing
    fill('#e0e0ff');
    textSize(Math.min(20, box.h * 0.28));
    text(`r${region.id}`, box.x + box.w / 2, box.y + box.h / 2 - 10);
    if (box.h > 54 && box.w > 90) {
      textSize(10);
      fill(AXIS_COLORS.x);
      text(`${preset.x.name} ${Math.round(region.val.x * 127)}`, box.x + box.w / 2, box.y + box.h / 2 + 8);
      fill(AXIS_COLORS.y);
      text(`${preset.y.name} ${Math.round(region.val.y * 127)}`, box.x + box.w / 2, box.y + box.h / 2 + 21);
    }
    textAlign(LEFT, BASELINE);
  }
  strokeWeight(1);
}

function drawPoints() {
  for (const p of points) {
    const x = p.x * width, y = p.y * height;
    const [pr, pg, pb] = rgb(COLORS[p.kind]);
    // an open hand is a ring, a closed one is a solid dot — readable at a glance
    if (p.kind === 'hand' && p.open) {
      stroke(pr, pg, pb); strokeWeight(3); noFill();
      circle(x, y, 18);
    }
    stroke('#1a1a2e'); strokeWeight(1.5);
    fill(pr, pg, pb);
    circle(x, y, p.kind === 'hand' && p.open ? 8 : 14);
    noStroke();
    fill('#e0e0ff'); textSize(10); textAlign(LEFT, BASELINE);
    text(p.label || p.kind, x + 10, y + 4);
  }
  strokeWeight(1);
}

function drawHUD() {
  noStroke();
  fill(26, 26, 46, 190);
  rect(0, 0, width, 70);

  fill('#e0e0ff'); textSize(14); textAlign(LEFT, BASELINE);
  text('SoundSpace&Body space region', 16, 22);

  fill('#8888aa'); textSize(11);
  const det = Object.values(detectors).map((s) => `${s.label} ${slotStatus(s)}`).join(' · ');
  text(`${cameraStatus} · ${det}`, 16, 40);
  text(`${strudelStatus} · ${gateText()} · ${regionStatus}`, 16, 54);

  // how open the sound is — the bar lives below the text, clear of the
  // midi button that floats over the top-right corner
  if (autoGate) {
    fill(85, 85, 119);
    rect(16, 60, 120, 5, 3);
    fill(gate > 0.02 ? '#ffcc66' : '#555577');
    rect(16, 60, 120 * constrain(gate, 0, 1), 5, 3);
  }

  // the right column starts at y 40 — the midi button sits over the top line
  textAlign(RIGHT, BASELINE);
  fill('#ffcc66'); textSize(12);
  if (!gestured) {
    text('click the page once to allow sound', width - 16, 40);
  } else if (!playing) {
    text(autoGate ? 'open a hand to start' : 'press play to start the sound', width - 16, 40);
  } else {
    text(`ch ${midiChannel}`, width - 16, 40);
  }
  if (!regions.length && cameraReady) {
    fill('#8888aa'); textSize(11);
    text('drag on the video to draw a region', width - 16, 54);
  }
  textAlign(LEFT, BASELINE);
}

// the meters under the video, so the numbers are readable while you move
function refreshMeters() {
  for (const region of regions) {
    if (!region.meters) continue;
    region.meters.x.style.width = `${constrain(region.val.x, 0, 1) * 100}%`;
    region.meters.y.style.width = `${constrain(region.val.y, 0, 1) * 100}%`;
    if (region.card) region.card.classList.toggle('active', region.active);
  }
  document.getElementById('play').classList.toggle('on', playing);
}
