const { test, describe } = require('node:test');
const assert = require('node:assert');
const jwt = require('../lib/jwt');

const SECRET = 'test-signing-secret';

describe('jwt.sign / jwt.verify', () => {
  test('round-trips claims', () => {
    const token = jwt.sign({ sub: 'ORD-ABC123', amount: 45 }, SECRET);
    const claims = jwt.verify(token, SECRET);
    assert.equal(claims.sub, 'ORD-ABC123');
    assert.equal(claims.amount, 45);
    assert.ok(claims.iat, 'issued-at is stamped automatically');
  });

  test('produces the three-part JWT shape', () => {
    assert.match(jwt.sign({ a: 1 }, SECRET), /^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  test('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ sub: 'x' }, 'secret-a');
    assert.equal(jwt.verify(token, 'secret-b'), null);
  });

  test('rejects a tampered payload', () => {
    const token = jwt.sign({ amount: 10 }, SECRET);
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ amount: 100000 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // Someone raising the amount must not be able to reuse the old signature.
    assert.equal(jwt.verify(`${h}.${forged}.${s}`, SECRET), null);
  });
});

describe('jwt algorithm confusion', () => {
  test('rejects alg:none — the classic JWT bypass', () => {
    // An attacker strips the signature and claims the token needs none.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const body = Buffer.from(JSON.stringify({ sub: 'attacker' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(jwt.verify(`${header}.${body}.`, SECRET), null);
    assert.equal(jwt.verify(`${header}.${body}.anything`, SECRET), null);
  });

  test('rejects an algorithm swap even with a valid-looking signature', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const body = Buffer.from(JSON.stringify({ sub: 'x' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const crypto = require('node:crypto');
    const sig = crypto.createHmac('sha512', SECRET).update(`${header}.${body}`)
      .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(jwt.verify(`${header}.${body}.${sig}`, SECRET), null);
  });
});

describe('jwt expiry', () => {
  test('accepts a token inside its window', () => {
    const token = jwt.sign({ sub: 'x' }, SECRET, { expiresInSeconds: 60 });
    assert.ok(jwt.verify(token, SECRET));
  });

  test('rejects an expired token', async () => {
    const token = jwt.sign({ sub: 'x' }, SECRET, { expiresInSeconds: 1 });
    assert.ok(jwt.verify(token, SECRET), 'valid immediately');
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(jwt.verify(token, SECRET), null, 'rejected once exp passes');
  });

  test('rejects a not-yet-valid token', () => {
    const future = Math.floor(Date.now() / 1000) + 300;
    assert.equal(jwt.verify(jwt.sign({ nbf: future }, SECRET), SECRET), null);
  });
});

describe('jwt malformed input', () => {
  test('returns null rather than throwing', () => {
    for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', null, undefined, 123, {}, 'a.b.c']) {
      assert.equal(jwt.verify(bad, SECRET), null, `input ${JSON.stringify(bad)}`);
    }
  });

  test('requires a secret on both sides', () => {
    assert.throws(() => jwt.sign({ a: 1 }, ''), /secret is required/);
    assert.equal(jwt.verify(jwt.sign({ a: 1 }, SECRET), ''), null);
  });
});

describe('decodeUnsafe', () => {
  test('reads claims without verifying — debugging only', () => {
    const token = jwt.sign({ sub: 'ORD-1' }, SECRET);
    assert.equal(jwt.decodeUnsafe(token).sub, 'ORD-1');
    // Deliberately succeeds on a token this secret could never have signed,
    // which is exactly why its result must never be trusted.
    assert.equal(jwt.decodeUnsafe(jwt.sign({ sub: 'forged' }, 'other')).sub, 'forged');
  });
});
