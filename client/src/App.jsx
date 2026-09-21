import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from './api.js';
import AuthModal from './AuthModal.jsx';
import { hapticsSupported } from './haptics.js';
import { speechRecognitionSupported } from './speech.js';

export default function App() {
  const [username, setUsername] = useState('');
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [txType, setTxType] = useState('transfer');
  const [amount, setAmount] = useState(500);
  const [payee, setPayee] = useState('');

  const [challenge, setChallenge] = useState(null);
  const [result, setResult] = useState(null);

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { sessionId, options } = await api.registerOptions(username);
      const attestation = await startRegistration({ optionsJSON: options });
      await api.registerVerify(sessionId, attestation);
      setRegistered(true);
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
    setBusy(true);
    try {
      const ch = await api.authChallenge({
        username,
        txType,
        amount: Number(amount),
        payee,
      });
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
  }

  return (
    <main className="page">
      <header className="hero">
        <h1>A-MFA</h1>
        <p className="tagline">
          Synchronous Multi-Modal Authentication — biometric + dynamic spoken
          phrase + haptic risk signature, verified in one simultaneous step.
        </p>
        <ul className="support-bar">
          <li data-ok={hapticsSupported}>
            Vibration API {hapticsSupported ? '✓' : '✗ (visual fallback)'}
          </li>
          <li data-ok={speechRecognitionSupported}>
            SpeechRecognition {speechRecognitionSupported ? '✓' : '✗ (typed fallback)'}
          </li>
          <li data-ok={window.PublicKeyCredential !== undefined}>
            WebAuthn {window.PublicKeyCredential !== undefined ? '✓' : '✗'}
          </li>
        </ul>
      </header>

      <section className="card">
        <h2>1 · Enrol device passkey</h2>
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
          <p className="ok-line">Passkey enrolled for “{username}”.</p>
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
          {!registered && (
            <p className="hint">Register a passkey first.</p>
          )}
        </form>
      </section>

      {error && <p className="error-line">{error}</p>}

      {result && (
        <section className="card result" data-ok={result.verified}>
          <h2>{result.verified ? 'Authorized' : 'Rejected'}</h2>
          <p>{result.verified ? result.message : result.reason}</p>
        </section>
      )}

      {challenge && <AuthModal challenge={challenge} onDone={handleAuthDone} />}
    </main>
  );
}
