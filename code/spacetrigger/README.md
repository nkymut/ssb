# regiontrigger — zones on the camera feed that play sounds

`soundplayer` with the camera as the controller. Draw rectangles ("zones")
over the video; while a **hand**, a **person** or an **object** is inside a
zone, that zone's note plays. Everything about the sound is the same as
`soundplayer`: seven notes `c d e f g a b`, a sound file per note, and a
**gate / one-shot / loop** behaviour per note. A sampler file saved from
`soundplayer` loads here unchanged.

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
cd "2.Codes/p5js/regiontrigger"
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
| drag on empty video | draw a new zone — it takes the next free note (C, D, E …) |
| drag inside a zone | move it |
| drag its bottom-right corner | resize it |
| click its × | remove it |
| drop an audio file on a zone, or **load** under its note | assign a sound to that note |
| **zone: any / hand / pose / object** | what that zone listens for |
| **gate / one-shot / loop** | what entering the zone does (see below) |
| **hand / pose / object** (top row) | which detectors run — fewer is faster |
| object classes | narrow objects to COCO labels, e.g. `cup, bottle, cell phone` |
| **mirror** | flip the video (a webcam facing you feels natural mirrored) |
| keys `c d e f g a b`, or the pads | play the notes without the camera, to test sounds |
| **save / load** | zones + modes + sounds as one JSON file |

Zones, modes and the detector choice are also kept in `localStorage`, so a
reload keeps your layout. Sounds are not — save a JSON if you want them back.

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

## What to try

- One gate zone with a long sustained sound, one one-shot with a short hit.
  Which one wants a big zone? Which one wants a small one?
- Two zones side by side, both `loop`. Walk between them — a step sequencer
  made of floor.
- Set a zone to `object`, type `cup` in the classes, and put a cup in and out
  of frame. Then ask: is the cup the instrument, or the hand holding it?
- Point the camera at the ceiling / from a shelf, switch to `pose`, and make
  zones the size of a person. Now the room is the interface.

## Extending with AI

Paste `sketch.js` and ask for one change at a time:

- "Make the zone's volume follow how far the hand is from its centre."
- "Trigger the zone only when *two* hands are inside."
- "Add a `velocity` that follows how fast the point entered the zone."
- "Publish each zone's occupied / free state over MQTT instead of playing it
  here" — that is the bridge back to CVTrack's examples.

## Notes & limits

- ml5 models share one GPU; all three at once lowers the frame rate. Start
  with `hand` alone.
- MediaPipe tracks up to 4 hands, MoveNet up to 6 people.
- Mirror flips the coordinates the zones live in — draw zones *after* choosing
  mirror, or they will sit on the other side.
- Pinned to **p5.js 1.9.4 + p5.sound** like every sketch in this folder. ml5
  v1 also runs under p5 2.x (its constructors return a promise there — the
  loader handles both), but p5 2.x drops the bundled `p5.sound`.
