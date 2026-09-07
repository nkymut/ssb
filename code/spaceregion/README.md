# spaceregion — places in front of the camera as continuous knobs

`spacetrigger` asks *is someone in the box?* — on or off, like a key.
`spaceregion` asks *where in the box?* — two numbers that never stop moving.
Draw a rectangle on the camera feed and it gives you **X** (left → right) and
**Y** (bottom → top) as values from 0 to 1, sent two ways at once:

- into a **Strudel sequence** you can edit on the page, so a hand sweeps a
  filter or opens a reverb while the pattern keeps playing;
- out as **MIDI control change** messages, so the same movement drives a synth
  or a DAW.

```
camera → ml5 detectors → one point per hand / person / object
       → where is it inside the region? → x, y → strudel signals + MIDI CC
```

The sound is made by [Strudel](https://strudel.cc/) — the same engine as the
`strudel` sketch in this folder — so everything you already know about
patterns still applies. The camera only turns knobs.

## Run

Camera access needs a real web server (not `file://`):

```
cd "2.Codes/p5js/spaceregion"
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome or Edge**, allow the camera, and press
**play**. The models and the Strudel sounds download on first use (a few MB,
then cached).

To use a phone or another laptop as the camera, serve the page over **HTTPS** —
browsers refuse the camera on a plain-HTTP address that is not `localhost`.

## Use

| Action | Result |
|---|---|
| drag on empty video | draw a new region — `r1`, `r2`, … up to `r6` |
| drag inside a region | move it |
| drag its bottom-right corner | resize it |
| click its **f / s / l** (top-left) | change the preset: filter → space → level |
| click its **◎** (bottom-left) | change what it follows: any / hand / pose / object |
| click its × (top-right) | remove it |
| **hold / rest** (on the card) | what happens when nobody is inside — see below |
| **play** / **stop**, `Ctrl/Cmd + Enter` | run or stop the sequence |
| **hands** | on: an open hand starts the music, closing both stops it |
| **hand / pose / object** (top row) | which detectors run — fewer is faster |
| object classes | narrow objects to COCO labels, e.g. `cup, bottle, cell phone` |
| **camera menu** | pick any camera the machine has: built-in, USB, or a phone's front / back |
| **mirror** | flip the video (a webcam facing you feels natural mirrored) |
| **midi** (top right of the video), **ch 1** | choose the MIDI output and its channel |
| **save / load** | regions + sequence as one JSON file |

Regions, the sequence, the detector choice and the MIDI port are also kept in
`localStorage`, so a reload keeps your setup.

### The two numbers

Inside a region, the tracked point becomes:

| | 0 | 1 |
|---|---|---|
| **x** | left edge | right edge |
| **y** | **bottom** edge | **top** edge |

Y is upside-down on purpose: raising a hand should raise the value, the way a
fader works. Both are smoothed (`SMOOTH`), because a detection that jitters by
a few pixels would otherwise sound like a zipper on the filter.

When the point leaves, the card's toggle decides what happens:

- **hold** — the last value stays. The room keeps the setting you left behind.
- **rest** — the value glides back to the preset's resting place (filter opens,
  reverb closes). The room resets itself when you walk away.

### Open hand, closed hand

With **hands** on, your hands are the transport:

| | |
|---|---|
| **first open hand** | starts the sequence — you never touch play |
| **both hands closed** | fades out over ~200 ms, then stops it |
| **while closed** | every region freezes: values hold, no MIDI CC goes out |
| **open again** | starts it from the top |

An open hand is drawn as a ring, a fist as a solid dot, and the bar under the
status text shows how open the sound is. Because it acts on the *moment* your
hands open or close rather than on every frame, pressing **play** by hand
still works — the hands take over again the next time you close and open them.

**One click first.** Browsers keep a page silent until it has been touched
once, and a hand in front of a camera is not a touch. Click anywhere on the
page after it loads; the status band says so until you have.

Open or closed is measured, for each of the four fingers, by whether the
fingertip is further from the wrist than that finger's middle joint. Three
straight fingers of four counts as open — so a relaxed hand still plays, and
only a real fist stops it. Thumbs are ignored: they are the least reliable to
see.

Nothing happens for 400 ms after the last open hand, so a dropped frame does
not chop the music. If the hand model is off, or **hands** is off, the sound
plays as normal and the regions never freeze — turning off a detector never
silences the page.

Freezing takes priority over a region's **hold / rest** setting: `rest` only
pulls a value back when you leave a region *while your hands are still open*.

Under the hood the page appends one line to your sequence:

```js
all((x) => x.postgain(handsOpen))
```

`handsOpen` is another signal, like `r1x` — 0 when every hand is closed, 1
when one is open. You can use it yourself instead: `.lpf(handsOpen.range(200,
4000))` opens the filter rather than the volume, or `.mask(handsOpen)` cuts
events entirely. Turn **hands** off if you want the gate only where you put
it. (If a Strudel build cannot take the appended line, the page runs your
sequence without it and says so in the status band.)

### Presets

Each preset names the two axes and picks their MIDI CC numbers:

| Preset | X | Y |
|---|---|---|
| **filter** | cutoff — CC 74 | resonance — CC 71 |
| **space** | reverb — CC 91 | delay — CC 93 |
| **level** | pan — CC 10 | volume — CC 7 |

On the first visit you get two regions: `r1` on the left set to **filter**,
`r2` on the right set to **space** — exactly what the starting sequence uses.
Edit the `PRESETS` list at the top of `sketch.js` to add your own.

## The sequence

The textarea is a normal Strudel patch. The only addition is a set of names
that always exist and always hold the current camera values:

```
r1x  r1y   r2x  r2y   r3x  r3y   r4x  r4y   r5x  r5y   r6x  r6y
```

Each one is a Strudel **signal** running from 0 to 1, so it behaves like
`sine` or `perlin` — use `.range(low, high)` to put it where you need it:

```js
setcpm(160/4)

p1: n("0 2 4 6 7 6 4 2")
  .scale("<c3:major>/2")
  .s("supersaw")
  .distort(0.7)
  .superimpose((x) => x.detune("<0.5>"))
  .lpenv(perlin.slow(3).range(1, 4))
  .lpf(r1x.range(100, 3000))     // hand moves right → brighter
  .lpq(r1y.range(1, 20))         // hand moves up    → more resonant
  .room(r2x.range(0, 0.8))       // second region: reverb
  .delay(r2y.range(0, 0.7))      // and delay
  .gain(0.3)

p2: "<a1 e2>/8"
  .clip(0.6).struct("x*8").s("supersaw").note()
  .lpf(r1x.range(200, 2000))
  .room(r2x.range(0, 0.5))
  .gain(0.35)
```

Two things worth knowing:

- **You only press play when the text changes.** The camera does not
  re-run the code — the signals are read every time Strudel asks the pattern
  what to play, which is why the sound bends smoothly instead of restarting.
- A region you have not drawn still has a name; `r4x` simply stays at 0 until
  an `r4` exists. Nothing breaks.
- A hidden first line defines those names, so an error about "line 7" means
  line 6 of what you typed.

`p1:` and `p2:` are Strudel's way of playing two parts at once — rename them,
add `p3:`, or delete one. Sounds come from the same set as
[strudel.cc](https://strudel.cc/): `s("bd sd, hh*8")`, `note("c3").s("piano")`,
and the synths. If `supersaw` is silent in your browser, try `sawtooth`.
See [`../strudel/API.md`](../strudel/API.md) for the full surface.

## MIDI out

The **midi** button sends both axes of every region as control changes on the
channel shown next to it — at most every 25 ms, and only when the 0–127 value
actually changes, so the port does not drown.

- Needs **Chrome or Edge** (Web MIDI); the browser asks for permission once.
- On macOS with no hardware attached: open **Audio MIDI Setup → MIDI Studio**,
  double-click **IAC Driver**, tick *Device is online*. "IAC Driver Bus 1" then
  appears here and as an input in Ableton / Logic / Max.
- In most DAWs you can also just hit *MIDI learn* on a knob and wave at the
  camera — the CC numbers above are only a sensible default.
- Strudel and MIDI run at the same time: the page can be the instrument, the
  controller, or both.

## What to try

- Put tape on the floor to mark the region, exactly as in `spacetrigger`. The
  difference the students feel: it is no longer a button, it is a slope.
- One **filter** region, `hold` on. Walk in, set a sound, walk away. The room
  keeps your setting — the space has a memory.
- The same region on `rest`. Now the instrument only sounds interesting while
  someone is present; the piece needs a body to stay alive.
- Two regions on opposite walls with **space** and **level**: one person plays
  the atmosphere, another plays the balance. Nobody plays a note.
- Make a region very tall and very narrow — a doorway. Passing through it is a
  fast sweep, standing in it is a held value.
- Play with **hands** on and both regions on `hold`: open a hand to start,
  move to set the filter, close your hand to stop. That is a whole instrument
  — attack, timbre and release — with no buttons at all. Because the values
  freeze when you close, the sound comes back exactly where you left it.
- Two people, one open hand each: the music plays while *either* of them is
  open. Making it need *both* is one line — a good first ADD-ON.

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

- "Add a third value per region: how big the hand is, so near/far is a knob."
- "Let a region send a note on entry as well as its two CCs."
- "Add a freeze button that holds every region while I set up."
- "Show the last ten seconds of each value as a small graph on the card."
- "Publish the region values over MQTT so another laptop can play them" —
  that is the bridge to `CVTrack` and the networked stage.

## Notes & limits

- ml5 models share one GPU; all three at once lowers the frame rate. Start
  with `hand` alone.
- One point per region: if two hands are inside, the first one found wins.
  Ask the agent for an average if you want both to count.
- Open / closed is read from one frame at a time. A hand seen edge-on, or
  half out of frame, can read as closed — `OPEN_FINGERS` and `REACH` at the
  top of `sketch.js` are the two numbers to loosen.
- Mirror flips the coordinates the regions live in — draw regions *after*
  choosing mirror, or they will sit on the other side. Choosing a camera sets
  mirror for you — off when its name looks like a rear camera, on otherwise —
  so pick the camera before drawing regions.
- The **camera menu** lists every video input the browser will admit to —
  built-in, USB, capture card, and both of a phone's cameras. Names only
  appear once you have allowed the camera, so the list fills in properly a
  second after the video starts, and updates when you plug something in.
  Picking one restarts the detectors on it; if that camera has gone
  (unplugged since last visit) the page falls back to the default one and
  says so. The hand transport pauses while the swap happens, so the music does
  not stop just because no hand is visible for a moment.
- Pinned to **p5.js 1.9.4**, **ml5 v1** and **@strudel/web 1.3.0**. p5.sound is
  not loaded here at all: Strudel owns the audio.
- **p5 and Strudel share two words.** `initStrudel()` copies Strudel's whole
  vocabulary onto the page, and `color()` and `scale()` already belonged to
  p5 — after Strudel loads, those names are Strudel's. This sketch works
  around both (it reads hex colours itself and keeps p5's `scale` in
  `p5Scale` before Strudel starts). If you add another p5 drawing call to
  `draw()` and it starts throwing `… is not a function`, this is why.
- `strudel-sounds.js` is a copy — the original lives in
  [`../strudel/`](../strudel/), and both should be updated together.
