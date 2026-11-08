/**
 * unit-viewer.js — Generic Three.js 3D viewer, fully instance-based.
 *
 * Each call to initViewer() creates a completely independent viewer
 * with its own renderer, scene, camera, and colour state.
 *
 * Config (viewer):
 *   containerId       — ID of the wrapper element that owns this viewer
 *   defaultTint       — { hex, alpha } applied on load
 *   onTintChange      — callback(r, g, b, a) fired after every colour change
 *   ...plus the unit options below for the initial unit.
 *
 * Unit options (initial config, or setUnit(unit) to swap models at runtime):
 *   model             — path to .fbx
 *   textures          — { diffuse, colorMask, normal, specular, emissive }
 *   mirror            — true: per-fragment UV mirror correction via dFdx
 *   wrap              — 'repeat': RepeatWrapping on all maps (for UVs outside 0–1)
 *   rotationX         — model X rotation in radians (default -PI/2)
 *   hideMeshes        — RegExp of node names to hide (hardpoints, flames…)
 *   doubleSided       — array of mesh names rendered double-sided
 *   glassMeshes       — array of mesh names given a tinted glass material
 *   metalness         — PBR metalness (default 0)
 *   roughness         — PBR roughness (default 0.75)
 *   useSpecular       — true: wire textures.specular in as a specular colour map
 *   emissiveIntensity — overrides the default 0.15
 *   viewAzimuth       — starting camera angle in degrees (default 35)
 *
 * Shader blend: diffuseColor.rgb = mix(base, _c.rgb * uTintColor, _c.a * uTintAlpha)
 *   uTintAlpha 0  →  base texture only
 *   uTintAlpha 1  →  full team-colour in masked regions
 */

