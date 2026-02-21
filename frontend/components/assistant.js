// assistant.js — AI assistant panel component.
// Collapsible slide-up panel on the game screen with text input,
// conversation history, camera capture, voice input, and moderation
// warning display. Supports REST (Basic/Standard) and WebSocket (Premium).

// ── Module state ──────────────────────────────────────────────────────────

let _panelEl = null;       // root panel DOM element
let _overlayEl = null;     // backdrop overlay
let _messagesEl = null;    // scrollable message container
let _inputEl = null;       // text input element
let _isOpen = false;
let _isSending = false;    // prevents double-submit while waiting for response
let _recognition = null;   // active SpeechRecognition instance (voice input)
let _liveWs = null;        // WebSocket for Premium live session

// Live streaming (Premium)
let _reconnectTimer = null;
let _reconnectAttempt = 0;
let _lastLiveSessionId = null;

// Mic capture (PCM)
let _micStream = null;
let _micCtx = null;
let _micSource = null;
let _micProcessor = null; // ScriptProcessorNode fallback
let _micWorkletNode = null;
let _micActive = false;
let _lastSilenceSentAt = 0;

// Live audio playback (PCM)
let _playbackTime = 0;
let _receivedLiveAudio = false;

// Camera streaming (JPEG frames)
let _camStream = null;
let _camVideoEl = null;
let _camCanvas = null;
let _camTimer = null;
let _cameraActive = false;

const LIVE_AUDIO_SAMPLE_RATE = 16000;
const LIVE_AUDIO_CHUNK_MS = 80; // target chunk size (worklet may produce smaller)
const LIVE_VIDEO_FPS = 2;
const LIVE_VIDEO_MAX_WIDTH = 360;
const LIVE_WS_MAX_BUFFERED_BYTES = 768 * 1024; // throttle when WS buffer is large

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Create and mount the assistant panel + overlay into the given parent.
 * Call once when the game page renders.
 *
 * @param {HTMLElement} parent - element to append the panel and overlay into
 */
function mountAssistant(parent) {
  // Overlay (click to close)
  _overlayEl = document.createElement('div');
  _overlayEl.className = 'assistant-overlay';
  _overlayEl.addEventListener('click', closeAssistant);
  parent.appendChild(_overlayEl);

  // Panel
  _panelEl = document.createElement('div');
  _panelEl.className = 'assistant-panel';
  _panelEl.setAttribute('role', 'dialog');
  _panelEl.setAttribute('aria-label', 'AI Assistant');
  _panelEl.innerHTML = `
    <div class="assistant-header">
      <h3>🧭 NorthStar</h3>
      <button class="btn btn-icon btn-secondary" aria-label="Close assistant">✕</button>
    </div>
    <div class="assistant-messages" aria-live="polite" aria-label="Conversation"></div>
    <div class="assistant-input-bar">
      <input type="text" placeholder="Ask NorthStar anything…"
             aria-label="Message input" autocomplete="off" />
      <button class="btn btn-icon btn-secondary" aria-label="Camera" title="Camera">📷</button>
      ${isVoiceInputSupported() ? '<button class="btn btn-icon btn-secondary" aria-label="Voice" title="Voice">🎤</button>' : ''}
      <button class="btn btn-icon btn-primary" aria-label="Send message" title="Send">➤</button>
    </div>
  `;

  // Cache DOM references
  _messagesEl = _panelEl.querySelector('.assistant-messages');
  _inputEl = _panelEl.querySelector('.assistant-input-bar input');

  // Wire up header close button
  _panelEl.querySelector('.assistant-header button').addEventListener('click', closeAssistant);

  // Wire up input bar buttons
  const buttons = _panelEl.querySelectorAll('.assistant-input-bar button');
  const cameraBtn = buttons[0]; // 📷
  const sendBtn = buttons[buttons.length - 1]; // ➤ (always last)
  const micBtn = buttons.length === 3 ? buttons[1] : null; // 🎤 (only if voice supported)

  cameraBtn.addEventListener('click', _handleCameraToggle);
  sendBtn.addEventListener('click', _handleSend);
  if (micBtn) micBtn.addEventListener('click', _handleVoiceToggle);

  // Send on Enter key
  _inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _handleSend();
    }
  });

  parent.appendChild(_panelEl);

  // If we're on Premium and a live WS is already connected, encourage voice mode.
  if (state?.tier === 'premium') {
    renderAssistantMessage(
      'system',
      'Voice-to-voice is available. Tap 🎤 to start speaking.'
    );
  }
}

