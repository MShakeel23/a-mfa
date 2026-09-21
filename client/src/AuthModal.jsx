import { useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from './api.js';
import { fireRiskPattern, stopHaptics } from './haptics.js';
import { speakPrompt } from './speech.js';
import { startVoiceCapture, micSupported } from './audio.js';

const STAGE = {
  FIRING: 'firing', // haptic + voice prompt just fired
  VERIFYING: 'verifying', // simultaneous biometric + voice capture in progress
  SUBMITTING: 'submitting',
};

export default function AuthModal({ challenge, onDone }) {
  const [stage, setStage] = useState(STAGE.FIRING);
  const [hapticChannel, setHapticChannel] = useState(null);
  const [micState, setMicState] = useState('starting'); // starting|recording|denied
  const [typedPhrase, setTypedPhrase] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(
    Math.ceil(challenge.expiresInMs / 1000),
  );
  const [bioStatus, setBioStatus] = useState('waiting');
  const captureRef = useRef(null);
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

    // 3. Mic opens BEFORE the biometric prompt - real audio is captured while
    //    the user speaks + holds the sensor simultaneously. The recording is
    //    transcribed AND voiceprint-matched on the server.
    startVoiceCapture()
      .then((cap) => {
        captureRef.current = cap;
        setMicState('recording');
      })
      .catch(() => setMicState('denied'));

    // 4. WebAuthn assertion - user holds fingerprint / Face ID while speaking.
    (async () => {
      try {
        const assertion = await startAuthentication({
          optionsJSON: challenge.authOptions,
        });
        setBioStatus('captured');
        setStage(STAGE.SUBMITTING);

        let wavBlob = null;
        if (captureRef.current) {
          wavBlob = await captureRef.current.stop().catch(() => null);
          captureRef.current = null;
        }

        const result = await api
          .authVerify(challenge.sessionId, assertion, {
            wavBlob,
            transcript: typedRef.current,
          })
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
      captureRef.current?.abort();
      captureRef.current = null;
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
          <li
            data-state={
              micState === 'recording'
                ? 'ok'
                : micState === 'denied'
                  ? 'warn'
                  : 'waiting'
            }
          >
            <span className="dot" />
            Voiceprint + phrase —{' '}
            {micState === 'recording'
              ? 'recording… speak now'
              : micState === 'denied'
                ? 'mic denied — type the phrase below'
                : micSupported
                  ? 'requesting mic…'
                  : 'no mic — type the phrase below'}
          </li>
        </ul>

        {(micState === 'denied' || !micSupported) && (
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
            ? 'Verifying signature + phrase + voiceprint on server…'
            : 'Speak the phrase while holding the biometric sensor'}
        </p>
      </div>
    </div>
  );
}
