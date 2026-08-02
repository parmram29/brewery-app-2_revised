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
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        // Staff auth is an HttpOnly cookie; without this fetch omits it and
        // every staff request comes back 401.
        credentials: 'same-origin',
      };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const res = await fetch(this.baseUrl + path, opts);

      if (res.status === 401 && typeof this.onUnauthorized === 'function') {
        this.onUnauthorized();
      }

      try {
        return await res.json();
      } catch {
        // A non-JSON body (proxy error page, crash) would otherwise throw here
        // and be reported as a network error, hiding the real status.
        return { ok: false, error: `Server error (${res.status})` };
      }
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
