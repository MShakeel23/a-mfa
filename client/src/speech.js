// Voice engine: speaks the dynamic liveness prompt (SpeechSynthesis) and
// listens for the user's response (SpeechRecognition).
//
// SpeechRecognition requires Chrome/Edge (webkitSpeechRecognition). On
// unsupported browsers the UI offers a typed fallback for accessibility.

const SR =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const speechRecognitionSupported = Boolean(SR);
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

// Wraps a continuous recognition session. Calls onInterim with live text and
// onFinal as final segments arrive. Returns null when unsupported.
export function createRecognizer({ onInterim, onFinal, onError, onEnd }) {
  if (!speechRecognitionSupported) return null;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) onFinal?.(result[0].transcript);
      else interim += result[0].transcript;
    }
    if (interim) onInterim?.(interim);
  };
  rec.onerror = (e) => onError?.(e.error || 'speech error');
  rec.onend = () => onEnd?.();
  return rec;
}
