# @strudel/web API — playback and default sounds

This is the surface used by the 4-channel p5 player. It is taken from
`@strudel/web@1.3.0` and from how [strudel.cc](https://strudel.cc/) itself
prebakes sounds (`TestCodes/strudel/website/src/repl/prebake.mjs`).

After `initStrudel()` finishes, these functions live on `window`.

---

## 1. What loads automatically

`initStrudel()` always runs an internal `defaultPrebake()` first:

| Loaded | Names you can use in `s(...)` |
| --- | --- |
| `registerSynthSounds()` | `sine` `sin`, `sawtooth` `saw`, `square` `sqr`, `triangle` `tri`, `user`, `one`, `sbd`, plus noise types |
| pattern functions | `note`, `s`, `n`, `stack`, `hush`, `evaluate`, … |

**No sample banks are loaded.** `s("bd sd")` is silent until you register drums.

strudel.cc then loads a second, larger prebake (synths + ZZFX + BunnyCDN maps +
a Dirt-Samples *subset* + GM soundfonts). `@strudel/web` does **not** include
soundfonts. Everything else can be loaded with `samples()` — that is what
`strudel-sounds.js` does.

---

## 2. `initStrudel(options?)` → `Promise<repl>`

```js
initStrudel({
  prebake: () => loadStrudelCcSounds(), // runs after default synths
  onEvalError: (err) => console.error(err),
  miniAllStrings: true, // default; treat JS strings as mini-notation
});
```

| Option | Role |
| --- | --- |
| `prebake` | `() => Promise`. Extra sounds / modules. Awaited before the promise resolves. |
| `onEvalError` | Called when `evaluate()` fails. |
| `miniAllStrings` | `false` to keep normal JS strings (REPL-like quote split). |

Audio does not start until a user gesture (`click` / MIDI after a click). That
is the browser autoplay policy, not Strudel.

---

## 3. Playback

| Function | What it does |
| --- | --- |
| `evaluate(code, autoplay = true)` | Transpile + run a Strudel string. Replaces the current scheduler pattern. Returns the `Pattern`, or `undefined` on error. |
| `hush()` / `repl.stop()` | **Use `repl.stop()`.** After the first `evaluate()`, global `hush()` is replaced by a helper that returns `silence` and does **not** cut audio. |
| `pattern.play()` | Play a JS-built pattern on the same scheduler (also replaces). |
| `setcps(n)` / `setcpm(n)` | Tempo. `setcps(1)` = 1 cycle/sec. `setcpm(140/4)` = 140 bpm in 4/4. |

`evaluate()` always `hush()`es first. To keep several parts going, evaluate
them **together** as labeled patterns.

In the console, `hush()` returning `{_Pattern: true, query: ()=>[]}` means you
hit that overwritten helper (it is `silence`). After this player loads, `hush()`
is rebound to the real scheduler stop. `stop()` on the window is not Strudel's
stop — use `hush()` after reload, or Esc / **stop all**.

```js
await evaluate(`
ch1: s("bd sd")
ch2: s("hh*8").gain(0.4)
`);
```

`$:` / `name:` becomes `.p('name')` in the transpiler. That is how the 4ch
sketch stacks channels.

Quotes: in `@strudel/web` both `'` and `"` work for mini-notation. In the
strudel.cc REPL, `"` is mini-notation and `'` is a JS string. `evaluate()`
matches the REPL.

---

## 4. `samples(map | url, baseUrl?, options?)`

Registers **names → URLs**. Audio files load lazily on first hit — the first
trigger of a new sound can be silent.

```js
// A. JSON map on the CDN (what strudel.cc uses)
samples('https://strudel.b-cdn.net/piano.json', 'https://strudel.b-cdn.net/piano/', { prebake: true });

// B. GitHub shortcut → raw.githubusercontent.com/<user>/<repo>/<branch>/strudel.json
samples('github:tidalcycles/dirt-samples');
samples('github:user/repo/branch');

// C. Inline map + base URL
samples({
  bd: 'bd/BT0AADA.wav',
  sd: ['sd/rytm-01-classic.wav', 'sd/rytm-00-hard.wav'],
}, 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/');

// D. Other prefixes
samples('bubo:kit');          // → github:Bubobubobubobubo/dough-kit
samples('shabda:bass:4,hihat:2');
samples('local:');            // http://localhost:5432  (@strudel/sampler)
```

| Argument | Role |
| --- | --- |
| `map` / `url` | Object, JSON URL, or `github:` / `bubo:` / `shabda:` / `local:` string. |
| `baseUrl` | Prepended to relative paths. JSON `_base` is used if you omit this. |
| `options.prebake` | Mark as built-in (sounds tab grouping). |
| `options.tag` | Extra group, e.g. `'drum-machines'`. |

Pick a sample inside a bank with `n` or `:`:

```
s("hh*8").bank("RolandTR909").n("0 1 2 3")
s("bd:1 sd:2")
```

`bank("RolandTR808")` prefixes the sound: `bd` → `RolandTR808_bd`.

---

## 5. What strudel.cc actually prebakes

From `website/src/repl/prebake.mjs`. CDN root: `https://strudel.b-cdn.net`.

| Call | Typical names |
| --- | --- |
| `registerSynthSounds()` | waveforms, `sbd`, noise — already in `@strudel/web` |
| `registerZZFXSounds()` | `zzfx`, `z_sine`, `z_sawtooth`, `z_triangle`, `z_square`, `z_tan`, `z_noise` |
| `registerSoundfonts()` | GM instruments — **not in `@strudel/web`** |
| `piano.json` + `/piano/` | `piano` · `s("piano").note("c3 e3 g3")` |
| `vcsl.json` + `/VCSL/` | VCSL instruments (large set) |
| `tidal-drum-machines.json` + `/tidal-drum-machines/machines/` | `RolandTR808_bd`, `RolandTR909_sd`, … |
| `uzu-drumkit.json` + `/uzu-drumkit/` | default `bd` `sd` `hh` `oh` `cp` `cr` `rd` `ht` `mt` `lt` `rim` `sh` `cb` `tb` `perc` `misc` `fx` |
| `uzu-wavetables.json` + `/uzu-wavetables/` | `wt_…` wavetables |
| `mridangam.json` + `/mrid/` | mridangam hits |
| Dirt-Samples **subset** + `/Dirt-Samples/` | `casio` `crow` `insect` `wind` `jazz` `metal` `east` `space` `numbers` `num` |
| `aliasBank(…/tidal-drum-machines-alias.json)` | short bank names (`tr808` → `RolandTR808`, …) |

strudel.cc does **not** load the full SuperDirt / `github:tidalcycles/dirt-samples`
tree. Classic `s("bd sd, hh*8")` comes from **uzu-drumkit**, not from Dirt-Samples.

Older / embed prebake (`packages/repl/prebake.mjs`) used GitHub JSON instead of
the CDN:

```
https://raw.githubusercontent.com/felixroos/dough-samples/main/{piano,vcsl,tidal-drum-machines,Dirt-Samples,mridangam}.json
https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/strudel.json
```

The CDN copy is what the live site uses.

---

## 6. Load the same set from `@strudel/web`

```js
initStrudel({
  prebake: () => loadStrudelCcSounds(), // see strudel-sounds.js
});
```

That function calls `registerZZFXSounds()` and `samples()` / `aliasBank()`
against `https://strudel.b-cdn.net`. After it resolves:

```js
s("bd sd, hh*8")                          // uzu-drumkit
s("bd sd").bank("RolandTR909")            // tidal-drum-machines
s("casio east metal")                     // Dirt-Samples subset
note("c3 e3 g3").s("piano")
note("<c2 eb2 g2>").s("sawtooth").lpf(800)
```

Optional extras you can add in `prebake` or later:

```js
samples('github:tidalcycles/dirt-samples'); // full SuperDirt set (bd folder, amencutup, …)
samples('github:eddyflux/crate');
```

---

## 7. Aliases

```js
aliasBank('https://strudel.b-cdn.net/tidal-drum-machines-alias.json');
aliasBank({ RolandTR808: ['tr808', '808'] });
aliasBank('RolandTR808', 'tr808');

soundAlias('RolandTR808_bd', 'kick');
s("kick")
```

`aliasBank` remaps the prefix before `_`. `soundAlias` remaps one sound name.

---

## 8. Not in the `@strudel/web` bundle

| Missing | Why | Workaround |
| --- | --- | --- |
| `registerSoundfonts()` | `@strudel/soundfonts` is commented out of `web.mjs` | skip GM fonts, or add a bundler + `@strudel/soundfonts` |
| IndexedDB user uploads | REPL-only (`registerSamplesFromDB`) | `samples({ name: fileUrl })` |
| Hydra / MIDI-out / Csound | other packages | not needed for this player |

---

## 9. Drum abbreviations (uzu-drumkit)

| Sound | Name |
| --- | --- |
| kick | `bd` |
| snare | `sd` |
| rim | `rim` |
| clap | `cp` |
| closed hat | `hh` |
| open hat | `oh` |
| crash / ride | `cr` `rd` |
| toms | `ht` `mt` `lt` |
| shaker / cowbell / tamb | `sh` `cb` `tb` |
| other | `perc` `misc` `fx` |

```
s("bd sd [~ bd] sd, hh*16").bank("<RolandTR808 RolandTR909>")
```
