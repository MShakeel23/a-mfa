async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.reason || `HTTP ${res.status}`);
  return data;
}

async function postForm(url, fd) {
  const res = await fetch(url, { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.reason || `HTTP ${res.status}`);
  return data;
}

export const api = {
  registerOptions: (username) => post('/api/register/options', { username }),

  registerVerify: (sessionId, response, wavBlob) => {
    const fd = new FormData();
    fd.append('sessionId', sessionId);
    fd.append('response', JSON.stringify(response));
    if (wavBlob) fd.append('audio', wavBlob, 'enroll.wav');
    return postForm('/api/register/verify', fd);
  },

  authChallenge: (payload) => post('/api/auth/challenge', payload),

  // wavBlob carries the spoken phrase; transcript is the typed fallback.
  authVerify: (sessionId, response, { wavBlob, transcript } = {}) => {
    const fd = new FormData();
    fd.append('sessionId', sessionId);
    fd.append('response', JSON.stringify(response));
    if (wavBlob) fd.append('audio', wavBlob, 'verify.wav');
    if (transcript) fd.append('transcript', transcript);
    return postForm('/api/auth/verify', fd);
  },
};
