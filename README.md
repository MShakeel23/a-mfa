# A-MFA — Synchronous Multi-Modal Authentication

Prototype of the A-MFA security gateway: replaces OTPs/CAPTCHAs with a single
**simultaneous** verification step combining three channels:

| Channel | Implementation | Defends against |
| --- | --- | --- |
| Biometric possession + presence | WebAuthn (`navigator.credentials`) via SimpleWebAuthn | phishing, credential theft |
| Haptic risk signature | HTML5 Vibration API (`navigator.vibrate`) | blind signing — works even if the device is muted |
| Dynamic liveness phrase | Web Speech API (`SpeechRecognition` + `speechSynthesis`) | replay attacks, coercion |

The spoken phrase is **random per session and bound to the server challenge**,
so a recorded approval can never be replayed. The haptic pattern encodes
transaction risk (e.g. 3 heavy pulses = financial transfer ≥ $500), so the user
physically feels the risk level before the key is released.

## Stack

- **Client** — React 18 + Vite, `@simplewebauthn/browser`, Web Speech API,
  Vibration API
- **Server** — Node + Express, `@simplewebauthn/server` (challenge generation,
  assertion verification, phrase matching, audit log)
- **Storage** — flat `server/data/db.json` (gitignored)

## Run it

```bash
npm install        # installs client + server workspaces
npm run dev        # starts both: API on :3001, UI on http://localhost:5173
```

Open <http://localhost:5173> in **Chrome/Edge**, register a passkey
(Windows Hello / Touch ID / Android biometrics), then initiate a transfer.

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

`SpeechRecognition` likewise only exists in Chromium browsers — the UI offers a
typed-phrase fallback elsewhere, which doubles as the accessibility path for
deaf/mute users.

## Threat model mapping (from the design doc)

- **Replay** → single-use session + random phrase per attempt; session is
  deleted on first verify.
- **Blind signing** → risk-encoded haptic pulse fires at dim-screen time.
- **Eavesdropping** → no static secret is ever spoken; only a random phrase.