/**
 * Open the assistant panel with slide-up animation.
 */
function openAssistant() {
  if (!_panelEl) return;
  _isOpen = true;
  _panelEl.classList.add('open');
  _overlayEl.classList.add('open');
  _inputEl.focus();
}

/**
 * Close the assistant panel.
 */
function closeAssistant() {
  if (!_panelEl) return;
  _isOpen = false;
  _panelEl.classList.remove('open');
  _overlayEl.classList.remove('open');
  _stopVoiceInput();
  _stopLiveMic();
  _stopLiveCamera();
}

/**
 * Toggle the panel open/closed.
 */
function toggleAssistant() {
  _isOpen ? closeAssistant() : openAssistant();
}

/**
 * Remove the assistant from the DOM entirely. Call when leaving game page.
 */
function unmountAssistant() {
  closeAssistant();
  _stopVoiceInput();
  _stopLiveMic();
  _stopLiveCamera();
  _disconnectLiveSession();
  if (_panelEl) { _panelEl.remove(); _panelEl = null; }
  if (_overlayEl) { _overlayEl.remove(); _overlayEl = null; }
  _messagesEl = null;
  _inputEl = null;
}

// ── Message rendering ─────────────────────────────────────────────────────

/**
 * Add a message bubble to the conversation panel.
 *
 * @param {'user'|'assistant'|'system'} role
 * @param {string} text
 */
function renderAssistantMessage(role, text) {
  if (!_messagesEl || !text) return;

  const msg = document.createElement('div');
  msg.className = `assistant-msg ${role}`;
  msg.textContent = text;
  _messagesEl.appendChild(msg);

  // Auto-scroll to latest message
  _messagesEl.scrollTop = _messagesEl.scrollHeight;
}

/**
 * Show a moderation warning banner inside the assistant panel.
 *
 * @param {object} moderation - { warning, camera_disabled, strikes }
 */
function _showModerationWarning(moderation) {
  if (!moderation || !moderation.warning) return;
  renderAssistantMessage('system', `⚠️ ${moderation.warning}`);
}

// ── Sending messages (REST) ───────────────────────────────────────────────

async function _handleSend() {
  if (_isSending || !_inputEl) return;
  const text = _inputEl.value.trim();
  if (!text) return;

  _inputEl.value = '';
  renderAssistantMessage('user', text);
  await _sendToAssistant(text, null);
}

/**
 * Core send logic. Handles the needs_camera loop and moderation responses.
 *
 * @param {string}      text
 * @param {string|null} imageBase64
 */
async function _sendToAssistant(text, imageBase64) {
  if (!state.sessionId) {
    renderAssistantMessage('system', 'No active session. Start navigation first.');
    return;
  }

  // Premium: prefer live WebSocket for lowest latency voice-to-voice.
  if (state.tier === 'premium' && !imageBase64) {
    const sent = sendLiveText(text);
    if (sent) return;
    // If WS isn't available, fall through to REST assistant.
  }

  _isSending = true;
  _setInputEnabled(false);

  try {
    const response = await apiAssistantMessage(state.sessionId, text, imageBase64);

    // Handle moderation warnings
    if (response.moderation) {
      _showModerationWarning(response.moderation);
    }

    // If the AI wants a camera image, capture one and re-send
    if (response.needs_camera) {
      renderAssistantMessage('system', '📷 NorthStar needs a photo to help. Opening camera…');
      try {
        const photo = await captureFromCamera();
        if (photo) {
          await _sendToAssistant(text, photo);
          return; // recursive call handles the rest
        }
        renderAssistantMessage('system', 'Camera cancelled. NorthStar will answer without the photo.');
      } catch (err) {
        renderAssistantMessage('system', `Camera error: ${err.message}`);
      }
    }

    // Render the AI's reply
    if (response.reply) {
      renderAssistantMessage('assistant', response.reply);
      speak(response.reply);
    }
  } catch (err) {
    // Map specific API errors to helpful messages
    if (err.status === 413) {
      renderAssistantMessage('system', 'Photo too large — try a smaller image.');
    } else if (err.status === 429) {
      renderAssistantMessage('system', 'Rate limited. Wait a moment and try again.');
    } else {
      renderAssistantMessage('system', `Error: ${err.message}`);
    }
  } finally {
    _isSending = false;
    _setInputEnabled(true);
  }
}

// ── Camera (Basic/Standard photo capture, Premium live toggle) ─────────────

