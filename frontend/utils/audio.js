// audio.js - 3D spatial audio using Web Audio API HRTF
// See docs/frontend-design.md, section: Spatial Audio — HRTF

let audioCtx = null;
let activeNodes = null;   // { source, panner, gain }
const bufferCache = {};   // { [waypoint_id]: AudioBuffer }

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Pre-load all audio files for a session's waypoints
async function preloadBuffers(waypoints) {
  const ctx = getAudioContext();
  for (const wp of waypoints) {
    if (bufferCache[wp.id]) continue;
    const res = await fetch(`${API_BASE}/static/audio/${wp.audio_file}`);
    const raw = await res.arrayBuffer();
    bufferCache[wp.id] = await ctx.decodeAudioData(raw);
  }
}

// Start playing a looping audio cue for a waypoint
function startWaypointAudio(waypointId) {
  stopAudio();
  const ctx = getAudioContext();
  const buffer = bufferCache[waypointId];
  if (!buffer) return;

  const source = ctx.createBufferSource();
  const panner = ctx.createPanner();
  const gain = ctx.createGain();

  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 50;
  panner.rolloffFactor = 1;

  source.buffer = buffer;
  source.loop = true;
  source.connect(panner);
  panner.connect(gain);
  gain.connect(ctx.destination);

  gain.gain.value = 0.8;
  source.start();
  activeNodes = { source, panner, gain };
}

// Play a one-shot sound (e.g. arrival chime)
function playOneShot(buffer) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}

// Convert bearing degrees + distance to a 3D position in audio space
// Coordinate system: X = east, Z = south (Web Audio convention)
function bearingToPosition(bearingDegrees, distanceMeters) {
  const rad = (bearingDegrees * Math.PI) / 180;
  const d = Math.max(1, Math.min(distanceMeters, 50)); // clamp for smooth curve
  return {
    x: Math.sin(rad) * d,
    y: 0,
    z: -Math.cos(rad) * d,
  };
}

// Update listener orientation from device compass heading
function updateListenerOrientation(headingDegrees) {
  const ctx = getAudioContext();
  const rad = (headingDegrees * Math.PI) / 180;
  ctx.listener.forwardX.value = Math.sin(rad);
  ctx.listener.forwardY.value = 0;
  ctx.listener.forwardZ.value = -Math.cos(rad);
  ctx.listener.upX.value = 0;
  ctx.listener.upY.value = 1;
  ctx.listener.upZ.value = 0;
}

// Called on each GPS update from game.js
function update(bearingDegrees, distanceMeters) {
  if (!activeNodes) return;
  const pos = bearingToPosition(bearingDegrees, distanceMeters);
  activeNodes.panner.positionX.value = pos.x;
  activeNodes.panner.positionY.value = pos.y;
  activeNodes.panner.positionZ.value = pos.z;
  // heading comes from global state updated by geo.js
  updateListenerOrientation(state.userHeading);
}

function stopAudio() {
  if (activeNodes) {
    try { activeNodes.source.stop(); } catch (_) {}
    activeNodes = null;
  }
}

// Must be called from a user gesture (button click) before any audio plays
function resumeContext() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}
