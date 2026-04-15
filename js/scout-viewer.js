/**
 * scout-viewer.js — ISDF Scout unit viewer
 *
 * Thin config wrapper around the shared unit-viewer module.
 * To add a new unit, copy this file, update the paths, and
 * point the new unit's HTML page at the new script.
 */

import { initViewer } from './unit-viewer.js';

const BASE = 'models/isdf/Scout/';

initViewer({
  model: BASE + 'ivscout00.fbx',
  textures: {
    diffuse:   BASE + 'ivscou00.png',
    colorMask: BASE + 'ivscou00_c.png',
    normal:    BASE + 'ivscou00_n.png',
    specular:  BASE + 'ivscou00_s.png',
    emissive:  BASE + 'ivscou00_e.png',
  },
});
