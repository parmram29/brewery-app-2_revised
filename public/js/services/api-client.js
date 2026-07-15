// ============================================================
// Thin fetch wrapper. Every backend call in the app goes through
// one instance of this, so retry/error/logging behaviour only
// needs to change in one place.
// ============================================================

export class ApiClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async request(method, path, body) {
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const res = await fetch(this.baseUrl + path, opts);
      return await res.json();
    } catch (err) {
      return { ok: false, error: 'Network error — is the server running?' };
    }
  }

  get(path)          { return this.request('GET', path); }
  post(path, body)   { return this.request('POST', path, body); }
  patch(path, body)  { return this.request('PATCH', path, body); }
  delete(path)       { return this.request('DELETE', path); }
}

// Single shared instance — the whole app talks to the same API origin.
export const api = new ApiClient();
