# A-MFA — Synchronous Multi-Modal Authentication

Prototype of the A-MFA security gateway: replaces OTPs/CAPTCHAs with a single
**simultaneous** verification step combining three channels:

| Channel | Implementation | Defends against |
| --- | --- | --- |
| Biometric possession + presence | WebAuthn (`navigator.credentials`) via SimpleWebAuthn | phishing, credential theft |
| Haptic risk signature | HTML5 Vibration API (`navigator.vibrate`) | blind signing — works even if the device is muted |
| Dynamic phrase + **voiceprint** | `MediaRecorder` audio → faster-whisper STT + ECAPA-TDNN speaker embedding | replay attacks, coercion, impersonation |

The spoken phrase is **random per session and bound to the server challenge**,
so a recorded approval can never be replayed. The haptic pattern encodes
transaction risk (e.g. 3 heavy pulses = financial transfer ≥ $500), so the user
physically feels the risk level before the key is released.

## Stack

- **Client** — React 18 + Vite, `@simplewebauthn/browser`, `MediaRecorder`
  (real audio capture → 16kHz WAV), `speechSynthesis` prompt, Vibration API
- **Server** — Node + Express, `@simplewebauthn/server` (challenge generation,
  assertion verification, phrase + voiceprint matching, audit log)
- **Voice AI service** — Python + Flask on :8000:
  - `faster-whisper` (`base.en`, int8) — server-side speech-to-text
  - `speechbrain` ECAPA-TDNN (`spkrec-ecapa-voxceleb`) — 192-dim speaker
    embedding; server compares cosine similarity vs the enrolled voiceprint
- **Storage** — flat `server/data/db.json` (gitignored)

## Run it

```bash
# one-time: JS deps
npm install

# one-time: python voice service (use Python 3.11-3.13; 3.14 lacks torch wheels)
cd voice
python -m venv .venv
.venv/Scripts/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/pip install -r requirements.txt
cd ..

# every run: all three processes (server :3001, vite :5173, voice :8000)
npm run dev
```

Open <http://localhost:5173> in **Chrome/Edge**, register a passkey
(Windows Hello / Touch ID / Android biometrics), speak the enrollment phrase
to create your voiceprint, then initiate a transfer.

Production-style run:

```bash
npm run build && npm start   # server serves the built client on :3001
```

## Demo flow

1. Enter a username → **Register passkey** (WebAuthn platform authenticator).
2. Set amount ≥ $500 + payee → **Authorize with A-MFA**.
3. The screen dims and, simultaneously:
   - the haptic pattern fires (or a visual pulse fallback),
   - the voice engine speaks the one-time phrase,
   - the mic opens **and** the biometric prompt appears.
4. Speak the phrase **while** holding the sensor. The server verifies the
   assertion signature *and* the transcript against the session-bound phrase.

## Research notes — Vibration API

The haptic channel is the experimental/"research" part of this prototype:

- `navigator.vibrate()` is only honoured on **Android** (Chrome/Edge/Firefox).
- **iOS Safari and all desktop browsers silently ignore it.** We feature-detect
  it and degrade to a visual pulse (see `client/src/haptics.js`).
- To demo real haptics, serve the app over **HTTPS** (WebAuthn requires a
  secure context anyway) and open it on an Android phone — e.g. deploy the
  server and client, or tunnel localhost with `ngrok http 3001` /
  `cloudflared`. Then set env vars before starting:
  `RP_ID=your.domain ORIGIN=https://your.domain`.

Speech is captured with `MediaRecorder` (works in every modern browser) and
transcribed server-side — no browser STT dependency. If the mic is denied, a
typed-phrase fallback doubles as the accessibility path for deaf/mute users
(only honoured for accounts without an enrolled voiceprint).

## Testing on your phone (same WiFi)

Opening `http://<laptop-IP>:5173` on the phone loads the page, but **WebAuthn
will not fire** — biometrics require HTTPS (or localhost), and an IP address
can't be a WebAuthn relying-party domain. Use a Cloudflare quick tunnel:

```bash
# 1. one-time install
winget install Cloudflare.cloudflared

# 2. terminal 1 - start the tunnel first, copy the https URL it prints
cloudflared tunnel --url http://localhost:5173
#    -> e.g. https://abc-def-ghi.trycloudflare.com

# 3. terminal 2 - start the app, telling the server the tunnel's domain
cd a-mfa
#   bash / Git Bash:
RP_ID=abc-def-ghi.trycloudflare.com ORIGIN=https://abc-def-ghi.trycloudflare.com npm run dev
#   PowerShell:
$env:RP_ID="abc-def-ghi.trycloudflare.com"; $env:ORIGIN="https://abc-def-ghi.trycloudflare.com"; npm run dev

# 4. on the phone (Android Chrome): open https://abc-def-ghi.trycloudflare.com
#    grant mic permission, register a passkey (fingerprint / screen lock),
#    then authorize a transfer - the vibration pattern fires for real.
```

Flow: phone → tunnel → laptop Vite (:5173) → `/api` proxied → server (:3001).
`RP_ID` must equal the tunnel hostname so the passkey is bound to that origin.

iPhone note: iOS Safari ignores `navigator.vibrate()` and lacks
`SpeechRecognition`, so use an **Android** phone for the full demo; on iOS the
haptic channel falls back to the visual pulse.

## Threat model mapping (from the design doc)

- **Replay** → single-use session + random phrase per attempt; session is
  deleted on first verify.
- **Blind signing** → risk-encoded haptic pulse fires at dim-screen time.
- **Eavesdropping** → no static secret is ever spoken; only a random phrase.

## Voice channel: liveness + speaker identity

The phrase audio is recorded client-side (`MediaRecorder` → 16kHz WAV) and
analysed server-side in a single pass:

1. **faster-whisper** transcribes it → checked against the session-bound phrase
   (anti-replay / intent).
2. **ECAPA-TDNN** produces a speaker embedding → cosine similarity vs the
   voiceprint enrolled at registration (identity). Accounts with an enrolled
   voiceprint *require* a voice sample — the typed-phrase fallback only works
   for accounts without one.

`VOICE_THRESHOLD` env var tunes the accept threshold (default `0.25`; raise
toward `0.35` for stricter matching). Every attempt's transcript, score and
per-channel pass/fail land in `server/data/db.json`'s `auditLog`.
