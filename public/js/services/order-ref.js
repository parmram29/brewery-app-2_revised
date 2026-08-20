// Client-side order reference generator — the server used to make these
// (lib/security.js makeRef), but with no more order-creation endpoint the
// browser has to produce its own. Not a security boundary (nothing sensitive
// depends on it being unguessable), just a friendly reference number for the
// customer and the order log.
export function makeOrderRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return 'ORD-' + hex.toUpperCase();
}
