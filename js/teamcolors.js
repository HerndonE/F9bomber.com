import { initViewer } from './unit-viewer.js';

const BASE = 'models/isdf/Scout/';

const SCOUT_CONFIG = {
  model: BASE + 'ivscout00.fbx',
  textures: {
    diffuse:   BASE + 'ivscou00.png',
    colorMask: BASE + 'ivscou00_c.png',
    normal:    BASE + 'ivscou00_n.png',
    specular:  BASE + 'ivscou00_s.png',
    emissive:  BASE + 'ivscou00_e.png',
  },
};

function updateOutput() {
  const [rA, gA, bA, aA] = viewerA.getTintRgba();
  const [rB, gB, bB, aB] = viewerB.getTintRgba();
  const out = document.getElementById('localprefs-output');
  if (out) {
    out.textContent =
      `TeamColorTeamA = "${rA} ${gA} ${bA} ${aA}"\n` +
      `TeamColorTeamB = "${rB} ${gB} ${bB} ${aB}"`;
  }
}

const viewerA = initViewer({
  ...SCOUT_CONFIG,
  containerId:  'viewer-a',
  defaultTint:  { hex: '#dc143c', alpha: 255 },
  onTintChange: updateOutput,
});

const viewerB = initViewer({
  ...SCOUT_CONFIG,
  containerId:  'viewer-b',
  defaultTint:  { hex: '#004080', alpha: 255 },
  onTintChange: updateOutput,
});

document.addEventListener('DOMContentLoaded', () => {
  updateOutput();

  document.getElementById('copy-btn')?.addEventListener('click', () => {
    const text = document.getElementById('localprefs-output')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copy-btn');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1800);
    });
  });
});
