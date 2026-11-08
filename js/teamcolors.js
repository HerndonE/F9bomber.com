import { initViewer } from './unit-viewer.js?v=20261108c';

/* ── Unit catalogue ─────────────────────────────────────────────
 * One entry per selectable unit. Each team's switcher is built from
 * this list, so adding a faction (e.g. Hadean) is a single new entry.
 *
 * Material settings for the Scion Scout mirror scionscout.blend
 * (fvscout00 material: Metallic 0.3, Roughness 0.5, _s → Specular,
 * _n → tangent normal map, textures set to REPEAT).
 */
const ISDF  = 'models/isdf/Scout/';
const SCION = 'models/scion/scout/';
const HADEAN = 'models/hadean/xypos/';
const LOGOS = 'img/Factions/';

/* Where a faction comes from. 'stock' ships with Combat Commander;
 * 'expanded' is a community expanded-universe faction from mods. */
const ORIGINS = {
  stock:    { label: 'Stock' },
  expanded: { label: 'Expanded universe' },
};

const MODS = {
  fer: { name: 'Forgotten Enemies: Remastered', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3493433992' },
  vsr: { name: 'VSR (Vet Strat Recycler Variant)', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1325933293' },
};
const EU_WIKI = 'https://battlezone.fandom.com/wiki/Expanded_universe';

const UNITS = {
  isdf: {
    faction: 'ISDF',
    origin:  'stock',
    name:    'ISDF Scout',
    logo:    LOGOS + 'ISDF-Logo.png',
    model:   ISDF + 'ivscout00.fbx',
    textures: {
      diffuse:   ISDF + 'ivscou00.png',
      colorMask: ISDF + 'ivscou00_c.png',
      normal:    ISDF + 'ivscou00_n.png',
      specular:  ISDF + 'ivscou00_s.png',
      emissive:  ISDF + 'ivscou00_e.png',
    },
  },
  scion: {
    faction: 'Scion',
    origin:  'stock',
    name:    'Scion Scout',
    logo:    LOGOS + 'Scion-Logo.png',
    model:   SCION + 'fvscout_skel.fbx',
    textures: {
      diffuse:   SCION + 'fvscout00_d.png',
      colorMask: SCION + 'fvscout00_c.png',
      normal:    SCION + 'fvscout00_n.png',
      specular:  SCION + 'fvscout00_s.png',
      emissive:  SCION + 'fvscout00_e.png',
    },
    // Half the hull's UVs sit in U 1–2 (second tile), so maps must repeat
    wrap:              'repeat',
    rotationX:         0,
    hideMeshes:        /^(hp_|flame)/,
    doubleSided:       ['wing_l__2', 'wing_r__2'],
    glassMeshes:       ['cockpit1'],
    metalness:         0.3,
    roughness:         0.5,
    useSpecular:       true,
    emissiveIntensity: 0.45,
  },
  hadean: {
    faction: 'Hadean',
    origin:  'expanded',
    // Shown under the team header when this unit is selected
    about:   'The Hadeans are a community-made faction known from the Forgotten Enemies campaign. '
           + 'They are not part of stock Combat Commander; play them with mods such as',
    mods:    [MODS.fer, MODS.vsr],
    name:    'Hadean Xypos',
    logo:    LOGOS + 'Hadean-Logo.png',
    model:   HADEAN + 'evscout00.fbx',
    textures: {
      diffuse:   HADEAN + 'evscout00.png',
      colorMask: HADEAN + 'evscout00_c.png',
      normal:    HADEAN + 'evscout00_n.png',
      specular:  HADEAN + 'evscout00_s.png',
      emissive:  HADEAN + 'evscout00_e.png',
      // evscout00_m.png is not referenced by the game's own
      // evscout00.material (diffuse/teamColor/emissive/normal/specular)
    },
    // Like the Scion: half the UVs sit in U 1–2 (right wing = left + 1)
    wrap:              'repeat',
    rotationX:         0,
    hideMeshes:        /^(hp_|flame)/,
    glassMeshes:       ['cockpit'],
    viewAzimuth:       -55,   // modelled nose-toward +Z, unlike the Scouts
    metalness:         0.3,
    roughness:         0.5,
    useSpecular:       true,
    emissiveIntensity: 0.6,
  },
};

/* ── Initial units from the URL ─────────────────────────────────
 * ?a=scion&b=isdf picks per team; legacy ?unit=scion sets both.
 */
const params  = new URLSearchParams(location.search);
const pick    = (key, fallback) => (UNITS[key] ? key : fallback);
const shared  = pick(params.get('unit'), 'isdf');
const TEAMS = [
  { id: 'viewer-a', param: 'a', unit: pick(params.get('a'), shared), tint: { hex: '#dc143c', alpha: 255 } },
  { id: 'viewer-b', param: 'b', unit: pick(params.get('b'), shared), tint: { hex: '#004080', alpha: 255 } },
];

function updateOutput() {
  const [rA, gA, bA, aA] = TEAMS[0].viewer.getTintRgba();
  const [rB, gB, bB, aB] = TEAMS[1].viewer.getTintRgba();
  const out = document.getElementById('localprefs-output');
  if (out) {
    out.textContent =
      `TeamColorTeamA = "${rA} ${gA} ${bA} ${aA}"\n` +
      `TeamColorTeamB = "${rB} ${gB} ${bB} ${aB}"`;
  }
}

TEAMS.forEach((team) => {
  team.viewer = initViewer({
    ...UNITS[team.unit],
    containerId:  team.id,
    defaultTint:  team.tint,
    onTintChange: updateOutput,
  });
});

/* ── Per-team unit switcher + faction badge ─────────────────── */
function renderTeamUnit(team) {
  const slot = document.getElementById(team.id);
  if (!slot) return;
  const unit = UNITS[team.unit];

  const logo = slot.querySelector('[data-ctrl="faction-logo"]');
  if (logo) { logo.src = unit.logo; logo.alt = `${unit.faction} logo`; }
  const name = slot.querySelector('[data-ctrl="unit-name"]');
  if (name) name.textContent = unit.name;

  const expanded = unit.origin === 'expanded';
  const tag = slot.querySelector('[data-ctrl="unit-origin"]');
  if (tag) {
    tag.textContent = ORIGINS[unit.origin]?.label ?? '';
    tag.classList.toggle('is-expanded', expanded);
  }

  const note = slot.querySelector('[data-ctrl="origin-note"]');
  if (note) {
    note.hidden = !expanded;
    note.replaceChildren();
    if (expanded) {
      const icon = document.createElement('i');
      icon.className = 'bi bi-puzzle-fill';
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('p');
      const title = document.createElement('strong');
      title.textContent = 'Expanded universe faction. ';
      text.append(title, unit.about + ' ');
      (unit.mods || []).forEach((mod, i, all) => {
        text.append(_link(mod.name, mod.url));
        text.append(i < all.length - 2 ? ', ' : i === all.length - 2 ? ' or ' : '. ');
      });
      text.append('Team colors work on them the same way. ', _link('About the expanded universe', EU_WIKI));
      note.append(icon, text);
    }
  }

  slot.querySelectorAll('[data-unit]').forEach((btn) => {
    const on = btn.dataset.unit === team.unit;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

function _link(label, href) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  return a;
}

function buildSwitcher(team) {
  const wrap = document.getElementById(team.id)?.querySelector('[data-ctrl="unit-switch"]');
  if (!wrap) return;
  Object.entries(UNITS).forEach(([key, unit]) => {
    const btn = document.createElement('button');
    btn.type         = 'button';
    btn.className    = 'tc-unit-btn';
    btn.dataset.unit = key;
    btn.title        = unit.name;
    const img = document.createElement('img');
    img.src = unit.logo;
    img.alt = '';
    btn.append(img, unit.faction);
    if (unit.origin === 'expanded') {
      btn.classList.add('is-mod');
      btn.title = `${unit.name} (expanded universe, community mod faction)`;
      const tag = document.createElement('span');
      tag.className = 'tc-mod-tag';
      tag.textContent = 'Mod';
      btn.append(tag);
    }
    btn.addEventListener('click', () => setTeamUnit(team, key));
    wrap.appendChild(btn);
  });
}

function setTeamUnit(team, key) {
  if (key === team.unit || !UNITS[key]) return;
  team.unit = key;
  renderTeamUnit(team);

  const url = new URL(location.href);
  url.searchParams.delete('unit');
  TEAMS.forEach((t) => url.searchParams.set(t.param, t.unit));
  history.replaceState(null, '', url);

  team.viewer.setUnit(UNITS[key]);
}

document.addEventListener('DOMContentLoaded', () => {
  TEAMS.forEach((team) => { buildSwitcher(team); renderTeamUnit(team); });
  updateOutput();

  document.getElementById('copy-btn')?.addEventListener('click', () => {
    const text = document.getElementById('localprefs-output')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copy-btn');
      const orig = btn.innerHTML;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1800);
    });
  });
});
