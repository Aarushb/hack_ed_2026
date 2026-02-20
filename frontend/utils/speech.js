// speech.js - Web Speech API wrapper: TTS output + voice input
// See docs/frontend-design.md, section: Voice Narration

// ── Text to Speech ────────────────────────────────────────────────────────────

let voices = [];
speechSynthesis.onvoiceschanged = () => {
  voices = speechSynthesis.getVoices();
};

function speak(text, options = {}) {
  if (!text) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options.rate ?? 0.95;
  utterance.pitch = options.pitch ?? 1.0;
  utterance.lang = "en-US";
  // prefer a clear English voice if available
  utterance.voice =
    voices.find((v) => v.lang === "en-US" && v.name.includes("Google")) ??
    voices.find((v) => v.lang === "en-US") ??
    voices[0] ??
    null;
  speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  speechSynthesis.cancel();
}

// ── Voice Input (optional / nice to have) ────────────────────────────────────

function startListening(onResult, onError) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError(new Error("SpeechRecognition not supported in this browser"));
    return null;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    onResult(transcript);
  };
  recognition.onerror = (e) => onError(e);
  recognition.start();
  return recognition;
}
