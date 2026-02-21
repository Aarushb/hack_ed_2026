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
      <button class="btn btn-icon btn-secondary" aria-label="Take photo" title="Camera">📷</button>
      ${isVoiceInputSupported() ? '<button class="btn btn-icon btn-secondary" aria-label="Voice input" title="Speak">🎤</button>' : ''}
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

  cameraBtn.addEventListener('click', _handleCameraCapture);
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

// ── Camera capture ────────────────────────────────────────────────────────

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
    buttons[1].setAttribute('aria-label', active ? 'Stop listening' : 'Voice input');
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
  if (_liveWs) _disconnectLiveSession();

  const wsUrl = API_BASE.replace(/^http/, 'ws') + `/live/session?session_id=${sessionId}`;

  try {
    _liveWs = new WebSocket(wsUrl);
  } catch (err) {
    console.warn('[assistant] WebSocket connection failed:', err.message);
    renderAssistantMessage('system', 'Live session unavailable. Using text mode.');
    return;
  }

  _liveWs.onopen = () => {
    renderAssistantMessage('system', '🔴 Live session connected.');
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
    _liveWs = null;
    if (!event.wasClean) {
      renderAssistantMessage('system', 'Live session disconnected unexpectedly.');
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
      // Audio playback would be handled by a dedicated audio decoder
      // For hackathon: log and skip — TTS fallback handles voice output
      break;
    case 'tool_call':
      renderAssistantMessage('system', `🔧 Using ${msg.name}…`);
      break;
    case 'tool_result':
      renderAssistantMessage('system', `✅ ${msg.name} complete.`);
      break;
    case 'moderation_warning':
      renderAssistantMessage('system', `⚠️ ${msg.message}`);
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
  if (_liveWs) {
    _liveWs.onclose = null; // prevent reconnect logic on intentional close
    _liveWs.close();
    _liveWs = null;
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
