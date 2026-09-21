// Real audio capture for the voice channel.
// Records the mic with MediaRecorder, then converts to 16kHz mono WAV so the
// server's faster-whisper (STT) and ECAPA-TDNN (voiceprint) models can read it.

export const micSupported =
  typeof navigator !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia);

export async function startVoiceCapture() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    // resolves with a WAV Blob at 16kHz mono
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: rec.mimeType });
          resolve(await blobToWav16k(blob));
        };
        rec.stop();
      }),
    abort: () => {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* not started */
      }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

export async function blobToWav16k(blob) {
  const raw = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await ctx.decodeAudioData(raw);
    const n = decoded.length;
    const mono = new Float32Array(n);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < n; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    // nearest-neighbour downsample to 16kHz
    const ratio = decoded.sampleRate / 16000;
    const out = new Float32Array(Math.round(n / ratio));
    for (let i = 0; i < out.length; i++) out[i] = mono[Math.floor(i * ratio)];
    return encodeWav16(out, 16000);
  } finally {
    ctx.close();
  }
}

function encodeWav16(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
