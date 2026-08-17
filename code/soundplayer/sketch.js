// SoundSpace p5.js sound player
//
// Plays notes from MIDI input (Web MIDI API) or the computer keyboard
// (keys c d e f g a b = the C4 major scale).
//
// By default notes play a simple synthesized tone. Drop an audio file directly
// onto a note button to assign a different sample to that note.
// Press Delete/Backspace to clear all assignments.

// letter key -> MIDI note (C4 major scale)
const KEYMAP = { c: 60, d: 62, e: 64, f: 65, g: 67, a: 69, b: 71 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_W = 90, KEY_H = 130, KEY_GAP = 8, KEY_X = 20, KEY_Y = 170;
const AUDIO_FILE = /\.(wav|mp3|ogg|m4a|aiff?|flac)$/i;

const activeOscs = new Map();   // note -> {osc, env}, for tone mode
const activeSamples = new Map();// note -> {file, token}
const noteSounds = new Map();   // note -> {file, name}
const activeNotes = new Set();  // notes currently sounding (for display)
const heldNotes = new Set();    // prevents key repeat from retriggering
const noteModes = new Map(Object.values(KEYMAP).map((note) => [note, 'momentary']));
let lastNote = null;
let midiStatus = 'requesting MIDI access...';
let midiInputs = [];
let soundStatus = 'drop an audio file directly onto a note button';
let dropHoverNote = null;

let textInput;

function setup() {
  const cnv = createCanvas(720, 340);
  cnv.parent('canvas-holder');
  textFont('monospace');
  initMIDI();

  textInput = createInput();
  textInput.parent('input-slot');
  textInput.addClass('btn');
  textInput.attribute('placeholder', 'type c d e f g a b to play notes');
  textInput.attribute('autocomplete', 'off');

  bindSettings();
  bindCanvasInput(cnv.elt);
}

// ---------------------------------------------------------------- playback

function noteOn(note, velocity = 100) {
  if (heldNotes.has(note)) return;
  heldNotes.add(note);
  userStartAudio(); // browsers require a gesture before audio starts
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
    const previous = activeSamples.get(note);
    if (previous) activeSamples.delete(note);
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
}

// ------------------------------------------------------------ MIDI input

function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    midiStatus = 'Web MIDI not supported (use Chrome/Edge)';
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
    };
    access.onstatechange = rescan;
    rescan();
  }, () => { midiStatus = 'MIDI access denied'; });
}

function onMIDIMessage(msg) {
  const [status, note, velocity] = msg.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && velocity > 0) noteOn(note, velocity);
  else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) noteOff(note);
}

// -------------------------------------------------------- keyboard input

function keyPressed() {
  const editingInput = document.activeElement === textInput.elt;
  if (!editingInput && (keyCode === DELETE || keyCode === BACKSPACE)) {
    clearAssignedSounds();
    return;
  }
  const note = KEYMAP[key.toLowerCase()];
  if (note !== undefined) noteOn(note);
}

function keyReleased() {
  const note = KEYMAP[key.toLowerCase()];
  if (note !== undefined) noteOff(note);
}

// -------------------------------------------------------- drag and drop

function bindCanvasInput(canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    const note = noteFromEvent(event, canvas);
    if (note === null) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.pointerNote = note;
    noteOn(note);
  });

  const releasePointer = (event) => {
    const note = Number(canvas.dataset.pointerNote);
    if (Number.isFinite(note)) noteOff(note);
    delete canvas.dataset.pointerNote;
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  canvas.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropHoverNote = noteFromEvent(event, canvas);
    event.dataTransfer.dropEffect = dropHoverNote === null ? 'none' : 'copy';
  });
  canvas.addEventListener('dragleave', () => { dropHoverNote = null; });
  canvas.addEventListener('drop', (event) => {
    event.preventDefault();
    const note = noteFromEvent(event, canvas);
    dropHoverNote = null;
    if (note === null) {
      soundStatus = 'drop the file inside one of the note buttons';
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file) assignSound(note, file);
  });
}

function noteFromEvent(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * width / bounds.width;
  const y = (event.clientY - bounds.top) * height / bounds.height;
  if (y < KEY_Y || y > KEY_Y + KEY_H) return null;
  const index = Math.floor((x - KEY_X) / (KEY_W + KEY_GAP));
  const localX = x - KEY_X - index * (KEY_W + KEY_GAP);
  if (index < 0 || index >= Object.keys(KEYMAP).length || localX < 0 || localX > KEY_W) return null;
  return Object.values(KEYMAP)[index];
}

