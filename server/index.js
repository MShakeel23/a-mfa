import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
const RP_NAME = 'A-MFA Demo Bank';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGINS = (process.env.ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());
const SESSION_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Persistence (flat JSON file - fine for a prototype)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { users: [], auditLog: [] };
  }
}

function saveDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const db = loadDb();

// Ephemeral auth sessions (challenge state must never be trusted from client)
const sessions = new Map();

// ---------------------------------------------------------------------------
// Liveness phrases + haptic risk signatures
// ---------------------------------------------------------------------------
const PHRASES = [
  'It is a nice Sunday',
  'Purple clouds drift slowly',
  'The river runs cold tonight',
  'Seven green apples fell',
  'My bicycle has a loud bell',
  'Winter mornings feel quiet',
  'A fox jumped over the fence',
  'Bright stars fill the sky',
];

// Patterns mirror the client-side navigator.vibrate() sequences.
const RISK_LEVELS = {
  low: {
    label: 'Low risk',
    pattern: [80],
    description: '1 short pulse',
  },
  medium: {
    label: 'Medium risk',
    pattern: [150, 100, 150],
    description: '2 medium pulses',
  },
  high: {
    label: 'High risk - financial transfer',
    pattern: [250, 120, 250, 120, 450],
    description: '3 heavy pulses',
  },
};

function riskFor(txType, amount) {
  if (txType === 'transfer' && amount >= 500) return 'high';
  if (amount >= 100) return 'medium';
  return 'low';
}

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Token-overlap match so minor STT errors don't fail an honest user,
// while a wrong phrase (replay) still fails.
function phraseMatches(expected, transcript) {
  const e = normalize(expected);
  const t = normalize(transcript);
  if (!e || !t) return false;
  if (e === t) return true;
  const expectedTokens = new Set(e.split(' '));
  const said = new Set(t.split(' '));
  let hits = 0;
  for (const tok of expectedTokens) if (said.has(tok)) hits++;
  return hits / expectedTokens.size >= 0.8;
}

function audit(entry) {
  db.auditLog.push({ at: new Date().toISOString(), ...entry });
  saveDb(db);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: ORIGINS }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// --- Registration -----------------------------------------------------------
app.post('/api/register/options', async (req, res) => {
  const { username } = req.body || {};
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'username required' });
  }
  const name = username.trim();
  let user = db.users.find((u) => u.username === name);
  if (!user) {
    user = { username: name, credentials: [] };
    db.users.push(user);
    saveDb(db);
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.username,
    attestationType: 'none',
    excludeCredentials: user.credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    kind: 'registration',
    username: name,
    challenge: options.challenge,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  res.json({ sessionId, options });
});

app.post('/api/register/verify', async (req, res) => {
  const { sessionId, response } = req.body || {};
  const session = sessions.get(sessionId);
  if (!session || session.kind !== 'registration' || Date.now() > session.expiresAt) {
    return res.status(400).json({ error: 'invalid or expired session' });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: session.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'registration verification failed' });
    }

    const { credential } = verification.registrationInfo;
    const user = db.users.find((u) => u.username === session.username);
    user.credentials.push({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || [],
    });
    saveDb(db);
    sessions.delete(sessionId);
    audit({ event: 'register', username: user.username, ok: true });
    res.json({ verified: true });
  } catch (err) {
    audit({ event: 'register', username: session.username, ok: false, reason: err.message });
    res.status(400).json({ error: err.message });
  }
});

// --- Synchronous A-MFA challenge -------------------------------------------
app.post('/api/auth/challenge', async (req, res) => {
  const { username, txType = 'transfer', amount = 0, payee = '' } = req.body || {};
  const user = db.users.find((u) => u.username === username);
  if (!user || user.credentials.length === 0) {
    return res.status(404).json({ error: 'user not found or has no registered passkey' });
  }

  const authOptions = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: user.credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    userVerification: 'required',
  });

  const risk = riskFor(txType, Number(amount));
  const phrase = PHRASES[crypto.randomInt(PHRASES.length)];
  const sessionId = crypto.randomUUID();

  sessions.set(sessionId, {
    kind: 'authentication',
    username,
    challenge: authOptions.challenge,
    phrase,
    risk,
    transaction: { txType, amount: Number(amount), payee },
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  audit({ event: 'challenge', username, risk, amount: Number(amount) });
  res.json({
    sessionId,
    authOptions,
    phrase,
    risk: { level: risk, ...RISK_LEVELS[risk] },
    transaction: { txType, amount: Number(amount), payee },
    expiresInMs: SESSION_TTL_MS,
  });
});

// --- Verify: WebAuthn signature + spoken phrase, bound to one session -------
app.post('/api/auth/verify', async (req, res) => {
  const { sessionId, response, transcript } = req.body || {};
  const session = sessions.get(sessionId);
  const fail = (reason) => {
    audit({
      event: 'verify',
      username: session?.username,
      ok: false,
      reason,
    });
    return res.status(401).json({ verified: false, reason });
  };

  if (!session || session.kind !== 'authentication') return fail('unknown session');
  sessions.delete(sessionId); // single-use: a session can never be replayed
  if (Date.now() > session.expiresAt) return fail('challenge expired');

  const user = db.users.find((u) => u.username === session.username);
  const cred = user?.credentials.find((c) => c.id === response?.id);
  if (!cred) return fail('credential not recognized');

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: session.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
        counter: cred.counter,
        transports: cred.transports,
      },
    });

    if (!verification.verified) return fail('biometric signature invalid');
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb(db);
  } catch (err) {
    return fail(`biometric verification error: ${err.message}`);
  }

  if (!phraseMatches(session.phrase, transcript)) {
    return fail(`spoken phrase did not match (heard: "${transcript || 'nothing'}")`);
  }

  audit({
    event: 'verify',
    username: session.username,
    ok: true,
    risk: session.risk,
    amount: session.transaction.amount,
  });
  res.json({
    verified: true,
    message: 'Transaction authorized',
    transaction: session.transaction,
    risk: session.risk,
  });
});

// --- Serve built client in production --------------------------------------
const distDir = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) =>
    res.sendFile(path.join(distDir, 'index.html')),
  );
}

app.listen(PORT, () => {
  console.log(`A-MFA server listening on http://localhost:${PORT}`);
  console.log(`RP_ID=${RP_ID}  ORIGINS=${ORIGINS.join(', ')}`);
});
