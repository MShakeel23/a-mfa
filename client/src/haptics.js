// Haptic risk-signature engine.
//
// RESEARCH COMPONENT: the HTML5 Vibration API (navigator.vibrate) currently
// only works on Android Chrome/Edge/Firefox. iOS Safari and all desktop
// browsers silently ignore it, so we degrade to a visual pulse fallback.
// This mirrors the paper's goal: a physical, volume-independent risk cue.

export const hapticsSupported =
  typeof navigator !== 'undefined' && 'vibrate' in navigator;

// Returns 'vibrated' | 'fallback' so the UI can show which channel fired.
export function fireRiskPattern(pattern) {
  if (hapticsSupported) {
    navigator.vibrate(pattern);
    return 'vibrated';
  }
  return 'fallback';
}

export function stopHaptics() {
  if (hapticsSupported) navigator.vibrate(0);
}
