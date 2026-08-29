# 4ch Strudel — p5.js text player (buttons + MIDI)

Four independent [Strudel](https://strudel.cc/) text channels, played through
[`@strudel/web`](https://www.npmjs.com/package/@strudel/web). Each channel is
toggled from its **play** button, computer keys `1 2 3 4`, or MIDI notes
**C4 D4 E4 F4**.

`@strudel/web` has a single scheduler, so this sketch stacks the channels that
are currently on and re-evaluates them together as labeled patterns
(`ch1: …`, `ch2: …`). Stopping a channel removes it from the stack; the others
keep going.

Also online, no server needed: https://editor.p5js.org/didny/full/UjwBBSL8_

## Run

Web MIDI and Strudel audio need a real web server (not `file://`):

```
cd code/strudel
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome or Edge** (Safari has no Web MIDI)
and allow MIDI access when prompted. Click a play button once before expecting
sound — browsers block audio until a first user gesture.

On startup the sketch loads the same sample banks [strudel.cc](https://strudel.cc/)
uses (`uzu-drumkit`, drum machines, piano, VCSL, a Dirt-Samples subset). See
[API.md](API.md). Built-in synths (`sawtooth`, `triangle`, …) work even if the
CDN maps are still downloading.

## Play

| Channel | Button | Key | MIDI |
| --- | --- | --- | --- |
| CH1 | play / stop | `1` | C4 (60) |
| CH2 | play / stop | `2` | D4 (62) |
| CH3 | play / stop | `3` | E4 (64) |
| CH4 | play / stop | `4` | F4 (65) |

- **loop** (default) — press play / key / MIDI to latch on, press again to stop.
- **hold** — the pattern loops only while you hold the key, MIDI note, or play
  button; release stops that channel.
- **layered** (default) — channels stack and play together.
- **solo** — starting a channel stops the others.
- **Ctrl/⌘+Enter** in a text box starts that channel, or hot-swaps the pattern
  if it is already playing.
- **Esc** or **stop all** hushes every channel.
- Channel text is remembered in `localStorage`.

`@strudel/web` API and how to load (or extend) those banks: [API.md](API.md).

Type normal Strudel / mini-notation, the same as on [strudel.cc](https://strudel.cc/):

```
s("bd sd")
note("<c a f e>(3,8)").s("sawtooth")
s("hh*8").gain(0.4)
```

## Using the BLE MIDI controllers

1. Connect the device first: Audio MIDI Setup → Show MIDI Studio →
   Bluetooth → Connect ("SoundSpace Touch", "SoundSpace Buttons", or the
   micro:bit).
2. The page lists connected MIDI inputs at the top; it rescans
   automatically when devices appear.
3. Note On on C4 / D4 / E4 / F4 triggers that channel. In **loop** mode, Note
   Off is ignored. In **hold** mode, Note Off stops the channel.
