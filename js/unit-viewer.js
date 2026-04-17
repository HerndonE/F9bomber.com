/**
 * unit-viewer.js — Generic Three.js 3D viewer, fully instance-based.
 *
 * Each call to initViewer() creates a completely independent viewer
 * with its own renderer, scene, camera, and colour state.
 *
 * Config:
 *   containerId       — ID of the wrapper element that owns this viewer
 *   model             — path to .fbx
 *   textures          — { diffuse, colorMask, normal, specular, emissive }
 *   mirror            — true: per-fragment UV mirror correction via dFdx
 *   defaultTint       — { hex, alpha } applied on load
 *   emissiveIntensity — overrides the default 0.15
 *   onTintChange      — callback(r, g, b, a) fired after every colour change
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
  let sharedMaterial = null;
  const clock     = new THREE.Clock();
  const lights    = {};
  const tintState = { hex: '#ffffff', alpha: 0 };

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
    controls.autoRotate      = true;
    controls.autoRotateSpeed = -2.0;

    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      const hint = _q('[data-ctrl="spin-hint"]');
      if (hint) hint.style.opacity = '0';
    });
    controls.addEventListener('end', () => { controls.autoRotate = true; });

    // Defer the first measurement to after the browser has completed its
    // first layout pass — prevents reading stale column widths in grid/flex.
    requestAnimationFrame(_syncViewport);
    new ResizeObserver(_syncViewport).observe(wrap);
    _loadAssets();
    _animate();
  }

  /* ── Viewport sync ──────────────────────────────────────────── */
  function _syncViewport() {
    const wrap = _q('[data-ctrl="canvas-wrap"]');
    if (!wrap || !renderer) return;
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    if (camera) { camera.aspect = wrap.clientWidth / wrap.clientHeight; camera.updateProjectionMatrix(); }
  }

  /* ── Asset loading ──────────────────────────────────────────── */
  function _loadAssets() {
    _setStatus('Initializing Systems...');
    const tl  = new THREE.TextureLoader();
    const tex = config.textures || {};

    Promise.all([
      _loadTex(tl, tex.diffuse,   true),
      _loadTex(tl, tex.colorMask, false),
      _loadTex(tl, tex.normal,    false),
      _loadTex(tl, tex.specular,  false),
      _loadTex(tl, tex.emissive,  true),
    ]).then(([diffuse, colorMask, normal, specular, emissive]) => {
      _setStatus('Loading Model...');
      new FBXLoader().load(
        config.model,
        (fbx) => _onLoaded(fbx, { diffuse, colorMask, normal, specular, emissive }),
        (xhr) => { if (xhr.total > 0) _setStatus(`Loading — ${Math.round(xhr.loaded / xhr.total * 100)}%`); },
        (err) => { console.error(err); _setStatus('Failed to load model.'); }
      );
    }).catch((err) => { console.error(err); _setStatus('Failed to load textures.'); });
  }

  function _loadTex(loader, url, isSRGB) {
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
      loader.load(
        url,
        (tex) => { tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace; resolve(tex); },
        undefined,
        () => { console.warn(`unit-viewer: texture not found — ${url}`); resolve(null); }
      );
    });
  }

  function _onLoaded(fbx, textures) {
    const model = fbx;
    model.rotation.x = -Math.PI / 2;

    const box0 = new THREE.Box3().setFromObject(model);
    const span = box0.getSize(new THREE.Vector3());
    model.scale.setScalar(150 / Math.max(span.x, span.y, span.z));

    const box1 = new THREE.Box3().setFromObject(model);
    model.position.sub(box1.getCenter(new THREE.Vector3()));

    const modelH = box1.max.y - box1.min.y;

    sharedMaterial = _buildMaterial(textures, config.mirror || false, config.emissiveIntensity);

    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow    = true;
      child.receiveShadow = true;
      child.material      = sharedMaterial;
    });

    scene.add(model);
    camera.position.set(0, modelH * 0.3, modelH * 3.0);
    controls.target.set(0, 0, 0);
    controls.update();

    if (config.defaultTint) {
      const { hex, alpha } = config.defaultTint;
      tintState.hex   = hex;
      tintState.alpha = alpha;
      _applyTint(hex, alpha / 255);
      _syncRgbaDisplay();
      _qA('[data-tint]').forEach(b => b.classList.remove('active'));
    }

    const overlay = _q('[data-ctrl="loading"]');
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    }
  }

  /* ── Material ───────────────────────────────────────────────── */
  function _buildMaterial({ diffuse, colorMask, normal, specular, emissive }, fixMirror = false, emissiveIntensity) {
    const mat = new THREE.MeshStandardMaterial({
      map:               diffuse  || null,
      normalMap:         normal   || null,
      emissiveMap:       emissive || null,
      emissive:          emissive ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
      emissiveIntensity: emissive ? (emissiveIntensity ?? 0.15) : 0,
      roughness:         0.75,
      metalness:         0.0,
    });

    if (!colorMask && !fixMirror) return mat;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFixMirror = { value: fixMirror ? 1.0 : 0.0 };
      if (colorMask) {
        shader.uniforms.tColorMask   = { value: colorMask };
        shader.uniforms.uTintColor   = { value: new THREE.Vector3(1, 1, 1) };
        shader.uniforms.uTintAlpha   = { value: 0.0 };
        shader.uniforms.uGrungeBoost = { value: 1.0 };
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

      mat.userData.shader = shader;
    };

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
    if (!config.onTintChange) return;
    const col = new THREE.Color(tintState.hex);
    config.onTintChange(
      Math.round(col.r * 255),
      Math.round(col.g * 255),
      Math.round(col.b * 255),
      tintState.alpha
    );
  }

  function _applyGrungeBoost(value) {
    const shader = sharedMaterial?.userData.shader;
    if (!shader) return;
    shader.uniforms.uGrungeBoost.value = value;
  }

  function _applyTint(hex, alpha) {
    const shader = sharedMaterial?.userData.shader;
    if (!shader) return;
    const col = new THREE.Color(hex);
    shader.uniforms.uTintColor.value.set(col.r, col.g, col.b);
    shader.uniforms.uTintAlpha.value = alpha;
  }

  function _syncRgbaDisplay() {
    const col = new THREE.Color(tintState.hex);
    const _sv = (sel, v) => { const el = _q(sel); if (el) el.value = v; };
    _sv('[data-ctrl="tint-r"]', Math.round(col.r * 255));
    _sv('[data-ctrl="tint-g"]', Math.round(col.g * 255));
    _sv('[data-ctrl="tint-b"]', Math.round(col.b * 255));
    _sv('[data-ctrl="tint-a"]', tintState.alpha);
    const picker = _q('[data-ctrl="tint-picker"]');
    if (picker) picker.value = tintState.hex;
  }

  function _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }

  function _initColourControls() {
    // Preset swatches
    _qA('[data-tint]').forEach((btn) => {
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
        _qA('[data-tint]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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
        _qA('[data-tint]').forEach(b => b.classList.remove('active'));
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
        _qA('[data-tint]').forEach(b => b.classList.remove('active'));
        _notifyChange();
      });
    });

    // Alpha input
    const alphaInput = _q('[data-ctrl="tint-a"]');
    if (alphaInput) {
      alphaInput.addEventListener('input', () => {
        tintState.alpha = Math.max(0, Math.min(255, parseInt(alphaInput.value) || 0));
        _applyTint(tintState.hex, tintState.alpha / 255);
        if (tintState.alpha === 0) {
          _qA('[data-tint]').forEach(b => b.classList.remove('active'));
          const defBtn = _q('[data-tint="default"]');
          if (defBtn) defBtn.classList.add('active');
        }
        _notifyChange();
      });
    }

    // Grunge slider
    const grungeSlider = _q('[data-ctrl="grunge-slider"]');
    if (grungeSlider) {
      grungeSlider.addEventListener('input', () => _applyGrungeBoost(parseFloat(grungeSlider.value)));
    }

    // Day/Night slider
    const timeSlider = _q('[data-ctrl="time-slider"]');
    if (timeSlider) {
      timeSlider.addEventListener('input', () => _setTimeOfDay(timeSlider.value / 100));
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
    getTintRgba() {
      const col = new THREE.Color(tintState.hex);
      return [
        Math.round(col.r * 255),
        Math.round(col.g * 255),
        Math.round(col.b * 255),
        tintState.alpha,
      ];
    },
  };
}
