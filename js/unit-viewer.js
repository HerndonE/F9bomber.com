/**
 * unit-viewer.js — Generic Three.js 3D viewer for ISDF/NSDF unit pages.
 *
 * Usage (in a unit-specific wrapper script):
 *
 *   import { initViewer } from './unit-viewer.js';
 *
 *   initViewer({
 *     model: 'models/isdf/Scout/ivscout00.fbx',
 *     textures: {
 *       diffuse:   'models/isdf/Scout/ivscou00.png',    // required
 *       colorMask: 'models/isdf/Scout/ivscou00_c.png',  // optional — RGBA, alpha = team-colour mask
 *       normal:    'models/isdf/Scout/ivscou00_n.png',  // optional
 *       specular:  'models/isdf/Scout/ivscou00_s.png',  // optional
 *       emissive:  'models/isdf/Scout/ivscou00_e.png',  // optional
 *     },
 *   });
 *
 * Adding a new unit:
 *   1. Drop the FBX + PNG textures into  models/{faction}/{UnitName}/
 *   2. Create  js/{unitname}-viewer.js  (copy the pattern above)
 *   3. Create  {unitname}.html  (copy scout.html, update text content)
 *   4. Point the script tag at the new viewer file — done.
 *
 * Shader blend:  diffuseColor.rgb = mix(base, uTintColor, _c.a * uTintAlpha)
 *   uTintAlpha 0  →  base texture only  (Default swatch)
 *   uTintAlpha 1  →  full team-colour in masked regions
 */

import * as THREE          from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { FBXLoader }       from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function initViewer(config) {
  document.addEventListener('DOMContentLoaded', () => {
    _init(config);
    _initColourControls();
  });
}

/* ─────────────────────────────────────────────────────────────
   Module-level state
───────────────────────────────────────────────────────────── */
let renderer, scene, camera, controls;
let sharedMaterial = null;
const clock  = new THREE.Clock();
const lights = {};
const tintState = { hex: '#ffffff', alpha: 0 };

/* ── Boot ───────────────────────────────────────────────────── */
function _init(config) {
  const wrap = document.getElementById('viewer-canvas-wrap');
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
  controls.autoRotate      = true;
  controls.autoRotateSpeed = -2.0;

  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    const hint = document.getElementById('spin-hint');
    if (hint) hint.style.opacity = '0';
  });
  controls.addEventListener('end', () => { controls.autoRotate = true; });

  _syncViewport();
  new ResizeObserver(_syncViewport).observe(wrap);
  _loadAssets(config);
  _animate();
}

/* ── Viewport sync ──────────────────────────────────────────── */
function _syncViewport() {
  const wrap = document.getElementById('viewer-canvas-wrap');
  if (!wrap || !renderer) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}

/* ── Asset loading ──────────────────────────────────────────── */
function _loadAssets(config) {
  _setStatus('Initializing Systems...');

  const tl   = new THREE.TextureLoader();
  const tex  = config.textures || {};

  // All textures are optional — missing ones resolve to null gracefully
  Promise.all([
    _loadTex(tl, tex.diffuse,   true),
    _loadTex(tl, tex.colorMask, true),
    _loadTex(tl, tex.normal,    false),
    _loadTex(tl, tex.specular,  false),
    _loadTex(tl, tex.emissive,  true),
  ]).then(([diffuse, colorMask, normal, specular, emissive]) => {
    _setStatus('Loading Model...');
    new FBXLoader().load(
      config.model,
      (fbx) => _onLoaded(fbx, { diffuse, colorMask, normal, specular, emissive }),
      (xhr) => {
        if (xhr.total > 0)
          _setStatus(`Loading — ${Math.round(xhr.loaded / xhr.total * 100)}%`);
      },
      (err) => { console.error(err); _setStatus('Failed to load model.'); }
    );
  }).catch((err) => { console.error(err); _setStatus('Failed to load textures.'); });
}

function _loadTex(loader, url, isSRGB) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
        resolve(tex);
      },
      undefined,
      () => { console.warn(`unit-viewer: texture not found — ${url}`); resolve(null); }
    );
  });
}

function _onLoaded(fbx, textures) {
  const model = fbx;

  // FBX from 3DS Max uses Z-up; rotate to Three.js Y-up
  model.rotation.x = -Math.PI / 2;

  const box0 = new THREE.Box3().setFromObject(model);
  const span = box0.getSize(new THREE.Vector3());
  model.scale.setScalar(150 / Math.max(span.x, span.y, span.z));

  const box1 = new THREE.Box3().setFromObject(model);
  const ctr  = box1.getCenter(new THREE.Vector3());
  model.position.sub(ctr);

  const modelH = box1.max.y - box1.min.y;

  sharedMaterial = _buildMaterial(textures);

  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow  = true;
    child.receiveShadow = true;
    child.material    = sharedMaterial;
  });

  scene.add(model);

  camera.position.set(0, modelH * 0.3, modelH * 3.0);
  controls.target.set(0, 0, 0);
  controls.update();

  const overlay = document.getElementById('viewer-loading');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  }
}

