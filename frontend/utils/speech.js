// speech.js — Web Speech API wrapper for TTS output and voice input.
// Uses the browser's built-in SpeechSynthesis (no cost, no external service).
// Voice input uses SpeechRecognition for microphone-to-text transcription.

// ── Text to Speech ────────────────────────────────────────────────────────

// Cache the available voices list (populated asynchronously by the browser)
let _voices = [];

// Some browsers fire onvoiceschanged after page load; others have voices ready immediately
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = () => {
    _voices = speechSynthesis.getVoices();
  };
  // Attempt immediate load (works in some browsers)
  _voices = speechSynthesis.getVoices();
}

/**
 * Speak text aloud using the browser's TTS engine.
 * Cancels any in-progress speech before starting new utterance.
 * No-ops gracefully if SpeechSynthesis is unavailable.
 *
 * @param {string} text    - text to speak
 * @param {object} options - { rate, pitch } overrides
 * @returns {Promise<void>} resolves when speech ends (or immediately on error)
 */
function speak(text, options = {}) {
  return new Promise((resolve) => {
    if (!text || typeof speechSynthesis === 'undefined') {
      resolve();
      return;
    }

    // Cancel any in-progress utterance to avoid queue pile-up
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate ?? 0.95;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.lang = 'en-US';

    // Pick the clearest available English voice
    if (_voices.length === 0) _voices = speechSynthesis.getVoices();
    utterance.voice =
      _voices.find((v) => v.lang === 'en-US' && v.name.includes('Google')) ??
      _voices.find((v) => v.lang.startsWith('en') && v.name.includes('Google')) ??
      _voices.find((v) => v.lang === 'en-US') ??
      _voices[0] ?? null;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve(); // resolve even on error — don't block callers

    speechSynthesis.speak(utterance);

    // Chrome bug: long utterances can stall. Resume after 10s silence as a workaround.
    const watchdog = setInterval(() => {
      if (!speechSynthesis.speaking) {
        clearInterval(watchdog);
        return;
      }
      speechSynthesis.pause();
      speechSynthesis.resume();
    }, 10000);

    utterance.onend = () => { clearInterval(watchdog); resolve(); };
    utterance.onerror = () => { clearInterval(watchdog); resolve(); };
  });
}

/**
 * Stop all in-progress and queued speech.
 */
function stopSpeaking() {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
}

/**
 * Check whether TTS is supported in this browser.
 * @returns {boolean}
 */
function isTtsSupported() {
  return typeof speechSynthesis !== 'undefined';
}

// ── Voice Input (Speech Recognition) ─────────────────────────────────────

/**
 * Start listening for voice input via the microphone.
 * Returns the SpeechRecognition instance so the caller can stop it.
 *
 * @param {Function} onResult  - called with the transcribed string
 * @param {Function} onError   - called with an Error on failure
 * @param {object}   [options] - { continuous, lang }
 * @returns {SpeechRecognition|null} the recognition instance, or null if unsupported
 */
function startListening(onResult, onError, options = {}) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    onError(new Error('Voice input is not supported in this browser.'));
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = options.lang || 'en-US';
  recognition.interimResults = false;
  recognition.continuous = options.continuous || false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript;
    if (transcript) onResult(transcript.trim());
  };

  recognition.onerror = (event) => {
    // 'no-speech' and 'aborted' are non-fatal — the user just didn't say anything
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    onError(new Error(`Voice recognition error: ${event.error}`));
  };

  recognition.onend = () => {
    // If in continuous mode, restart automatically (unless caller stopped it)
    if (options.continuous && recognition._keepAlive) {
      try { recognition.start(); } catch (_) { /* already started */ }
    }
  };

  recognition._keepAlive = options.continuous || false;

  try {
    recognition.start();
  } catch (err) {
    onError(new Error('Could not start voice recognition. Is the microphone available?'));
    return null;
  }

  return recognition;
}

/**
 * Stop an active speech recognition session.
 * @param {SpeechRecognition} recognition
 */
function stopListening(recognition) {
  if (!recognition) return;
  recognition._keepAlive = false;
  try { recognition.stop(); } catch (_) { /* already stopped */ }
}

/**
 * Check whether voice input is supported in this browser.
 * @returns {boolean}
 */
function isVoiceInputSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