function _handleCameraToggle() {
  if (state?.tier === 'premium') {
    if (_cameraActive) {
      _stopLiveCamera();
    } else {
      _startLiveCamera();
    }
    return;
  }

  // Non-premium tiers: photo capture for REST assistant.
  _handleCameraCapture();
}

async function _handleCameraCapture() {
  if (_isSending) return;

  try {
    const imageBase64 = await captureFromCamera();
    if (!imageBase64) return; // user cancelled

    const text = _inputEl.value.trim() || 'What do you see in this photo?';
    _inputEl.value = '';
    renderAssistantMessage('user', `📷 ${text}`);
    await _sendToAssistant(text, imageBase64);
  } catch (err) {
    renderAssistantMessage('system', `Camera error: ${err.message}`);
  }
}

/**
 * Capture a photo from the device camera.
 * On mobile: uses <input capture="environment"> (works with screen readers).
 * On desktop: falls back to getUserMedia video snapshot.
 *
 * @returns {Promise<string|null>} base64-encoded image data, or null if cancelled
 */
function captureFromCamera() {
  // Prefer the file input method — works on mobile with accessibility tools
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';

    let resolved = false;

    input.onchange = (e) => {
      resolved = true;
      const file = e.target.files?.[0];
      if (!file) { resolve(null); return; }

      // Reject files over 10MB before reading
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error('Image exceeds 10MB. Please use a smaller photo.'));
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        // Extract base64 payload after the data URI prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64 || null);
      };
      reader.onerror = () => reject(new Error('Could not read the image file.'));
      reader.readAsDataURL(file);
    };

    // Handle cancel (user closes file picker without selecting)
    // The input won't fire onchange, so we detect via focus return
    const onFocus = () => {
      setTimeout(() => {
        if (!resolved) resolve(null);
        window.removeEventListener('focus', onFocus);
      }, 500);
    };
    window.addEventListener('focus', onFocus);

    input.click();
  });
}

// ── Voice input ───────────────────────────────────────────────────────────

function _handleVoiceToggle() {
  // Premium: mic streaming to live WebSocket (true voice-to-voice).
  if (state?.tier === 'premium') {
    _micActive ? _stopLiveMic() : _startLiveMic();
    return;
  }

  // Standard/Basic: Web Speech API transcription → text.
  if (_recognition) {
    _stopVoiceInput();
  } else {
    _startVoiceInput();
  }
}

function _startVoiceInput() {
  _recognition = startListening(
    (transcript) => {
      if (_inputEl) _inputEl.value = transcript;
      _stopVoiceInput();
      _handleSend();
    },
    (err) => {
      console.warn('[assistant] Voice input error:', err.message);
      renderAssistantMessage('system', err.message);
      _stopVoiceInput();
    },
  );

  // Visual indicator that mic is active
  _updateMicButton(true);
}

function _stopVoiceInput() {
  if (_recognition) {
    stopListening(_recognition);
    _recognition = null;
  }
  _updateMicButton(false);
}

function _updateMicButton(active) {
  if (!_panelEl) return;
  const buttons = _panelEl.querySelectorAll('.assistant-input-bar button');
  // Mic button is second if voice is supported (camera=0, mic=1, send=2)
  if (buttons.length === 3) {
    buttons[1].textContent = active ? '⏹️' : '🎤';
    buttons[1].setAttribute(
      'aria-label',
      state?.tier === 'premium'
        ? (active ? 'Stop microphone' : 'Start microphone')
        : (active ? 'Stop listening' : 'Voice input')
    );
  }
}

// ── WebSocket live session (Premium tier) ─────────────────────────────────

/**
 * Connect to the backend's WebSocket live session for real-time
 * voice-to-voice and live video communication.
 * Only used for Premium tier sessions.
 *
 * @param {string} sessionId
 */
