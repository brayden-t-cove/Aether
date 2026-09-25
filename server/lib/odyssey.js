/**
 * HTTP client for Odyssey. Aether authenticates with a service key sent as a
 * Bearer token (see docs/ODYSSEY_API.md for what Odyssey needs to accept it).
 * Returns null when Odyssey isn't configured, so callers can skip cleanly.
 */
export function createOdysseyClient({ apiUrl, apiKey, timeoutMs = 15000 } = {}) {
  if (!apiUrl || !apiKey) return null;

  async function request(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(`${apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(`Couldn't reach Odyssey (${err.name === 'TimeoutError' ? 'timed out' : err.message})`, { cause: err });
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Odyssey returned HTML (e.g. a login page), handled below.
    }
    if (res.status === 401 || res.status === 403) throw new Error('Odyssey refused the service key (check ODYSSEY_API_KEY on both apps)');
    if (!res.ok) throw new Error(`Odyssey returned ${res.status}${data?.error ? `: ${data.error}` : ''}`);
    if (data === null) throw new Error('Odyssey returned something that is not JSON');
    return data;
  }

  const list = async (path) => {
    const data = await request(path);
    if (!Array.isArray(data)) throw new Error(`Odyssey ${path} did not return a list`);
    return data;
  };

  return {
    url: apiUrl,
    listProducts: () => list('/api/catalog'),
    listSessions: () => list('/api/sessions'),
    listVendors: () => list('/api/vendors'),
    createProduct: (payload) => request('/api/catalog', { method: 'POST', body: payload }),
  };
}