import * as THREE          from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { FBXLoader }       from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function initViewer(config) {

  /* ── Instance state ─────────────────────────────────────────── */
  let renderer, scene, camera, controls;
  let currentModel = null;
  let loadToken    = 0;
  let spinOn       = false;
  const clock     = new THREE.Clock();
  const lights    = {};
  // alpha 0 = stock paint; lastAlpha remembers the strength to restore
  const tintState = { hex: '#ffffff', alpha: 0, lastAlpha: 255, initialised: false };

  // Tint uniforms are shared objects so every material built for a unit
  // (single- and double-sided variants) stays in sync, and a shader that
  // compiles after the tint was set still picks up the current value.
  const tintUniforms = {
    uTintColor:   { value: new THREE.Vector3(1, 1, 1) },
    uTintAlpha:   { value: 0.0 },
    uGrungeBoost: { value: 1.0 },
  };

  /* ── DOM helpers — all queries scoped to the container ─────── */
  const _container = () => document.getElementById(config.containerId);
  const _q  = (sel) => _container()?.querySelector(sel);
  const _qA = (sel) => Array.from(_container()?.querySelectorAll(sel) ?? []);

  /* ── Boot ───────────────────────────────────────────────────── */
  function _init() {
    const wrap = _q('[data-ctrl="canvas-wrap"]');
    if (!wrap) return;

    if (!_webGLAvailable()) {
      _setStatus('WebGL is not supported by this browser.');
      return;
    }

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled   = true;
    renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace    = THREE.SRGBColorSpace;
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    wrap.appendChild(renderer.domElement);

    scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50000);
    camera.position.set(0, 60, 320);

    lights.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(lights.ambient);

    lights.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    lights.sun.position.set(300, 600, 250);
    lights.sun.castShadow           = true;
    lights.sun.shadow.mapSize.width = lights.sun.shadow.mapSize.height = 1024;
    scene.add(lights.sun);

    lights.amber = new THREE.PointLight(0xf6a800, 0.8, 2500);
    lights.amber.position.set(-350, 100, 200);
    scene.add(lights.amber);

    lights.rim = new THREE.DirectionalLight(0x8899ff, 0.25);
    lights.rim.position.set(0, 100, -600);
    scene.add(lights.rim);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping   = true;
    controls.dampingFactor   = 0.06;
    controls.enablePan       = false;
    controls.minDistance     = 40;
    controls.maxDistance     = 2000;
    // Models load still; the Spin toggle turns auto-rotation on
    controls.autoRotate      = false;
    controls.autoRotateSpeed = -2.0;

    controls.addEventListener('start', () => {
      controls.autoRotate = false;          // pause while the user drags
      const hint = _q('[data-ctrl="spin-hint"]');
      if (hint) hint.style.opacity = '0';
    });
    controls.addEventListener('end', () => { controls.autoRotate = spinOn; });

    // Defer the first measurement to after the browser has completed its
    // first layout pass — prevents reading stale column widths in grid/flex.
    requestAnimationFrame(_syncViewport);
    new ResizeObserver(_syncViewport).observe(wrap);
    _initFullscreen();
    _initSpinToggle();
    _loadAssets(config);
    _animate();
  }

  /* ── Spin toggle ──────────────────────────────────────────────── */
  function _initSpinToggle() {
    const btn = _q('[data-ctrl="spin-toggle"]');
    if (!btn) return;
    const sync = () => {
      btn.classList.toggle('active', spinOn);
      btn.setAttribute('aria-pressed', String(spinOn));
      btn.querySelector('.viewer-spin-state').textContent = spinOn ? 'On' : 'Off';
      btn.title = spinOn ? 'Stop spinning' : 'Spin the model';
    };
    btn.addEventListener('click', () => {
      spinOn = !spinOn;
      controls.autoRotate = spinOn;
      sync();
    });
    sync();
  }

  /* ── Full screen (desktop) ──────────────────────────────────────
     The whole team panel (.tc-slot) goes full screen so the colour
     controls stay usable beside the enlarged view. The canvas resizes
     through the ResizeObserver on the canvas wrap. */
  function _initFullscreen() {
    const btn  = _q('[data-ctrl="fullscreen"]');
    const slot = _container();
    if (!btn || !slot) return;
    const request = slot.requestFullscreen || slot.webkitRequestFullscreen;
    const exit    = document.exitFullscreen || document.webkitExitFullscreen;
    const enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    if (!request || !enabled) return;           // leave the button hidden
    btn.hidden = false;

    const current = () => document.fullscreenElement || document.webkitFullscreenElement;

    // Hide / show the controls column while in full screen
    const panelBtn = _q('[data-ctrl="panel-toggle"]');
    const setPanelHidden = (hide) => {
      slot.classList.toggle('panel-hidden', hide);
      if (panelBtn) {
        panelBtn.setAttribute('aria-pressed', String(hide));
        panelBtn.querySelector('.viewer-panel-label').textContent = hide ? 'Show panel' : 'Hide panel';
        panelBtn.querySelector('i').className = hide ? 'bi bi-layout-sidebar-inset' : 'bi bi-layout-sidebar-inset-reverse';
        panelBtn.title = hide ? 'Show the color panel' : 'Hide the color panel for a full-screen view';
      }
      requestAnimationFrame(_syncViewport);
    };
    panelBtn?.addEventListener('click', () => setPanelHidden(!slot.classList.contains('panel-hidden')));

    // In full screen, fade the overlay buttons out after a moment without
    // input (like a video player); any movement, click, scroll or key wakes them.
    const IDLE_MS = 2500;
    let idleTimer = null;
    const goIdle = () => {
      // Stay visible while the pointer rests on, or keyboard focus is in, a button
      if (slot.querySelector('.viewer-actions:hover, .viewer-spin-btn:hover, .viewer-canvas-wrap button:focus-visible')) {
        idleTimer = setTimeout(goIdle, IDLE_MS);
        return;
      }
      slot.classList.add('controls-idle');
    };
    const wake = () => {
      clearTimeout(idleTimer);
      slot.classList.remove('controls-idle');
      if (slot.classList.contains('is-fullscreen')) idleTimer = setTimeout(goIdle, IDLE_MS);
    };
    ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart'].forEach((type) =>
      slot.addEventListener(type, wake, { passive: true }));

    btn.addEventListener('click', () => {
      if (current() === slot) exit.call(document);
      else Promise.resolve(request.call(slot)).catch((err) => console.warn('unit-viewer: fullscreen failed', err));
    });

    const sync = () => {
      const on = current() === slot;
      slot.classList.toggle('is-fullscreen', on);
      if (!on) setPanelHidden(false);          // always restore the panel on exit
      wake();                                  // starts the idle timer only in full screen
      btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      btn.title = on ? 'Exit full screen (Esc)' : 'Full screen — adjust colors with a bigger view';
      btn.querySelector('i').className = on ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen';
      btn.querySelector('.viewer-fs-label').textContent = on ? 'Exit' : 'Full screen';
      requestAnimationFrame(_syncViewport);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }

  /* ── Viewport sync ──────────────────────────────────────────── */
  function _syncViewport() {
    const wrap = _q('[data-ctrl="canvas-wrap"]');
    if (!wrap || !renderer) return;
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    if (camera) { camera.aspect = wrap.clientWidth / wrap.clientHeight; camera.updateProjectionMatrix(); }
  }

  /* ── Asset loading ──────────────────────────────────────────── */
  function _loadAssets(unit) {
    const token  = ++loadToken;   // a newer request supersedes this one
    const tl     = new THREE.TextureLoader();
    const tex    = unit.textures || {};
    const repeat = unit.wrap === 'repeat';
    _showLoading(true);
    _setStatus('Initializing Systems...');

    return Promise.all([
      _loadTex(tl, tex.diffuse,   true,  repeat),
      _loadTex(tl, tex.colorMask, false, repeat),
      _loadTex(tl, tex.normal,    false, repeat),
      _loadTex(tl, tex.specular,  false, repeat),
      _loadTex(tl, tex.emissive,  true,  repeat),
    ]).then(([diffuse, colorMask, normal, specular, emissive]) => new Promise((resolve) => {
      if (token !== loadToken) return resolve();
      _setStatus('Loading Model...');
      new FBXLoader().load(
        unit.model,
        (fbx) => {
          if (token === loadToken) _onLoaded(fbx, unit, { diffuse, colorMask, normal, specular, emissive });
          resolve();
        },
        (xhr) => {
          if (xhr.total > 0 && token === loadToken) _setStatus(`Loading — ${Math.round(xhr.loaded / xhr.total * 100)}%`);
        },
        (err) => { console.error(err); _setStatus('Failed to load model.'); resolve(); }
      );
    })).catch((err) => { console.error(err); _setStatus('Failed to load textures.'); });
  }

  function _loadTex(loader, url, isSRGB, repeat) {
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
          if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          resolve(tex);
        },
        undefined,
        () => { console.warn(`unit-viewer: texture not found — ${url}`); resolve(null); }
      );
    });
  }

  function _onLoaded(fbx, unit, textures) {
    _disposeModel();

    const model = fbx;
    model.rotation.x = unit.rotationX ?? -Math.PI / 2;

    // Hide hardpoints / flames before measuring so they don't skew framing
    if (unit.hideMeshes) {
      model.traverse((child) => { if (unit.hideMeshes.test(child.name)) child.visible = false; });
    }

    const box0 = _visibleBox(model);
    const span = box0.getSize(new THREE.Vector3());
    model.scale.setScalar(150 / Math.max(span.x, span.y, span.z));

    const box1 = _visibleBox(model);
    model.position.sub(box1.getCenter(new THREE.Vector3()));

    const modelH = box1.max.y - box1.min.y;

    const hullMaterial = _buildMaterial(textures, unit);
    let sideMaterial   = null;
    let glassMaterial  = null;

    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow    = true;
      child.receiveShadow = true;
      if (unit.glassMeshes?.includes(child.name)) {
        if (!glassMaterial) glassMaterial = _buildGlassMaterial();
        child.material   = glassMaterial;
        child.castShadow = false;
      } else if (unit.doubleSided?.includes(child.name)) {
        if (!sideMaterial) sideMaterial = _buildMaterial(textures, unit, THREE.DoubleSide);
        child.material = sideMaterial;
      } else {
        child.material = hullMaterial;
      }
    });

    currentModel = model;
    scene.add(model);
    const radius = _visibleBox(model).getBoundingSphere(new THREE.Sphere()).radius;
    const fitDist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.85;
    const dist    = Math.max(modelH * 3.0, fitDist);
    // Start from a three-quarter angle. viewAzimuth (degrees) is per unit
    // because models face different axes; positive swings toward +X.
    const az = THREE.MathUtils.degToRad(unit.viewAzimuth ?? 35);
    camera.position.set(Math.sin(az) * dist, dist * 0.25, Math.cos(az) * dist);
    controls.target.set(0, 0, 0);
    controls.update();

    if (config.defaultTint && !tintState.initialised) {
      const { hex, alpha } = config.defaultTint;
      tintState.hex   = hex;
      tintState.alpha = alpha;
      _syncRgbaDisplay();
      _qA('[data-tint]').forEach(b => b.classList.remove('active'));
    }
    if (!tintState.initialised) _notifyChange();
    tintState.initialised = true;
    _syncModeUI();
    _applyTint(tintState.hex, tintState.alpha / 255);

    _showLoading(false);
  }

  function _visibleBox(root) {
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    root.traverseVisible((child) => { if (child.isMesh) box.expandByObject(child); });
    return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
  }

  function _disposeModel() {
    if (!currentModel) return;
    scene.remove(currentModel);
    const mats = new Set();
    const texs = new Set();
    currentModel.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      [].concat(child.material).forEach((m) => m && mats.add(m));
    });
    mats.forEach((m) => {
      ['map', 'normalMap', 'emissiveMap', 'specularColorMap'].forEach((k) => m[k] && texs.add(m[k]));
      if (m.userData.colorMask) texs.add(m.userData.colorMask);
      m.dispose();
    });
    texs.forEach((t) => t.dispose());
    currentModel = null;
  }

  function _showLoading(show) {
    const overlay = _q('[data-ctrl="loading"]');
    if (!overlay) return;
    if (show) {
      overlay.style.display = '';
      overlay.style.opacity = '1';
    } else {
      overlay.style.opacity = '0';
      const hide = () => { if (overlay.style.opacity === '0') overlay.style.display = 'none'; };
      overlay.addEventListener('transitionend', hide, { once: true });
      setTimeout(hide, 800);
    }
  }

  /* ── Material ───────────────────────────────────────────────── */
  function _buildGlassMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color:           0x0b1a1c,
      metalness:       0.2,
      roughness:       0.08,
      transparent:     true,
      opacity:         0.8,
      clearcoat:       1.0,
      envMapIntensity: 1.5,
    });
  }

  function _buildMaterial({ diffuse, colorMask, normal, specular, emissive }, unit, side = THREE.FrontSide) {
    const fixMirror = unit.mirror || false;
    const params = {
      map:               diffuse  || null,
      normalMap:         normal   || null,
      emissiveMap:       emissive || null,
      emissive:          emissive ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
      emissiveIntensity: emissive ? (unit.emissiveIntensity ?? 0.15) : 0,
      roughness:         unit.roughness ?? 0.75,
      metalness:         unit.metalness ?? 0.0,
      side,
    };

    let mat;
    if (unit.useSpecular && specular) {
      // Blender wires _s into Principled "Specular IOR Level", where 0.5 is
      // the default F0. specularColor ×2 maps a 0.5 texel back to default.
      mat = new THREE.MeshPhysicalMaterial({
        ...params,
        specularColorMap:  specular,
        specularColor:     new THREE.Color(2, 2, 2),
        specularIntensity: 1.0,
      });
    } else {
      mat = new THREE.MeshStandardMaterial(params);
    }

    if (!colorMask && !fixMirror) return mat;
    mat.userData.colorMask = colorMask;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFixMirror = { value: fixMirror ? 1.0 : 0.0 };
      if (colorMask) {
        shader.uniforms.tColorMask   = { value: colorMask };
        shader.uniforms.uTintColor   = tintUniforms.uTintColor;
        shader.uniforms.uTintAlpha   = tintUniforms.uTintAlpha;
        shader.uniforms.uGrungeBoost = tintUniforms.uGrungeBoost;
      }

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vColorMaskUv;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvColorMaskUv = uv;`);

      const colorMaskUniforms = colorMask ? `
uniform sampler2D tColorMask;
uniform vec3      uTintColor;
uniform float     uTintAlpha;
uniform float     uGrungeBoost;` : '';

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          `#include <common>
${colorMaskUniforms}
uniform float uFixMirror;
varying vec2  vColorMaskUv;
vec2 _fixUv(vec2 uv) {
  return (uFixMirror > 0.5 && dFdx(uv.x) < 0.0) ? vec2(1.0 - uv.x, uv.y) : uv;
}`)
        .replace('#include <map_fragment>',
          `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, _fixUv(vMapUv));
  diffuseColor *= sampledDiffuseColor;