function assignSound(note, file) {
  if (!file.type.startsWith('audio/') && !AUDIO_FILE.test(file.name)) {
    soundStatus = 'not an audio file: ' + file.name;
    return;
  }

  const reader = new FileReader();
  soundStatus = `loading ${file.name} for ${noteName(note)}...`;
  reader.onload = () => loadSound(reader.result, (sf) => {
    stopNote(note);
    const previous = noteSounds.get(note);
    if (previous) previous.file.stop();
    noteSounds.set(note, { file: sf, name: file.name, data: reader.result });
    soundStatus = `${file.name} assigned to ${noteName(note)}`;
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
}

function bindSettings() {
  const settings = document.getElementById('note-settings');
  const modes = [
    { id: 'momentary', label: 'gate' },
    { id: 'play-through', label: 'one-shot' },
    { id: 'loop', label: 'loop' },
  ];

  for (const note of Object.values(KEYMAP)) {
    const group = document.createElement('div');
    group.className = 'note-setting';

    for (const mode of modes) {
      const button = document.createElement('button');
      button.className = 'btn' + (mode.id === 'momentary' ? ' on' : '');
      button.textContent = mode.label;
      button.dataset.note = note;
      button.dataset.mode = mode.id;
      button.setAttribute('aria-label', `${noteName(note)} ${mode.label} trigger`);
      button.addEventListener('click', () => {
        stopNote(note);
        heldNotes.delete(note);
        noteModes.set(note, mode.id);
        for (const item of group.querySelectorAll('.btn')) {
          item.classList.toggle('on', item === button);
        }
      });
      group.appendChild(button);
    }
    settings.appendChild(group);
  }

  document.getElementById('clear-sounds').addEventListener('click', clearAssignedSounds);
  document.getElementById('save-settings').addEventListener('click', saveSettings);
  document.getElementById('load-settings').addEventListener('click', () => {
    document.getElementById('load-file').click();
  });
  document.getElementById('load-file').addEventListener('change', loadSettings);
}

function saveSettings() {
  const notes = Object.values(KEYMAP).map((note) => {
    const assigned = noteSounds.get(note);
    return {
      note,
      mode: noteModes.get(note) || 'momentary',
      name: assigned ? assigned.name : null,
      data: assigned ? assigned.data : null,
    };
  });
  const blob = new Blob([JSON.stringify({ version: 1, notes })], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'soundspace-sampler.json';
  link.click();
  URL.revokeObjectURL(url);
  soundStatus = 'sampler settings saved';
}

function loadSettings(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const saved = JSON.parse(reader.result);
      if (saved.version !== 1 || !Array.isArray(saved.notes)) {
        throw new Error('unsupported settings file');
      }

      allNotesOff();
      for (const assigned of noteSounds.values()) assigned.file.stop();
      noteSounds.clear();

      let soundsToLoad = 0;
      let soundsLoaded = 0;
      for (const item of saved.notes) {
        const note = Number(item.note);
        if (!Object.values(KEYMAP).includes(note)) continue;

        if (['momentary', 'play-through', 'loop'].includes(item.mode)) {
          noteModes.set(note, item.mode);
        }
        if (typeof item.data === 'string' && typeof item.name === 'string') {
          soundsToLoad++;
          loadSound(item.data, (sf) => {
            noteSounds.set(note, { file: sf, name: item.name, data: item.data });
            soundsLoaded++;
            soundStatus = soundsLoaded === soundsToLoad
              ? `loaded ${soundsLoaded} assigned sound${soundsLoaded === 1 ? '' : 's'}`
              : `loading assigned sounds: ${soundsLoaded}/${soundsToLoad}`;
          }, () => {
            soundStatus = `failed to load ${item.name}`;
          });
        }
      }
      refreshModeButtons();
      if (soundsToLoad === 0) soundStatus = 'sampler settings loaded';
    } catch (error) {
      soundStatus = 'could not load settings: ' + error.message;
    }
    input.value = '';
  };
  reader.onerror = () => {
    soundStatus = 'could not read settings file';
    input.value = '';
  };
  reader.readAsText(file);
}

function refreshModeButtons() {
  for (const button of document.querySelectorAll('#note-settings [data-mode]')) {
    const note = Number(button.dataset.note);
    button.classList.toggle('on', noteModes.get(note) === button.dataset.mode);
  }
}

// --------------------------------------------------------------- display

function noteName(n) {
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

function draw() {
  background('#1a1a2e');

  fill('#e0e0ff'); noStroke(); textSize(16);
  text('SoundSpace sound player', 20, 30);

  textSize(12); fill('#8888aa');
  text(midiStatus, 20, 55);
  text(soundStatus, 20, 75);
  text('keys c d e f g a b play notes / drop a sound directly onto each button', 20, 95);
  text('Delete = clear assigned sounds', 20, 110);

  if (lastNote !== null) {
    fill('#ffcc66'); textSize(14);
    text('last note: ' + lastNote + ' (' + noteName(lastNote) + ')', 500, 55);
  }

  // one-octave keyboard, highlighting active notes
  const keys = Object.entries(KEYMAP); // [letter, note]
  for (let i = 0; i < keys.length; i++) {
    const [letter, note] = keys[i];
    const x = KEY_X + i * (KEY_W + KEY_GAP);
    const isDropTarget = dropHoverNote === note;
    fill(activeNotes.has(note) || isDropTarget ? '#ffcc66' : '#2e2e4e');
    stroke(isDropTarget ? '#ffcc66' : '#555577');
    strokeWeight(isDropTarget ? 3 : 1);
    rect(x, KEY_Y, KEY_W, KEY_H, 6);
    noStroke();
    fill(activeNotes.has(note) || isDropTarget ? '#1a1a2e' : '#aaaacc');
    textSize(22); textAlign(CENTER);
    text(letter.toUpperCase(), x + KEY_W / 2, KEY_Y + 48);
    textSize(11);
    text(noteName(note), x + KEY_W / 2, KEY_Y + 76);
    const assigned = noteSounds.get(note);
    textSize(9);
    const label = assigned ? shortenName(assigned.name) : 'default tone';
    text(label, x + KEY_W / 2, KEY_Y + KEY_H - 14);
    textAlign(LEFT);
  }
  strokeWeight(1);
}

function shortenName(name) {
  const withoutExtension = name.replace(/\.[^.]+$/, '');
  return withoutExtension.length > 12
    ? withoutExtension.slice(0, 11) + '…'
    : withoutExtension;
}
