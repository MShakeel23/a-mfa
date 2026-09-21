import { useRef, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from './api.js';
import AuthModal from './AuthModal.jsx';
import { hapticsSupported } from './haptics.js';
import { micSupported, startVoiceCapture } from './audio.js';

const ENROLLMENT_PHRASE =
  'My voice is my key and I approve this enrollment';
const MAX_ATTEMPTS = 3;

export default function App() {
  const [username, setUsername] = useState('');
  const [registered, setRegistered] = useState(false);
  const [voiceEnrolled, setVoiceEnrolled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Registration is two-phase: passkey ceremony, then voiceprint recording.
  const [enrollPending, setEnrollPending] = useState(null); // {sessionId, attestation}
  const [recording, setRecording] = useState(false);
  const captureRef = useRef(null);

  const [txType, setTxType] = useState('transfer');
  const [amount, setAmount] = useState(500);
  const [payee, setPayee] = useState('');

  const [challenge, setChallenge] = useState(null);
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(1);
  const [retrying, setRetrying] = useState(false);
  const lastTxRef = useRef(null);

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { sessionId, options } = await api.registerOptions(username);
      const attestation = await startRegistration({ optionsJSON: options });
      setEnrollPending({ sessionId, attestation });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function startEnrollRecording() {
    setError('');
    try {
      captureRef.current = await startVoiceCapture();
      setRecording(true);
    } catch {
      setError('microphone unavailable - enroll without voiceprint below');
    }
  }

  async function finishEnrollment(withVoice) {
    setBusy(true);
    setError('');
    try {
      let wavBlob = null;
      if (withVoice && captureRef.current) {
        wavBlob = await captureRef.current.stop();
      }
      captureRef.current = null;
      setRecording(false);
      const r = await api.registerVerify(
        enrollPending.sessionId,
        enrollPending.attestation,
        wavBlob,
      );
      setRegistered(true);
      setVoiceEnrolled(r.voiceprint ? true : r.voiceError || false);
      setEnrollPending(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleInitiate(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    setAttempt(1);
    lastTxRef.current = { txType, amount: Number(amount), payee };
    setBusy(true);
    try {
      const ch = await api.authChallenge({ username, ...lastTxRef.current });
      setChallenge(ch);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleAuthDone(res) {
    setChallenge(null);
    setResult(res);
    // Retryable failures get a FRESH challenge + new phrase (sessions are
    // single-use - we never reuse a burned session, preserving anti-replay).
    if (!res.verified && res.retryable !== false && attempt < MAX_ATTEMPTS) {
      setRetrying(true);
      setTimeout(async () => {
        setAttempt((a) => a + 1);
        setRetrying(false);
        try {
          const ch = await api.authChallenge({ username, ...lastTxRef.current });
          setChallenge(ch);
        } catch (err) {
          setError(err.message || String(err));
        }
      }, 1500);
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <h1>A-MFA</h1>
        <p className="tagline">
          Synchronous Multi-Modal Authentication — biometric + spoken phrase +
          voiceprint + haptic risk signature, verified in one simultaneous step.
        </p>
        <ul className="support-bar">
          <li data-ok={hapticsSupported}>
            Vibration API {hapticsSupported ? '✓' : '✗ (visual fallback)'}
          </li>
          <li data-ok={micSupported}>
            Microphone {micSupported ? '✓' : '✗ (typed fallback)'}
          </li>
          <li data-ok={window.PublicKeyCredential !== undefined}>
            WebAuthn {window.PublicKeyCredential !== undefined ? '✓' : '✗'}
          </li>
        </ul>
      </header>

      <section className="card">
        <h2>1 · Enrol device passkey + voiceprint</h2>
        {!enrollPending ? (
          <>
            <form onSubmit={handleRegister} className="row">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                required
              />
              <button disabled={busy || !username.trim()}>
                {registered ? 'Re-register' : 'Register passkey'}
              </button>
            </form>
            {registered && (
              <p className="ok-line">
                Passkey enrolled for “{username}”
                {voiceEnrolled === true && ' + voiceprint'}
                {voiceEnrolled !== true && voiceEnrolled && (
                  <span className="warn-line">
                    {' '}
                    (voiceprint failed: {voiceEnrolled})
                  </span>
                )}
                {voiceEnrolled === false && ' (no voiceprint)'}.
              </p>
            )}
          </>
        ) : (
          <div className="enroll-box">
            <p className="ok-line">Passkey created. Now enrol your voiceprint:</p>
            <div className="phrase-box">
              <span className="phrase-label">Read aloud while recording</span>
              <span className="phrase-text">“{ENROLLMENT_PHRASE}”</span>
            </div>
            <div className="row">
              {!recording ? (
                <button onClick={startEnrollRecording} className="primary">
                  Start voice recording
                </button>
              ) : (
                <button onClick={() => finishEnrollment(true)} className="primary">
                  Stop &amp; enrol voiceprint
                </button>
              )}
              <button onClick={() => finishEnrollment(false)} disabled={busy}>
                Skip voiceprint
              </button>
            </div>
            {recording && <p className="recording-line">● recording…</p>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>2 · Initiate high-security action</h2>
        <form onSubmit={handleInitiate}>
          <div className="row">
            <select value={txType} onChange={(e) => setTxType(e.target.value)}>
              <option value="transfer">Bank transfer</option>
              <option value="payment">Card payment</option>
              <option value="data-export">Data export</option>
            </select>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="amount ($)"
              required
            />
          </div>
          <div className="row">
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="payee (optional)"
            />
            <button disabled={busy || !registered} className="primary">
              Authorize with A-MFA
            </button>
          </div>
          {!registered && <p className="hint">Register a passkey first.</p>}
        </form>
      </section>

      {error && <p className="error-line">{error}</p>}

      {result && (
        <section className="card result" data-ok={result.verified}>
          <h2>{result.verified ? 'Authorized' : 'Rejected'}</h2>
          <p>{result.verified ? result.message : result.reason}</p>
          {retrying && (
            <p className="hint">Retrying with a fresh challenge…</p>
          )}
          {!result.verified && !retrying && attempt >= MAX_ATTEMPTS && (
            <p className="hint">
              Maximum attempts reached — transaction locked.
            </p>
          )}
          {result.transcript && (
            <p className="hint">STT heard: “{result.transcript}”</p>
          )}
          {typeof result.voiceScore === 'number' && (
            <p className="hint">
              voiceprint similarity: {result.voiceScore.toFixed(3)}
            </p>
          )}
        </section>
      )}

      {challenge && (
        <AuthModal
          challenge={challenge}
          attempt={attempt}
          maxAttempts={MAX_ATTEMPTS}
          onDone={handleAuthDone}
        />
      )}
    </main>
  );
}
