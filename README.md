# F9bomber.com

Personal website for **F9bomber** — Battlezone: Combat Commander pilot, content creator, and Steam Workshop contributor.

Live at [f9bomber.com](https://f9bomber.com)

---

## Pages

### Home (`index.html`)
Landing page with pilot dossier, social links, and navigation. Includes links to YouTube, Instagram, Steam Workshop, Battlezone Discord servers, bz2stats.us, and Buy Me a Coffee.

### Team Color Selector (`teamcolors.html`)
Interactive tool for previewing and exporting team colors without launching the game.

- Two side-by-side Three.js viewers (Team A / Team B), each with its own unit:
  - **ISDF Scout** and **Scion Scout** (stock factions)
  - **Hadean Xypos** (expanded-universe faction from community mods such as Forgotten Enemies: Remastered and VSR, marked *Mod* on the page)
- Faction logo and stock / expanded-universe tag per team
- **Stock colors / Team color** toggle, 12 presets, a custom color picker and RGBA fine-tune inputs
- Labelled preview sliders: Grunge (clean ↔ worn) and Lighting (night ↔ day); they don't affect the export
- Full-screen mode on desktop, with the color controls beside the enlarged view
- Live `LocalPrefs.ini` output — copy the two lines directly into your config
- Team A applies to in-game teams 1–5; Team B applies to teams 6–10
- Links to the required Steam Workshop mods (Color Selector Config + Asset)
- Shareable unit selection via URL, e.g. `teamcolors.html?a=isdf&b=hadean`

---

## Project Structure

```
F9bomber.com/
├── index.html              # Home page
├── teamcolors.html         # Team Color Selector
├── css/
│   └── style.css           # Global styles (black + amber design system)
├── js/
│   ├── main.js             # Scroll spy, navbar, shared utilities
│   ├── teamcolors.js       # Unit catalogue + boots Team A / Team B viewers
│   └── unit-viewer.js      # Instance-based Three.js viewer (closure per call)
├── models/
│   ├── isdf/Scout/         # ISDF Scout FBX + textures
│   ├── scion/scout/        # Scion Scout FBX + textures (+ reference .blend)
│   └── hadean/xypos/       # Hadean Xypos FBX + textures
└── img/                    # Site images, avatar, Factions/ logos
```

---

## Tech Stack

- **Three.js r160** — 3D rendering (FBXLoader, OrbitControls, RoomEnvironment, PMREM)
- **Bootstrap 5.3** — Layout and responsive grid
- **Bootstrap Icons 1.11** — Icon set
- **Google Fonts** — Orbitron + Rajdhani
- Vanilla JS (ES modules), no build step

---

## Team Color Shader

The viewer replicates Battlezone: Combat Commander's team color system using a custom GLSL shader injected via `onBeforeCompile`:

- `_c` texture alpha = mask (where team color applies)
- `_c` texture RGB = tint template / grunge
- Blend: `mix(diffuse, pow(_c.rgb, boost) * teamColor, mask)`
- Team color values are literal 0–1 multipliers matching the game's 0–255 spec

### Adding a unit

Add one entry to `UNITS` in `js/teamcolors.js` (faction, name, logo, `origin: 'stock' | 'expanded'`, model, textures). The team switchers, logos and tags are built from that list. Per-unit options handled by `unit-viewer.js`:

- `wrap: 'repeat'` — for models whose UVs extend past 0–1 (Scion Scout, Hadean Xypos)
- `rotationX` — `0` for Y-up FBX files
- `hideMeshes` — e.g. `/^(hp_|flame)/` to hide hardpoint helpers and flames
- `glassMeshes`, `doubleSided`, `metalness`, `roughness`, `useSpecular`, `emissiveIntensity`

Each unit's in-game `.material` file lists the textures the game actually uses (diffuse, teamColor `_c`, emissive `_e`, normal `_n`, specular `_s`).

---

## Local Development

No build tools required. Serve the root directory with any static file server, for example:

```bash
npx serve .
# or
python -m http.server 8080
```

The Three.js viewers require a server (not `file://`) due to CORS restrictions on model/texture loading.

---

## Steam Workshop

- [Color Selector (Config)](https://steamcommunity.com/sharedfiles/filedetails/?id=1851090665)
- [Color Selector (Asset)](https://steamcommunity.com/sharedfiles/filedetails/?id=1851404655)

---

*Built with assistance from [Claude Code](https://claude.ai/code).*
