// Voice prompt engine: speaks the dynamic liveness phrase via SpeechSynthesis.
// Speech-to-text is deliberately NOT done here - real audio is captured with
// MediaRecorder (see audio.js) and transcribed server-side by faster-whisper,
// so verification can't be bypassed by a forged client-side transcript.

export const speechSynthesisSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speakPrompt(text) {
  if (!speechSynthesisSupported) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.lang = 'en-US';
  window.speechSynthesis.speak(utter);
}
