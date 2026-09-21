import { useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from './api.js';
import { fireRiskPattern, stopHaptics, hapticsSupported } from './haptics.js';
import {
  speakPrompt,
  createRecognizer,
  speechRecognitionSupported,
} from './speech.js';

const STAGE = {
  FIRING: 'firing', // haptic + voice prompt just fired
  VERIFYING: 'verifying', // simultaneous biometric + speech in progress
  SUBMITTING: 'submitting',
};

export default function AuthModal({ challenge, onDone }) {
  const [stage, setStage] = useState(STAGE.FIRING);
  const [hapticChannel, setHapticChannel] = useState(null);
  const [heard, setHeard] = useState('');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(
    Math.ceil(challenge.expiresInMs / 1000),
  );
  const [bioStatus, setBioStatus] = useState('waiting');
  const transcriptRef = useRef('');
  const typedRef = useRef('');
  const finishedRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    // Guard: never start a second WebAuthn ceremony - a new request aborts
    // the in-flight one ("authentication ceremony was sent an abort signal").
    if (startedRef.current) return;
    startedRef.current = true;

    // 1. Haptic risk signature fires the moment the screen dims.
    setHapticChannel(fireRiskPattern(challenge.risk.pattern));

    // 2. Voice engine announces the single-use, session-bound phrase.
    speakPrompt(`Say "${challenge.phrase}" to approve`);

    // 3. Mic opens BEFORE the biometric prompt - both channels are now
    //    live simultaneously, which is the core of the A-MFA design.
    const rec = createRecognizer({
      onInterim: (t) => {
        transcriptRef.current = t;
        setHeard(t);
      },
      onFinal: (t) => {
        transcriptRef.current = `${transcriptRef.current} ${t}`.trim();
        setHeard(transcriptRef.current);
      },
      onError: () => {},
    });
    try {
      rec?.start();
    } catch {
      /* already started */
    }

    // 4. WebAuthn assertion - user holds fingerprint / Face ID while speaking.
    (async () => {
      try {
        const assertion = await startAuthentication({
          optionsJSON: challenge.authOptions,
        });
        setBioStatus('captured');
        setStage(STAGE.SUBMITTING);
        // Give STT a brief moment to flush the last final segment.
        await new Promise((r) => setTimeout(r, 600));
        const transcript = transcriptRef.current || typedRef.current;
        const result = await api
          .authVerify(challenge.sessionId, assertion, transcript)
          .catch((err) => ({ verified: false, reason: err.message }));
        finish(result);
      } catch (err) {
        if (!finishedRef.current) {
          finish({
            verified: false,
            reason: `biometric prompt closed: ${err.message || err}`,
          });
        }
      }
    })();

    const timer = setInterval(
      () => setSecondsLeft((s) => Math.max(0, s - 1)),
      1000,
    );
    const hardTimeout = setTimeout(
      () => finish({ verified: false, reason: 'challenge expired' }),
      challenge.expiresInMs,
    );

    function finish(result) {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onDone(result);
    }

    return () => {
      try {
        rec?.stop();
      } catch {
        /* not running */
      }
      stopHaptics();
      window.speechSynthesis?.cancel();
      clearInterval(timer);
      clearTimeout(hardTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop dimmed">
      <div
        className={`modal ${hapticChannel === 'fallback' ? 'haptic-fallback' : ''}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <span className="risk-badge" data-level={challenge.risk.level}>
            {challenge.risk.label}
          </span>
          <span className="countdown" aria-live="polite">
            {secondsLeft}s
          </span>
        </div>

        <p className="tx-summary">
          {challenge.transaction.txType} of{' '}
          <strong>${challenge.transaction.amount}</strong>
          {challenge.transaction.payee && (
            <>
              {' '}
              to <strong>{challenge.transaction.payee}</strong>
            </>
          )}
        </p>

        <div className="phrase-box">
          <span className="phrase-label">Speak to approve</span>
          <span className="phrase-text">“{challenge.phrase}”</span>
        </div>

        <ul className="channel-status">
          <li data-state={hapticChannel === 'vibrated' ? 'ok' : 'warn'}>
            <span className="dot" />
            Haptic signature —{' '}
            {hapticChannel === 'vibrated'
              ? `${challenge.risk.description} fired`
              : 'no Vibration API — visual pulse fallback (research limitation)'}
          </li>
          <li data-state={bioStatus === 'captured' ? 'ok' : 'waiting'}>
            <span className="dot" />
            Biometric —{' '}
            {bioStatus === 'captured' ? 'signature captured' : 'hold the sensor…'}
          </li>
          <li data-state={heard || typedPhrase ? 'ok' : 'waiting'}>
            <span className="dot" />
            Voice —{' '}
            {speechRecognitionSupported
              ? heard
                ? `heard: “${heard}”`
                : 'listening…'
              : 'SpeechRecognition unsupported — type the phrase below'}
          </li>
        </ul>

        {!speechRecognitionSupported && (
          <input
            className="phrase-input"
            placeholder="Type the phrase (accessibility fallback)"
            value={typedPhrase}
            onChange={(e) => {
              setTypedPhrase(e.target.value);
              typedRef.current = e.target.value;
            }}
          />
        )}

        <p className="stage-line">
          {stage === STAGE.SUBMITTING
            ? 'Verifying signature + phrase on server…'
            : 'Speak the phrase while holding the biometric sensor'}
        </p>
      </div>
    </div>
  );
}
