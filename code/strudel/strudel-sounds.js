// Sound sets that strudel.cc registers on startup.
// Source: TestCodes/strudel/website/src/repl/prebake.mjs
//
// @strudel/web already calls registerSynthSounds() inside initStrudel().
// This file adds the rest: ZZFX synths + the BunnyCDN sample maps.
// GM soundfonts are not in the @strudel/web bundle.

const STRUDEL_CDN = 'https://strudel.b-cdn.net';

const DIRT_SUBSET = {
  casio: ['casio/high.wav', 'casio/low.wav', 'casio/noise.wav'],
  crow: ['crow/000_crow.wav', 'crow/001_crow2.wav', 'crow/002_crow3.wav', 'crow/003_crow4.wav'],
  insect: [
    'insect/000_everglades_conehead.wav',
    'insect/001_robust_shieldback.wav',
    'insect/002_seashore_meadow_katydid.wav',
  ],
  wind: [
    'wind/000_wind1.wav', 'wind/001_wind10.wav', 'wind/002_wind2.wav',
    'wind/003_wind3.wav', 'wind/004_wind4.wav', 'wind/005_wind5.wav',
    'wind/006_wind6.wav', 'wind/007_wind7.wav', 'wind/008_wind8.wav',
    'wind/009_wind9.wav',
  ],
  jazz: [
    'jazz/000_BD.wav', 'jazz/001_CB.wav', 'jazz/002_FX.wav', 'jazz/003_HH.wav',
    'jazz/004_OH.wav', 'jazz/005_P1.wav', 'jazz/006_P2.wav', 'jazz/007_SN.wav',
  ],
  metal: [
    'metal/000_0.wav', 'metal/001_1.wav', 'metal/002_2.wav', 'metal/003_3.wav',
    'metal/004_4.wav', 'metal/005_5.wav', 'metal/006_6.wav', 'metal/007_7.wav',
    'metal/008_8.wav', 'metal/009_9.wav',
  ],
  east: [
    'east/000_nipon_wood_block.wav', 'east/001_ohkawa_mute.wav',
    'east/002_ohkawa_open.wav', 'east/003_shime_hi.wav',
    'east/004_shime_hi_2.wav', 'east/005_shime_mute.wav',
    'east/006_taiko_1.wav', 'east/007_taiko_2.wav', 'east/008_taiko_3.wav',
  ],
  space: [
    'space/000_0.wav', 'space/001_1.wav', 'space/002_11.wav', 'space/003_12.wav',
    'space/004_13.wav', 'space/005_14.wav', 'space/006_15.wav', 'space/007_16.wav',
    'space/008_17.wav', 'space/009_18.wav', 'space/010_2.wav', 'space/011_3.wav',
    'space/012_4.wav', 'space/013_5.wav', 'space/014_6.wav', 'space/015_7.wav',
    'space/016_8.wav', 'space/017_9.wav',
  ],
  numbers: [
    'numbers/0.wav', 'numbers/1.wav', 'numbers/2.wav', 'numbers/3.wav',
    'numbers/4.wav', 'numbers/5.wav', 'numbers/6.wav', 'numbers/7.wav',
    'numbers/8.wav',
  ],
  num: [
    'num/00.wav', 'num/01.wav', 'num/02.wav', 'num/03.wav', 'num/04.wav',
    'num/05.wav', 'num/06.wav', 'num/07.wav', 'num/08.wav', 'num/09.wav',
    'num/10.wav', 'num/11.wav', 'num/12.wav', 'num/13.wav', 'num/14.wav',
    'num/15.wav', 'num/16.wav', 'num/17.wav', 'num/18.wav', 'num/19.wav',
    'num/20.wav',
  ],
};

function loadStrudelCcSounds() {
  registerZZFXSounds();
  return Promise.all([
    samples(`${STRUDEL_CDN}/piano.json`, `${STRUDEL_CDN}/piano/`, { prebake: true }),
    samples(`${STRUDEL_CDN}/vcsl.json`, `${STRUDEL_CDN}/VCSL/`, { prebake: true }),
    samples(`${STRUDEL_CDN}/tidal-drum-machines.json`, `${STRUDEL_CDN}/tidal-drum-machines/machines/`, {
      prebake: true,
      tag: 'drum-machines',
    }),
    samples(`${STRUDEL_CDN}/uzu-drumkit.json`, `${STRUDEL_CDN}/uzu-drumkit/`, {
      prebake: true,
      tag: 'drum-machines',
    }),
    samples(`${STRUDEL_CDN}/uzu-wavetables.json`, `${STRUDEL_CDN}/uzu-wavetables/`, { prebake: true }),
    samples(`${STRUDEL_CDN}/mridangam.json`, `${STRUDEL_CDN}/mrid/`, {
      prebake: true,
      tag: 'drum-machines',
    }),
    samples(DIRT_SUBSET, `${STRUDEL_CDN}/Dirt-Samples/`, { prebake: true }),
  ]).then(() => aliasBank(`${STRUDEL_CDN}/tidal-drum-machines-alias.json`));
}