#endif`);

      if (colorMask) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <color_fragment>',
            `#include <color_fragment>
vec4  _c     = texture2D(tColorMask, _fixUv(vColorMaskUv));
vec3  grunge = pow(_c.rgb, vec3(uGrungeBoost));
diffuseColor.rgb = mix(diffuseColor.rgb, grunge * uTintColor, _c.a * uTintAlpha);`);
      }
    };
    // Keep mirror / non-mirror variants from sharing a cached program
    mat.customProgramCacheKey = () => `bzunit-${fixMirror ? 1 : 0}-${colorMask ? 1 : 0}`;

    return mat;
  }

  /* ── Render loop ────────────────────────────────────────────── */
  function _animate() {
    requestAnimationFrame(_animate);
    controls?.update(clock.getDelta());
    renderer?.render(scene, camera);
  }

  /* ── Colour controls ────────────────────────────────────────── */
  function _notifyChange() {
    if (tintState.alpha > 0) tintState.lastAlpha = tintState.alpha;
    _syncModeUI();
    if (!config.onTintChange) return;
    const [r, g, b] = _hexToRgb(tintState.hex);
    config.onTintChange(r, g, b, tintState.alpha);
  }

  function _applyGrungeBoost(value) {
    tintUniforms.uGrungeBoost.value = value;
  }

  function _applyTint(hex, alpha) {
    const col = new THREE.Color(hex);
    tintUniforms.uTintColor.value.set(col.r, col.g, col.b);
    tintUniforms.uTintAlpha.value = alpha;
  }

  function _syncRgbaDisplay() {
    const [r, g, b] = _hexToRgb(tintState.hex);
    const _sv = (sel, v) => { const el = _q(sel); if (el) el.value = v; };
    _sv('[data-ctrl="tint-r"]', r);
    _sv('[data-ctrl="tint-g"]', g);
    _sv('[data-ctrl="tint-b"]', b);
    _sv('[data-ctrl="tint-a"]', tintState.alpha);
    const picker = _q('[data-ctrl="tint-picker"]');
    if (picker) picker.value = tintState.hex;
  }

  // Hex → [r, g, b] in sRGB 0–255, i.e. exactly what the user picked.
  function _hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* Stock / Team-colour toggle, status line and swatch highlight all
     derive from tintState here, so every control path stays consistent. */
  function _syncModeUI() {
    const stock = tintState.alpha === 0;
    _qA('[data-mode]').forEach((btn) => {
      const on = (btn.dataset.mode === 'stock') === stock;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    _qA('[data-tint]').forEach((btn) => {
      btn.classList.toggle('active', !stock && btn.dataset.tint.toLowerCase() === tintState.hex.toLowerCase());
    });
    const wrap = _q('.tc-colour-controls');
    if (wrap) wrap.classList.toggle('is-stock', stock);

    const status = _q('[data-ctrl="tint-status"]');
    if (status) {
      if (stock) {
        status.innerHTML = "<strong>Stock colors</strong> — the unit's original paint. Pick a color below to apply a team color.";
      } else {
        const [r, g, b] = _hexToRgb(tintState.hex);
        const pct = Math.round(tintState.alpha / 255 * 100);
        status.innerHTML = `<span class="tc-status-chip" style="background:${tintState.hex}"></span>`
          + `<strong>Team color</strong> — ${r} ${g} ${b} at ${pct}% strength on the armor panels.`;
      }
    }
  }

  function _setStock(stock) {
    tintState.alpha = stock ? 0 : (tintState.lastAlpha || 255);
    _applyTint(tintState.hex, tintState.alpha / 255);
    _syncRgbaDisplay();
    _notifyChange();
  }

  function _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }

  function _initColourControls() {
    // Stock colors / Team color toggle
    _qA('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => _setStock(btn.dataset.mode === 'stock'));
    });

    // Preset swatches
    _qA('[data-tint]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tintState.hex   = btn.dataset.tint;
        tintState.alpha = 255;
        _applyTint(tintState.hex, tintState.alpha / 255);
        _syncRgbaDisplay();
        _notifyChange();
      });
    });

    // Free colour picker
    const picker = _q('[data-ctrl="tint-picker"]');
    if (picker) {
      picker.addEventListener('input', () => {
        tintState.hex   = picker.value;
        tintState.alpha = tintState.alpha === 0 ? 255 : tintState.alpha;
        _applyTint(tintState.hex, tintState.alpha / 255);
        _syncRgbaDisplay();
        _notifyChange();
      });
    }

    // RGB inputs
    ['tint-r', 'tint-g', 'tint-b'].forEach((ctrl) => {
      const el = _q(`[data-ctrl="${ctrl}"]`);
      if (!el) return;
      el.addEventListener('input', () => {
        const r = parseInt(_q('[data-ctrl="tint-r"]')?.value) || 0;
        const g = parseInt(_q('[data-ctrl="tint-g"]')?.value) || 0;
        const b = parseInt(_q('[data-ctrl="tint-b"]')?.value) || 0;
        tintState.hex   = _rgbToHex(r, g, b);
        tintState.alpha = tintState.alpha === 0 ? 255 : tintState.alpha;
        _applyTint(tintState.hex, tintState.alpha / 255);
        const pk = _q('[data-ctrl="tint-picker"]');
        if (pk) pk.value = tintState.hex;
        const ai = _q('[data-ctrl="tint-a"]');
        if (ai) ai.value = tintState.alpha;
        _notifyChange();
      });
    });

    // Alpha input
    const alphaInput = _q('[data-ctrl="tint-a"]');
    if (alphaInput) {
      alphaInput.addEventListener('input', () => {
        tintState.alpha = Math.max(0, Math.min(255, parseInt(alphaInput.value) || 0));
        _applyTint(tintState.hex, tintState.alpha / 255);
        _notifyChange();
      });
    }

    // Grunge slider
    const grungeSlider = _q('[data-ctrl="grunge-slider"]');
    if (grungeSlider) {
      grungeSlider.addEventListener('input', () => {
        _applyGrungeBoost(parseFloat(grungeSlider.value));
        _sliderReadout(grungeSlider);
      });
      _sliderReadout(grungeSlider);
    }

    // Day/Night slider
    const timeSlider = _q('[data-ctrl="time-slider"]');
    if (timeSlider) {
      timeSlider.addEventListener('input', () => {
        _setTimeOfDay(timeSlider.value / 100);
        _sliderReadout(timeSlider);
      });
      _sliderReadout(timeSlider);
    }
  }

  // Text readout next to each slider (element: [data-readout="<slider ctrl>"])
  function _sliderReadout(slider) {
    const out = _q(`[data-readout="${slider.dataset.ctrl}"]`);
    if (!out) return;
    const v = parseFloat(slider.value);
    if (slider.dataset.ctrl === 'grunge-slider') {
      out.textContent = v <= 1.0001 ? 'Off' : `${Math.round((v - 1) / 3 * 100)}%`;
    } else {
      out.textContent = v < 25 ? 'Night' : v < 60 ? 'Dusk' : 'Day';
    }
  }

  /* ── Day / Night ────────────────────────────────────────────── */
  function _setTimeOfDay(t) {
    lights.ambient.intensity = THREE.MathUtils.lerp(0.04, 0.6,  t);
    lights.sun.intensity     = THREE.MathUtils.lerp(0.0,  1.4,  t);
    lights.amber.intensity   = THREE.MathUtils.lerp(1.2,  0.8,  t);
    lights.rim.intensity     = THREE.MathUtils.lerp(1.0,  0.25, t);
  }

  /* ── Utilities ──────────────────────────────────────────────── */
  function _setStatus(msg) {
    const el = _q('[data-ctrl="loading-text"]');
    if (el) el.textContent = msg;
  }

  function _webGLAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch { return false; }
  }

  /* ── Start ──────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    _init();
    _initColourControls();
  });

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    /** Swap to a different unit model, keeping the current team colour. */
    setUnit(unit) {
      if (!renderer) return Promise.resolve();
      return _loadAssets(unit);
    },
    getTintRgba() {
      return [..._hexToRgb(tintState.hex), tintState.alpha];
    },
  };
}
