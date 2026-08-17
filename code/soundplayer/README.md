# soundplayer — p5.js pitched sound player (MIDI + keyboard)

Plays notes from **MIDI input** (e.g. the micro:bit or ESP32 BLE MIDI
controllers from this tutorial) or from the **computer keyboard**
(keys `c d e f g a b` = the C4 major scale).

By default notes play a simple synthesized tone. **Drag and drop an audio
file** (wav/mp3/ogg/m4a) onto the canvas to play that sample instead — the
note pitches the sample by changing its playback rate, treating the file as
C4. Like a classic sampler, higher notes also play faster (chipmunk effect).
Press `Delete` to return to the default tone.

## Run

Web MIDI and drag-and-drop audio need a real web server (not `file://`):

```
cd code/p5js/soundplayer
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome or Edge** (Safari has no Web MIDI)
and allow MIDI access when prompted. Click the page once before playing —
browsers block audio until a first user gesture.

## Using the BLE MIDI controllers

1. Connect the device first: Audio MIDI Setup → Show MIDI Studio →
   Bluetooth → Connect ("SoundSpace Touch", "SoundSpace Buttons", or the
   micro:bit).
2. The page lists connected MIDI inputs at the top; it rescans
   automatically when devices appear.
3. Every incoming Note On plays at its own MIDI pitch (not limited to the
   one on-screen octave).
