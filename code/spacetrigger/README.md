# spacetrigger — zones on the camera feed that play sounds

`soundplayer` with the camera as the controller. Draw rectangles ("zones")
over the video; while a **hand**, a **person** or an **object** is inside a
zone, that zone's note plays. Everything about the sound is the same as
`soundplayer`: seven notes `c d e f g a b`, a sound file per note, and a
**gate / one-shot / loop** behaviour per note. A note with no sound file plays
a **General MIDI instrument**. A sampler file saved from `soundplayer` loads
here unchanged.

Any number of zones can share a note — two places on the floor that play the
same sound — and the note holds until the last of them is empty.

```
camera → ml5 detectors → one point per hand / person / object
       → is a point inside a zone? → noteOn / noteOff → sampler
```

Detection happens inside the page with [ml5.js](https://ml5js.org/) — the
same three models [CVTrack](../../CVTrack/) uses — so there is no broker and
nothing leaves the browser. It is the *one-page* version of the idea; when the
camera and the speakers need to be on different machines, use CVTrack + MQTT.

## Run

Camera access needs a real web server (not `file://`):

```
cd "2.Codes/p5js/spacetrigger"
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome or Edge**, allow the camera, and
**click once** on the page — browsers block audio until a first gesture. The
models download on first use (a few MB each, then cached).

To use a phone or another laptop as the camera, the page must be served over
**HTTPS** — browsers refuse the camera on a plain-HTTP address that is not
`localhost`. A tunnel (`npx localtunnel --port 8000`) or `npx serve --ssl-cert`
both work.

## Use

| Action | Result |
|---|---|
| drag on empty video | draw a new zone — it starts on the least-used note (C, D, E …) |
| click its ♪ (top-left) | change which note it plays — several zones may share one note |
| click its ◎ (bottom-left) | change what that zone listens for: any / hand / pose / object |
| drag inside a zone | move it |
| drag its bottom-right corner | resize it |
| click its × (top-right) | remove it |
| drop an audio file on a zone, or **load** under its note | assign a sound to that note |
| **zone: any / hand / pose / object** (note column) | set *all* zones on that note to one source |
| **gate / one-shot / loop** | what entering the zone does (see below) |
| **hand / pose / object** (top row) | which detectors run — fewer is faster |
| object classes | narrow objects to COCO labels, e.g. `cup, bottle, cell phone` |
| **camera menu** | pick any camera the machine has: built-in, USB, or a phone's front / back |
| **mirror** | flip the video (a webcam facing you feels natural mirrored) |
| **midi** (top right of the video) | cycle MIDI outputs: off → each port → off. Notes are also sent there |
| keys `c d e f g a b`, or the pads | play the notes without the camera, to test sounds |
| **save / load** | zones + modes + sounds as one JSON file |

Zones (including several on one note), modes, the detector choice and the
MIDI output are also kept in
`localStorage`, so a reload keeps your layout. Sounds are not — save a JSON if
you want them back.

### The three behaviours

Same as `soundplayer`, but now the "press" is a body entering a zone:

| Mode | Entering the zone | Leaving it |
|---|---|---|
| **gate** | sound starts | sound stops — a voice |
| **one-shot** | sound plays through once | nothing — a hit |
| **loop** | loop starts (enter again to stop) | nothing — a switch |

A zone stays "occupied" for 250 ms after the last sighting (`LINGER_MS`), so
detector flicker does not machine-gun a one-shot or stutter a gate.

### What counts as "inside"

The same anchor point CVTrack publishes:

- **hand** — the centre of the 21 hand landmarks. Best for a laptop webcam:
  reach into a zone.
- **pose** — the centre of a person's confident keypoints (roughly the torso).
  Best for an overhead or room camera: zones become places on the floor.
- **object** — the centre of the detected box. Best for props: a cup that
  plays when it is put on the table.

`pose` on a frontal webcam triggers when *you* move, not when your hand does —
switch to `hand` for gesture-style zones.

### Sharing a note between zones

Two zones on `C` are one instrument with two playing positions: the sound
starts when a hand enters either of them and stops only when it has left both.
Useful for a doorway (two sides of a frame), for a big area split around an
obstacle, and for a duet where two people can play the same part.

The note column below the video then reads `2 zones` and its source button
sets both at once; use each zone's own ◎ handle if you want them to listen for
different things — one zone watching for `hand`, its twin for `object`.

## The default voice: General MIDI

A note with no sound file loaded plays a **General MIDI instrument** —
`acoustic_grand_piano` by default — streamed by
[soundfont-player](https://github.com/danigb/soundfont-player). The status
band shows `acoustic grand piano` once it is loaded.

- Change the instrument by editing `GM_INSTRUMENT` at the top of `sketch.js`
  to any [MusyngKite name](https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json),
  e.g. `marimba`, `pad_2_warm`, `taiko_drum`, `synth_drum`.
- It needs the network on first use (the samples come from a CDN). Offline,
  the sketch falls back to the old oscillator beep and says `GM offline — beep`.
- In **one-shot** mode a GM note is left to ring for `GM_RING_MS` (2.5 s); in
  **gate** it is held until the zone empties, and **loop** latches it on until
  you enter again. A GM note still decays like the instrument it is — for a
  sound that really loops, load a file for that note.
- Loading a sound file for a note replaces the GM voice for that note only, so
  a piano zone and a field-recording zone can sit side by side.

## MIDI out

The **midi** button sends every note this page plays — zones, keys, pads — to
a MIDI output as well, as plain noteOn / noteOff on **channel 1**. The built-in
sounds keep playing; load silence (or no sound and turn the volume down) if you
only want the external synth.

- Needs **Chrome or Edge** (Web MIDI); the browser asks for permission once.
- On macOS with no hardware attached: open **Audio MIDI Setup → MIDI Studio**,
  double-click **IAC Driver**, tick *Device is online*. The "IAC Driver Bus 1"
  port then shows up here and in GarageBand / Ableton / Max as an input.
- Whatever the zone's gate / one-shot / loop mode, MIDI always mirrors the
  raw enter/leave: noteOn when a body enters, noteOff when it leaves. The
  receiving instrument decides what a "note" means.
- The camera side and the sound side can now be different programs on the same
  machine — the network version of this split is CVTrack + MQTT.

## What to try

- One gate zone with a long sustained sound, one one-shot with a short hit.
  Which one wants a big zone? Which one wants a small one?
- Two zones side by side, both `loop`. Walk between them — a step sequencer
  made of floor.
- Set a zone to `object`, type `cup` in the classes, and put a cup in and out
  of frame. Then ask: is the cup the instrument, or the hand holding it?
- Point the camera at the ceiling / from a shelf, switch to `pose`, and make
  zones the size of a person. Now the room is the interface.
- Turn on **midi**, route it to a synth with a long evolving pad, and set the
  zone to `gate`. The zone becomes a bow, not a button.
- Put two zones on the same note at opposite ends of the frame and set it to
  `gate`: the sound stays on while *anyone* is at either end. Now it is a
  presence detector, not a key.
- Set `GM_INSTRUMENT` to `taiko_drum` and use one-shot zones — a room-sized
  drum kit before you record a single sample.

## Extending with AI

The top of `sketch.js` is a **prompt**: a plain-language description of this
whole app, followed by an empty **ADD-ONS** list. Two ways to use it:

- **Change this app** — write your request in the ADD-ONS list, then give the
  agent the file: "here is sketch.js, do the ADD-ONS at the top".
- **Start a new app** — copy only the prompt block into a fresh chat and edit
  it. It is the whole recipe; the agent does not need the code.

Ask for one change at a time — five at once is how you get a page that no
longer runs. Keep a copy of the file that works before you start.

Requests that work well here:

- "Make the zone's volume follow how far the hand is from its centre."
- "Trigger the zone only when *two* hands are inside."
- "Add a `velocity` that follows how fast the point entered the zone."
- "Send the point's height in the zone as a MIDI CC, for filter sweeps."
- "Give each zone its own GM instrument instead of one for the whole page."
- "Publish each zone's occupied / free state over MQTT instead of playing it
  here" — that is the bridge back to CVTrack's examples.

## Notes & limits

- ml5 models share one GPU; all three at once lowers the frame rate. Start
  with `hand` alone.
- MediaPipe tracks up to 4 hands, MoveNet up to 6 people.
- Mirror flips the coordinates the zones live in — draw zones *after* choosing
  mirror, or they will sit on the other side. Choosing a camera sets mirror
  for you — off when its name looks like a rear camera, on otherwise — so
  pick the camera before drawing zones.
- The **camera menu** lists every video input the browser will admit to —
  built-in, USB, capture card, and both of a phone's cameras. Names only
  appear once you have allowed the camera, so the list fills in properly a
  second after the video starts, and updates when you plug something in.
  Picking one restarts the detectors on it; if that camera has gone (unplugged
  since last visit) the page falls back to the default one and says so. Zones are stored as fractions of the frame, so they survive
  the switch even if the two cameras have different resolutions.
- Pinned to **p5.js 1.9.4 + p5.sound** like every sketch in this folder. ml5
  v1 also runs under p5 2.x (its constructors return a promise there — the
  loader handles both), but p5 2.x drops the bundled `p5.sound`.
