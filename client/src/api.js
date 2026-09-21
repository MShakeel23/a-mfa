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

export const api = {
  registerOptions: (username) => post('/api/register/options', { username }),
  registerVerify: (sessionId, response) =>
    post('/api/register/verify', { sessionId, response }),
  authChallenge: (payload) => post('/api/auth/challenge', payload),
  authVerify: (sessionId, response, transcript) =>
    post('/api/auth/verify', { sessionId, response, transcript }),
};
