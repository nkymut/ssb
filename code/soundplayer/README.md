# soundplayer — a seven-note sampler for keys and MIDI

Seven notes, `c d e f g a b` (the C4 major scale, MIDI 60–71). Each note
plays either a simple synthesized tone or **your own audio file**, with one of
three behaviours — **gate / one-shot / loop** — chosen per note. This is the
sound engine every later sketch reuses (`regiontrigger` swaps the keys for
camera zones), and its saved JSON is the portable "instrument".

## Run

Web MIDI needs a real web server (not `file://`):

```
cd code/soundplayer
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome or Edge** (Safari has no Web MIDI)
and allow MIDI access when prompted. Click the page once before
playing — browsers block audio until a first user gesture.

## Play

| Input | How |
|---|---|
| computer keyboard | `c d e f g a b` — hold for gate notes |
| on-screen keys | click / touch a key on the canvas |
| MIDI | any Note On / Note Off; every pitch plays, not just the seven on screen |
| text field | the console: shows what you typed |

## Sounds

- **load** under a key, or **drag an audio file onto the key** on the canvas
  (wav / mp3 / ogg / m4a / aiff / flac). The key shows the file name.
- No file assigned → a triangle-wave tone at that pitch.
- `Delete` / `Backspace` or **clear** removes every assigned sound.

## Three behaviours per note

| Button | On key down | On key up | Feels like |
|---|---|---|---|
| **gate** | starts | stops | a voice — sound lasts as long as you hold |
| **one-shot** | plays through once (retriggers if pressed again) | nothing | a hit |
| **loop** | starts looping; the next press stops it | nothing | a switch, a bed |

Notes stack (layered). To hear the difference, play the same fast pattern
with one key set to gate and the next to one-shot.

## Save / load

**save** writes `soundspace-sampler.json` — modes and the sounds themselves
(as data URLs, so the file is self-contained). **load** restores it. The same
file loads in `regiontrigger`.

## BLE MIDI controllers

1. Connect the device first: Audio MIDI Setup → Show MIDI Studio →
   Bluetooth → Connect ("SoundSpace Touch", "SoundSpace Buttons", or the
   micro:bit running `mbit/buttonmidi_ble`).
2. The canvas lists connected MIDI inputs; it rescans automatically when
   devices appear.

## Extending with AI

Paste `sketch.js` and ask for one change at a time:

- "Add a volume slider per note."
- "Pitch the assigned sample with the MIDI note, treating the file as C4."
- "Add a pan button per note: left / centre / right."
- "Show a waveform of the assigned sound inside its key."