function connectLiveSession(sessionId) {
  if (!sessionId) return;
  _lastLiveSessionId = sessionId;

  if (_liveWs) _disconnectLiveSession();
  _clearReconnect();

  const wsUrl = API_BASE.replace(/^http/, 'ws') + `/live/session?session_id=${encodeURIComponent(sessionId)}`;

  try {
    _liveWs = new WebSocket(wsUrl);
  } catch (err) {
    console.warn('[assistant] WebSocket connection failed:', err.message);
    renderAssistantMessage('system', 'Live session unavailable. Using text mode.');
    return;
  }

  _liveWs.onopen = () => {
    // Server will emit a `connection_status` message; avoid duplicate UI.
    _reconnectAttempt = 0;
    // If user had active streams before reconnect, resume them.
    if (_cameraActive) {
      try { _liveWs.send(JSON.stringify({ type: 'camera_on' })); } catch (_) {}
    }
  };

  _liveWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      _handleLiveMessage(msg);
    } catch (err) {
      console.warn('[assistant] Invalid WebSocket message:', err.message);
    }
  };

  _liveWs.onerror = () => {
    renderAssistantMessage('system', 'Live session error. Falling back to text mode.');
  };

  _liveWs.onclose = (event) => {
    const wasClean = event.wasClean;
    _liveWs = null;
    if (!wasClean) {
      renderAssistantMessage('system', 'Live session disconnected. Reconnecting…');
      _scheduleReconnect();
    }
  };
}

/**
 * Handle an incoming WebSocket message from the live session.
 */
function _handleLiveMessage(msg) {
  switch (msg.type) {
    case 'transcript':
      renderAssistantMessage(msg.role || 'assistant', msg.text);
      break;
    case 'audio':
      _receivedLiveAudio = true;
      _playLivePcmAudio(msg.data, msg.mime_type);
      break;
    case 'tool_call':
      renderAssistantMessage('system', `🔧 Using ${msg.name}…`);
      break;
    case 'tool_result':
      renderAssistantMessage('system', `✅ ${msg.name} complete.`);
      break;
    case 'moderation_warning':
      renderAssistantMessage('system', `⚠️ ${msg.message}`);
      // If moderation disables camera, stop streaming immediately.
      if ((msg.message || '').toLowerCase().includes('camera') && (msg.message || '').toLowerCase().includes('disabled')) {
        _stopLiveCamera();
      }
      break;
    case 'error':
      renderAssistantMessage('system', `Error: ${msg.message}`);
      break;
    case 'connection_status':
      if (msg.status === 'connected') {
        renderAssistantMessage('system', '🔴 Live session connected.');
      } else if (msg.status === 'reconnecting') {
        renderAssistantMessage('system', 'Reconnecting live session…');
      } else if (msg.status) {
        renderAssistantMessage('system', `Live session status: ${msg.status}`);
      }
      break;
    case 'turn_complete':
      // No UI needed; included for protocol completeness.
      break;
    default:
      // Unknown message type — ignore gracefully
      break;
  }

  // If the assistant is asking for visual context, hint the user to enable camera.
  if (msg.type === 'transcript' && (msg.role || 'assistant') === 'assistant') {
    const t = (msg.text || '').toLowerCase();
    if (
      state?.tier === 'premium' &&
      !_cameraActive &&
      (t.includes('turn on your camera') || t.includes('enable your camera') || t.includes('camera on') || t.includes('show me'))
    ) {
      renderAssistantMessage('system', 'If you can, tap 📷 to enable live camera.');
    }
  }
}

/**
 * Send a text message through the live WebSocket.
 */
function sendLiveText(text) {
  if (!_liveWs || _liveWs.readyState !== WebSocket.OPEN) return false;
  _liveWs.send(JSON.stringify({ type: 'text', message: text }));
  return true;
}

/**
 * Send a location update through the live WebSocket.
 */
function sendLiveLocation(lat, lng) {
  if (!_liveWs || _liveWs.readyState !== WebSocket.OPEN) return;
  _liveWs.send(JSON.stringify({ type: 'location_update', lat, lng }));
}

/**
 * Disconnect the live WebSocket session.
 */
function _disconnectLiveSession() {
  _clearReconnect();
  if (_liveWs) {
    _liveWs.onclose = null; // prevent reconnect logic on intentional close
    _liveWs.close();
    _liveWs = null;
  }
}

function _clearReconnect() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

function _scheduleReconnect() {
  if (!_lastLiveSessionId) return;
  if (_reconnectTimer) return;

  const base = 500;
  const max = 10000;
  const delay = Math.min(max, base * (2 ** Math.min(_reconnectAttempt, 5)));
  _reconnectAttempt += 1;

  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    connectLiveSession(_lastLiveSessionId);
  }, delay);
}

// ── Premium: microphone PCM streaming ─────────────────────────────────────

