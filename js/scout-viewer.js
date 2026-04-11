/**
 * scout-viewer.js — Three.js 3D viewer for the ISDF Scout unit
 */

import * as THREE          from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }      from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_PATH = 'models/isdf/Scout/scout.glb';

let renderer, scene, camera, controls, loadedModel;
const clock = new THREE.Clock();

/* ── Boot ───────────────────────────────────────────────────── */
function init() {
  const wrap = document.getElementById('viewer-canvas-wrap');
  if (!wrap) return;

  if (!webGLAvailable()) {
    setStatus('WebGL is not supported by this browser.');
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

  // Environment map — drives reflections on MeshStandardMaterial
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50000);
  camera.position.set(0, 60, 320);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(300, 600, 250);
  sun.castShadow           = true;
  sun.shadow.mapSize.width = sun.shadow.mapSize.height = 1024;
  scene.add(sun);

  const amber = new THREE.PointLight(0xf6a800, 0.8, 2500);
  amber.position.set(-350, 100, 200);
  scene.add(amber);

  const rim = new THREE.DirectionalLight(0x8899ff, 0.25);
  rim.position.set(0, 100, -600);
  scene.add(rim);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.06;
  controls.enablePan       = false;
  controls.minDistance     = 40;
  controls.maxDistance     = 2000;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = -2.0;  // negative = clockwise, ~30 s per orbit

  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    const hint = document.getElementById('spin-hint');
    if (hint) hint.style.opacity = '0';
  });
  controls.addEventListener('end', () => {
    controls.autoRotate = true;
  });

  syncViewport();
  new ResizeObserver(syncViewport).observe(wrap);
  loadModel();
  animate();
}

/* ── Viewport sync ──────────────────────────────────────────── */
function syncViewport() {
  const wrap = document.getElementById('viewer-canvas-wrap');
  if (!wrap || !renderer) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}

/* ── Model loading ──────────────────────────────────────────── */
function loadModel() {
  setStatus('Initializing Systems...');

  new GLTFLoader().load(
    MODEL_PATH,
    onLoaded,
    (xhr) => {
      if (xhr.total > 0)
        setStatus(`Loading — ${Math.round(xhr.loaded / xhr.total * 100)}%`);
    },
    (err) => { console.error(err); setStatus('Failed to load model.'); }
  );
}

function onLoaded(gltf) {
  const model = gltf.scene;

  // Scale to ~150 world-units
  const box0 = new THREE.Box3().setFromObject(model);
  const span = box0.getSize(new THREE.Vector3());
  model.scale.setScalar(150 / Math.max(span.x, span.y, span.z));

  // Centre on all axes for free-form orbit
  const box1 = new THREE.Box3().setFromObject(model);
  const ctr  = box1.getCenter(new THREE.Vector3());
  model.position.sub(ctr);

  const modelH = box1.max.y - box1.min.y;

  // Enable shadows; reset base color to white so colour tints multiply cleanly
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow    = true;
    child.receiveShadow = true;
    if (child.material) {
      // Neutralise any baked-in faction colour from the GLB export
      child.material.color.set(0xffffff);
    }
  });

  loadedModel = model;

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

/* ── Render loop ────────────────────────────────────────────── */
function animate() {
  requestAnimationFrame(animate);
  controls.update(clock.getDelta());
  renderer.render(scene, camera);
}

/* ── Colour controls ────────────────────────────────────────── */
function applyTint(hex) {
  if (!loadedModel) return;
  loadedModel.traverse((child) => {
    if (!child.isMesh) return;
    child.material.color.set(hex);
  });
}

function initColourControls() {
  // Preset swatches
  document.querySelectorAll('[data-tint]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTint(btn.dataset.tint);
      document.querySelectorAll('[data-tint]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Free colour picker
  const picker = document.getElementById('tint-picker');
  if (picker) {
    picker.addEventListener('input', () => {
      applyTint(picker.value);
      document.querySelectorAll('[data-tint]').forEach(b => b.classList.remove('active'));
    });
  }
}

/* ── Utilities ──────────────────────────────────────────────── */
function setStatus(msg) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = msg;
}

function webGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}

document.addEventListener('DOMContentLoaded', () => { init(); initColourControls(); });