/* ── Material with _c colour-mask shader ────────────────────── */
function _buildMaterial({ diffuse, colorMask, normal, specular, emissive }) {
  const mat = new THREE.MeshStandardMaterial({
    map:               diffuse  || null,
    normalMap:         normal   || null,
    emissiveMap:       emissive || null,
    emissive:          emissive ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: emissive ? 0.15 : 0,
    roughness:         0.75,
    metalness:         0.0,
  });

  if (!colorMask) return mat;  // no _c — plain diffuse, colour overlay disabled

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tColorMask = { value: colorMask };
    shader.uniforms.uTintColor = { value: new THREE.Vector3(1, 1, 1) };
    shader.uniforms.uTintAlpha = { value: 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        `#include <common>\nvarying vec2 vColorMaskUv;`)
      .replace('#include <uv_vertex>',
        `#include <uv_vertex>\nvColorMaskUv = uv;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
uniform sampler2D tColorMask;
uniform vec3      uTintColor;
uniform float     uTintAlpha;
varying vec2      vColorMaskUv;`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
vec4  _c = texture2D(tColorMask, vColorMaskUv);
diffuseColor.rgb = mix(diffuseColor.rgb, uTintColor, _c.a * uTintAlpha);`);

    mat.userData.shader = shader;
  };

  return mat;
}

/* ── Render loop ────────────────────────────────────────────── */
function _animate() {
  requestAnimationFrame(_animate);
  controls.update(clock.getDelta());
  renderer.render(scene, camera);
}

/* ── Colour controls ────────────────────────────────────────── */
function _applyTint(hex, alpha) {
  const shader = sharedMaterial && sharedMaterial.userData.shader;
  if (!shader) return;
  const col = new THREE.Color(hex).convertSRGBToLinear();
  shader.uniforms.uTintColor.value.set(col.r, col.g, col.b);
  shader.uniforms.uTintAlpha.value = alpha;
}

function _syncRgbaDisplay() {
  const col = new THREE.Color(tintState.hex);
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('tint-r', Math.round(col.r * 255));
  setVal('tint-g', Math.round(col.g * 255));
  setVal('tint-b', Math.round(col.b * 255));
  setVal('tint-a', tintState.alpha);
  const picker = document.getElementById('tint-picker');
  if (picker) picker.value = tintState.hex;
}

function _rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('');
}

function _initColourControls() {
  // Preset swatches
  document.querySelectorAll('[data-tint]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.tint;
      if (val === 'default') {
        tintState.alpha = 0;
      } else {
        tintState.hex   = val;
        tintState.alpha = 255;
      }
      _applyTint(tintState.hex, tintState.alpha / 255);
      _syncRgbaDisplay();
      document.querySelectorAll('[data-tint]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Free colour picker
  const picker = document.getElementById('tint-picker');
  if (picker) {
    picker.addEventListener('input', () => {
      tintState.hex   = picker.value;
      tintState.alpha = tintState.alpha === 0 ? 255 : tintState.alpha;
      _applyTint(tintState.hex, tintState.alpha / 255);
      _syncRgbaDisplay();
      document.querySelectorAll('[data-tint]').forEach(b => b.classList.remove('active'));
    });
  }

  // RGB number inputs
  ['tint-r', 'tint-g', 'tint-b'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const r = parseInt(document.getElementById('tint-r').value) || 0;
      const g = parseInt(document.getElementById('tint-g').value) || 0;
      const b = parseInt(document.getElementById('tint-b').value) || 0;
      tintState.hex   = _rgbToHex(r, g, b);
      tintState.alpha = tintState.alpha === 0 ? 255 : tintState.alpha;
      _applyTint(tintState.hex, tintState.alpha / 255);
      const picker = document.getElementById('tint-picker');
      if (picker) picker.value = tintState.hex;
      document.querySelectorAll('[data-tint]').forEach(b => b.classList.remove('active'));
    });
  });

  // Alpha input
  const alphaInput = document.getElementById('tint-a');
  if (alphaInput) {
    alphaInput.addEventListener('input', () => {
      tintState.alpha = Math.max(0, Math.min(255, parseInt(alphaInput.value) || 0));
      _applyTint(tintState.hex, tintState.alpha / 255);
      if (tintState.alpha === 0) {
        document.querySelectorAll('[data-tint]').forEach(b => b.classList.remove('active'));
        const defBtn = document.querySelector('[data-tint="default"]');
        if (defBtn) defBtn.classList.add('active');
      }
    });
  }

  // Day/Night slider
  const timeSlider = document.getElementById('time-slider');
  if (timeSlider) {
    timeSlider.addEventListener('input', () => _setTimeOfDay(timeSlider.value / 100));
  }
}

/* ── Day / Night ────────────────────────────────────────────── */
function _setTimeOfDay(t) {  // t: 0 = night, 1 = day
  lights.ambient.intensity = THREE.MathUtils.lerp(0.04, 0.6,  t);
  lights.sun.intensity     = THREE.MathUtils.lerp(0.0,  1.4,  t);
  lights.amber.intensity   = THREE.MathUtils.lerp(1.2,  0.8,  t);
  lights.rim.intensity     = THREE.MathUtils.lerp(1.0,  0.25, t);
}

/* ── Utilities ──────────────────────────────────────────────── */
function _setStatus(msg) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = msg;
}

function _webGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}