async function _startLiveMic() {
  if (_micActive) return;
  if (!_liveWs || _liveWs.readyState !== WebSocket.OPEN) {
    renderAssistantMessage('system', 'Live session not connected yet.');
    return;
  }

  try {
    _micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
  } catch (err) {
    renderAssistantMessage('system', 'Microphone permission denied or unavailable.');
    return;
  }

  _micActive = true;
  _updateMicButton(true);
  renderAssistantMessage('system', '🎙️ Microphone on. Speak normally.');

  try {
    _micCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: LIVE_AUDIO_SAMPLE_RATE });
  } catch (_) {
    _micCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  try {
    if (_micCtx.state === 'suspended') await _micCtx.resume();
  } catch (_) {}

  _micSource = _micCtx.createMediaStreamSource(_micStream);

  // Prefer AudioWorklet for lower latency.
  if (_micCtx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      const workletCode = `
        class PcmCaptureProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this._acc = [];
            this._accLen = 0;
            this._target = Math.max(128, Math.floor(sampleRate * (${LIVE_AUDIO_CHUNK_MS} / 1000)));
          }
          process(inputs) {
            const input = inputs[0];
            if (!input || !input[0]) return true;
            const ch = input[0];
            // Copy to avoid referencing shared buffer
            const copy = new Float32Array(ch.length);
            copy.set(ch);
            this._acc.push(copy);
            this._accLen += copy.length;
            if (this._accLen >= this._target) {
              const out = new Float32Array(this._accLen);
              let o = 0;
              for (const b of this._acc) { out.set(b, o); o += b.length; }
              this._acc = [];
              this._accLen = 0;
              this.port.postMessage(out, [out.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-capture', PcmCaptureProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await _micCtx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      _micWorkletNode = new AudioWorkletNode(_micCtx, 'pcm-capture');
      _micWorkletNode.port.onmessage = (e) => {
        const floats = new Float32Array(e.data);
        _sendPcmFloats(floats);
      };

      _micSource.connect(_micWorkletNode);
      // Don't route to destination to avoid echo.
      return;
    } catch (err) {
      console.warn('[assistant] AudioWorklet failed, falling back:', err.message);
    }
  }

  // Fallback: ScriptProcessorNode (deprecated but widely supported)
  const bufferSize = 2048;
  _micProcessor = _micCtx.createScriptProcessor(bufferSize, 1, 1);
  _micProcessor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    _sendPcmFloats(input);

    // Ensure silence on output to avoid feedback/echo.
    try {
      const out = event.outputBuffer.getChannelData(0);
      out.fill(0);
    } catch (_) {}
  };
  _micSource.connect(_micProcessor);
  // ScriptProcessor typically needs to be connected to run.
  // Output is forced silent above to avoid echo.
  _micProcessor.connect(_micCtx.destination);
}

function _stopLiveMic() {
  if (!_micActive) return;
  _micActive = false;
  _updateMicButton(false);
  renderAssistantMessage('system', 'Microphone off.');

  try { _micWorkletNode?.disconnect(); } catch (_) {}
  try { _micProcessor?.disconnect(); } catch (_) {}
  try { _micSource?.disconnect(); } catch (_) {}

  _micWorkletNode = null;
  _micProcessor = null;
  _micSource = null;

  if (_micStream) {
    _micStream.getTracks().forEach((t) => t.stop());
    _micStream = null;
  }

  if (_micCtx) {
    try { _micCtx.close(); } catch (_) {}
    _micCtx = null;
  }
}

function _sendPcmFloats(float32) {
  if (!_liveWs || _liveWs.readyState !== WebSocket.OPEN) return;
  if (_liveWs.bufferedAmount > LIVE_WS_MAX_BUFFERED_BYTES) return;

  // Lightweight silence gating to cut bandwidth when truly silent.
  let sumSq = 0;
  for (let i = 0; i < float32.length; i++) {
    const v = float32[i];
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, float32.length));
  const now = Date.now();
  if (rms < 0.002) {
    if (now - _lastSilenceSentAt < 500) return;
    _lastSilenceSentAt = now;
  }

  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const b64 = _arrayBufferToBase64(pcm16.buffer);
  try {
    _liveWs.send(JSON.stringify({ type: 'audio', data: b64 }));
  } catch (_) {
    // ignore send failures
  }
}

// ── Premium: camera frame streaming ───────────────────────────────────────

async function _startLiveCamera() {
  if (_cameraActive) return;
  if (!_liveWs || _liveWs.readyState !== WebSocket.OPEN) {
    renderAssistantMessage('system', 'Live session not connected yet.');
    return;
  }

  try {
    _camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    renderAssistantMessage('system', 'Camera permission denied or unavailable.');
    return;
  }

  _cameraActive = true;
  renderAssistantMessage('system', '📷 Camera on. Streaming to NorthStar.');

  try { _liveWs.send(JSON.stringify({ type: 'camera_on' })); } catch (_) {}

  _camVideoEl = document.createElement('video');
  _camVideoEl.playsInline = true;
  _camVideoEl.muted = true;
  _camVideoEl.srcObject = _camStream;

  _camCanvas = document.createElement('canvas');

  try {
    await _camVideoEl.play();
  } catch (_) {
    // Some browsers require video to be in DOM; degrade gracefully.
  }

  const intervalMs = Math.floor(1000 / LIVE_VIDEO_FPS);
  _camTimer = setInterval(() => {
    _sendVideoFrame();
  }, intervalMs);
}

function _stopLiveCamera() {
  if (!_cameraActive) return;
  _cameraActive = false;
  renderAssistantMessage('system', 'Camera off.');

  if (_camTimer) {
    clearInterval(_camTimer);
    _camTimer = null;
  }

  try { _liveWs?.send(JSON.stringify({ type: 'camera_off' })); } catch (_) {}

  if (_camStream) {
    _camStream.getTracks().forEach((t) => t.stop());
    _camStream = null;
  }
  _camVideoEl = null;
  _camCanvas = null;
}

function _sendVideoFrame() {
  if (!_cameraActive || !_camVideoEl || !_camCanvas) return;
  if (!_liveWs || _liveWs.readyState !== WebSocket.OPEN) return;
  if (_liveWs.bufferedAmount > LIVE_WS_MAX_BUFFERED_BYTES) return;

  const vw = _camVideoEl.videoWidth;
  const vh = _camVideoEl.videoHeight;
  if (!vw || !vh) return;

  const scale = Math.min(1, LIVE_VIDEO_MAX_WIDTH / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  _camCanvas.width = w;
  _camCanvas.height = h;

  const ctx = _camCanvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  ctx.drawImage(_camVideoEl, 0, 0, w, h);

  const dataUrl = _camCanvas.toDataURL('image/jpeg', 0.6);
  const base64 = dataUrl.split(',')[1];
  if (!base64) return;

  try {
    _liveWs.send(JSON.stringify({ type: 'video_frame', data: base64 }));
  } catch (_) {
    // ignore send failures
  }
}

// ── Live audio playback helpers ───────────────────────────────────────────
// Cache a single playback context in module scope (created lazily)
let _livePlaybackCtx = null;
function _getLivePlaybackCtx() {
  if (!_livePlaybackCtx) {
    _livePlaybackCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _livePlaybackCtx;
}

function _playLivePcmAudio(base64, mimeType) {
  if (!base64) return;
  if (mimeType && !String(mimeType).startsWith('audio/pcm')) return;

  let declaredRate = LIVE_AUDIO_SAMPLE_RATE;
  if (mimeType) {
    const m = String(mimeType).match(/(?:^|;)\s*rate\s*=\s*(\d+)/i);
    if (m && m[1]) {
      const r = Number(m[1]);
      if (Number.isFinite(r) && r >= 8000 && r <= 48000) declaredRate = r;
    }
  }

  const bytes = _base64ToUint8Array(base64);
  if (!bytes || bytes.length < 4) return;

  const sampleCount = Math.floor(bytes.length / 2);
  if (sampleCount <= 0) return;

  const floats = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let v = (hi << 8) | lo;
    if (v & 0x8000) v = v - 0x10000;
    floats[i] = v / 0x8000;
  }

  const ctx = _getLivePlaybackCtx();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const buffer = ctx.createBuffer(1, floats.length, declaredRate);
  buffer.copyToChannel(floats, 0);

  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  src.buffer = buffer;
  src.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  if (_playbackTime < now + 0.05) _playbackTime = now + 0.05; // jitter buffer
  src.start(_playbackTime);
  _playbackTime += buffer.duration;
}

function _arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function _base64ToUint8Array(b64) {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (_) {
    return null;
  }
}

// ── Private helpers ───────────────────────────────────────────────────────

function _setInputEnabled(enabled) {
  if (!_inputEl) return;
  _inputEl.disabled = !enabled;
  // Disable all buttons in the input bar while sending
  const buttons = _panelEl?.querySelectorAll('.assistant-input-bar button') || [];
  buttons.forEach((btn) => { btn.disabled = !enabled; });
}
