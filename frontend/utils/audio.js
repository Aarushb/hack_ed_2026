// audio.js — 3D spatial audio using Web Audio API HRTF.
// Places a looping sound cue in 3D space relative to the user's head.
// On each GPS update the panner position is recalculated from bearing/distance.
// HRTF gives genuine 3D perception with headphones (front/behind/left/right).

let audioCtx = null;
let activeNodes = null;   // { source, panner, gain }
const bufferCache = {};   // waypointId → AudioBuffer
const failedAudioFiles = new Set(); // audio_file → true when fetch/decode failed

// Synthesised arrival chime buffer (created once on first use)
let _arrivalChimeBuffer = null;

/**
 * Lazily create (or return existing) AudioContext.
 * Must be resumed from a user gesture before audio will play.
 */
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * Resume AudioContext from suspended state. Call this from a button
 * click handler — browsers block audio until a user gesture occurs.
 */
function resumeContext() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    return ctx.resume();
  }
  return Promise.resolve();
}

/**
 * Pre-load audio buffers for all waypoints in the session.
 * Fetches each file once and caches the decoded AudioBuffer.
 * Silently skips any that fail to load (navigation still works without audio).
 *
 * @param {Array} waypoints - array of waypoint objects with `.id` and `.audio_file`
 */
async function preloadBuffers(waypoints) {
  const ctx = getAudioContext();

  for (const wp of waypoints) {
    if (bufferCache[wp.id]) continue; // already cached

    if (!wp.audio_file) {
      continue;
    }

    if (failedAudioFiles.has(wp.audio_file)) {
      continue;
    }

    try {
      const res = await fetch(`${API_BASE}/static/audio/${wp.audio_file}`);
      if (!res.ok) {
        console.warn(`[audio] Failed to fetch audio for waypoint ${wp.id}: HTTP ${res.status}`);
        failedAudioFiles.add(wp.audio_file);
        continue;
      }
      const raw = await res.arrayBuffer();
      bufferCache[wp.id] = await ctx.decodeAudioData(raw);
    } catch (err) {
      // Non-fatal — spatial audio for this waypoint simply won't play
      console.warn(`[audio] Could not decode audio for waypoint ${wp.id}:`, err.message);
      failedAudioFiles.add(wp.audio_file);
    }
  }
}

/**
 * Start playing a looping HRTF-positioned audio cue for a waypoint.
 * Stops any currently playing cue first.
 *
 * @param {string} waypointId
 */
function startWaypointAudio(waypointId) {
  stopAudio();

  const ctx = getAudioContext();
  const buffer = bufferCache[waypointId];
  if (!buffer) {
    console.warn(`[audio] No cached buffer for waypoint ${waypointId}`);
    return;
  }

  const source = ctx.createBufferSource();
  const panner = ctx.createPanner();
  const gain = ctx.createGain();

  // HRTF gives true 3D spatial perception (not just stereo pan)
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 50;
  panner.rolloffFactor = 1;

  source.buffer = buffer;
  source.loop = true;

  // Signal chain: source → panner (3D) → gain (master volume) → output
  source.connect(panner);
  panner.connect(gain);
  gain.connect(ctx.destination);

  gain.gain.value = 0.8;
  source.start();
  activeNodes = { source, panner, gain };
}

/**
 * Play a short one-shot sound (arrival chime).
 * Uses a synthesised tone if no buffer is provided.
 *
 * @param {AudioBuffer} [buffer] - optional custom buffer
 */
function playArrivalChime(buffer) {
  const ctx = getAudioContext();
  const chime = buffer || _getArrivalChimeBuffer(ctx);
  if (!chime) return;

  const source = ctx.createBufferSource();
  source.buffer = chime;
  source.connect(ctx.destination);
  source.start();
}

/**
 * Convert bearing (degrees from north) and distance (meters) to a
 * 3D position in Web Audio coordinate space.
 *
 * Coordinate system: X = east, Y = up, Z = south
 * So bearing 0° (north) → (0, 0, -d), bearing 90° (east) → (d, 0, 0)
 *
 * Distance is clamped to 1–50m for a smooth inverse-distance volume curve.
 */
function bearingToPosition(bearingDegrees, distanceMeters) {
  const rad = (bearingDegrees * Math.PI) / 180;
  const d = Math.max(1, Math.min(distanceMeters, 50));
  return {
    x: Math.sin(rad) * d,
    y: 0,
    z: -Math.cos(rad) * d,
  };
}

/**
 * Update the listener's forward-facing direction from compass heading.
 * Called on each audio update so HRTF rotates correctly with the user.
 */
function updateListenerOrientation(headingDegrees) {
  const ctx = getAudioContext();
  const rad = (headingDegrees * Math.PI) / 180;

  // Forward vector: which way the listener is facing
  ctx.listener.forwardX.value = Math.sin(rad);
  ctx.listener.forwardY.value = 0;
  ctx.listener.forwardZ.value = -Math.cos(rad);

  // Up vector: always pointing straight up
  ctx.listener.upX.value = 0;
  ctx.listener.upY.value = 1;
  ctx.listener.upZ.value = 0;
}

/**
 * Reposition the active audio cue based on new GPS data.
 * Called from the game loop on each location update.
 *
 * @param {number} bearingDegrees - bearing from user to current waypoint
 * @param {number} distanceMeters - distance from user to current waypoint
 */
function updateAudioPosition(bearingDegrees, distanceMeters) {
  if (!activeNodes) return;

  const pos = bearingToPosition(bearingDegrees, distanceMeters);
  activeNodes.panner.positionX.value = pos.x;
  activeNodes.panner.positionY.value = pos.y;
  activeNodes.panner.positionZ.value = pos.z;

  // Heading comes from global state, updated by compass listener in geo.js
  updateListenerOrientation(state.userHeading);
}

/**
 * Stop any currently playing spatial audio.
 */
function stopAudio() {
  if (activeNodes) {
    try { activeNodes.source.stop(); } catch (_) { /* already stopped */ }
    activeNodes = null;
  }
}

/**
 * Full cleanup: stop audio, close context, clear buffer cache.
 * Called when leaving the game page.
 */
function destroyAudio() {
  stopAudio();
  // Don't close the context — it can't be reopened. Just let it idle.
  Object.keys(bufferCache).forEach((k) => delete bufferCache[k]);
}

// ── Private helpers ───────────────────────────────────────────────────────

/**
 * Generate a simple two-tone arrival chime programmatically.
 * Avoids needing a separate audio file for the chime sound.
 */
function _getArrivalChimeBuffer(ctx) {
  if (_arrivalChimeBuffer) return _arrivalChimeBuffer;

  const sampleRate = ctx.sampleRate;
  const duration = 0.6; // seconds
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);

  // Two-tone ascending chime: C5 (523 Hz) then E5 (659 Hz)
  const freqs = [523, 659];
  const halfLen = Math.floor(length / 2);

  for (let i = 0; i < length; i++) {
    const freq = i < halfLen ? freqs[0] : freqs[1];
    const t = i / sampleRate;
    // Sine wave with exponential decay envelope
    const envelope = Math.exp(-3 * (i % halfLen) / halfLen);
    channel[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
  }

  _arrivalChimeBuffer = buffer;
  return buffer;
}
