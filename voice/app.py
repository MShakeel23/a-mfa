"""A-MFA voice intelligence service.

Two pretrained models, loaded once at startup:

  * faster-whisper (base.en, int8) - server-side speech-to-text. The backend
    confirms liveness/phrase accuracy from the actual audio, not from a
    client-supplied transcript.
  * SpeechBrain ECAPA-TDNN (spkrec-ecapa-voxceleb) - 192-dim speaker embedding.
    The backend compares it to the enrolled voiceprint with cosine similarity.

Endpoints:
  GET  /health   -> {"ok": true}
  POST /analyze  -> multipart 'audio' (wav) ->
                    {"transcript": str, "embedding": [float, ...]}
"""

import io
import os

import numpy as np
import soundfile as sf
import torch
import torchaudio
from flask import Flask, jsonify, request

WHISPER_SIZE = os.environ.get("WHISPER_SIZE", "base.en")
PORT = int(os.environ.get("VOICE_PORT", "8000"))
MODEL_DIR = os.path.join(os.path.dirname(__file__), "pretrained_models")

app = Flask(__name__)

print("[voice] loading faster-whisper", WHISPER_SIZE, flush=True)
from faster_whisper import WhisperModel

stt = WhisperModel(WHISPER_SIZE, device="cpu", compute_type="int8")

print("[voice] loading speechbrain ECAPA-TDNN", flush=True)
try:
    from speechbrain.inference.speaker import EncoderClassifier
except ImportError:  # speechbrain < 1.0
    from speechbrain.pretrained import EncoderClassifier
from speechbrain.utils.fetching import LocalStrategy

spk = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir=os.path.join(MODEL_DIR, "spkrec-ecapa-voxceleb"),
    run_opts={"device": "cpu"},
    local_strategy=LocalStrategy.COPY,  # Windows: symlink needs admin/dev-mode
)
print("[voice] models ready", flush=True)


def load_audio_16k(raw: bytes) -> np.ndarray:
    """Decode uploaded audio to mono float32 @ 16kHz."""
    data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)  # downmix
    if sr != 16000:
        t = torch.from_numpy(mono).unsqueeze(0)
        mono = torchaudio.functional.resample(t, sr, 16000).squeeze(0).numpy()
    return mono


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.post("/analyze")
def analyze():
    f = request.files.get("audio")
    if not f:
        return jsonify(error="audio file required"), 400
    try:
        audio = load_audio_16k(f.read())
    except Exception as exc:
        return jsonify(error=f"could not decode audio: {exc}"), 400

    if len(audio) < 16000 * 0.5:  # <0.5s of speech is unreliable
        return jsonify(error="audio too short - speak for a few seconds"), 400

    segments, _ = stt.transcribe(audio, language="en", vad_filter=True)
    transcript = " ".join(s.text for s in segments).strip()

    with torch.no_grad():
        wav = torch.from_numpy(audio).unsqueeze(0)
        emb = spk.encode_batch(wav).squeeze().cpu().numpy()
    emb = emb / np.linalg.norm(emb)  # unit-norm so dot product == cosine sim

    return jsonify(transcript=transcript, embedding=emb.tolist())


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT)
