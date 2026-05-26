import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { createServer as createViteServer } from 'vite';

function parseCookies(header) {
  const out = {};
  const str = typeof header === 'string' ? header : '';
  str.split(';').forEach((part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(rest.join('=') || '');
  });
  return out;
}

function sendJson(res, statusCode, obj) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function redirect(res, location, cookies) {
  res.statusCode = 302;
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('Location', location);
  res.end();
}

function getOrigin(req) {
  const host = String(req.headers.host || '').trim();
  if (!host) return null;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').trim();
  const proto = forwardedProto || 'http';
  return `${proto}://${host}`;
}

function cookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  if (typeof opts.maxAge === 'number') parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join('; ');
}

async function exchangeCodeForToken({ code, clientId, clientSecret }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  const resp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = (json?.error_description || json?.error || `HTTP ${resp.status}`).toString();
    throw new Error(msg);
  }
  const token = String(json?.access_token || '');
  if (!token) throw new Error('Missing access token.');
  return token;
}

function oauthEnabled() {
  return !!process.env.GITHUB_OAUTH_CLIENT_ID && !!process.env.GITHUB_OAUTH_CLIENT_SECRET;
}

async function main() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  const server = http.createServer(async (req, res) => {
    try {
      const origin = process.env.PUBLIC_ORIGIN || getOrigin(req);
      const url = new URL(req.url || '/', origin || 'http://localhost');

      if (url.pathname === '/api/github/oauth/config') {
        return sendJson(res, 200, { enabled: oauthEnabled() });
      }

      if (url.pathname === '/api/github/oauth/start') {
        if (!oauthEnabled()) return sendJson(res, 501, { enabled: false });
        if (!origin) return sendJson(res, 400, { error: 'Missing origin' });

        const state = randomBytes(16).toString('hex');
        const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
        const scopes = (process.env.GITHUB_OAUTH_SCOPES || 'repo read:user').trim();
        const callbackUrl = `${origin}/api/github/oauth/callback`;

        const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
        authorizeUrl.searchParams.set('client_id', clientId);
        authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
        authorizeUrl.searchParams.set('scope', scopes);
        authorizeUrl.searchParams.set('state', state);

        const secure = (origin || '').startsWith('https://');
        const cookies = [
          cookie('gh_oauth_state', state, { maxAge: 600, secure }),
        ];
        return redirect(res, authorizeUrl.toString(), cookies);
      }

      if (url.pathname === '/api/github/oauth/callback') {
        if (!oauthEnabled()) return sendJson(res, 501, { enabled: false });
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        const cookies = parseCookies(req.headers.cookie);
        const expectedState = String(cookies.gh_oauth_state || '');

        const secure = (origin || '').startsWith('https://');
        const clearCookie = cookie('gh_oauth_state', '', { maxAge: 0, secure });

        if (!code) {
          res.statusCode = 400;
          res.setHeader('Set-Cookie', clearCookie);
          res.end('Missing code');
          return;
        }
        if (!state || !expectedState || state !== expectedState) {
          res.statusCode = 400;
          res.setHeader('Set-Cookie', clearCookie);
          res.end('Invalid state');
          return;
        }

        const token = await exchangeCodeForToken({
          code,
          clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
          clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        });

        const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <script>
      (function () {
        try {
          if (window.opener && window.opener !== window) {
            window.opener.postMessage({ type: 'github_oauth_token', token: ${JSON.stringify(token)} }, window.location.origin);
          }
        } catch {}
        window.close();
      })();
    </script>
    <p>Authorized. You can close this window.</p>
  </body>
</html>`;

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Set-Cookie', clearCookie);
        res.end(html);
        return;
      }

      vite.middlewares(req, res, (err) => {
        if (err) throw err;
        res.statusCode = 404;
        res.end();
      });
    } catch (e) {
      vite.ssrFixStacktrace(e);
      res.statusCode = 500;
      res.end(e instanceof Error ? e.message : String(e));
    }
  });

  server.listen(port, host);
  server.on('listening', () => {
    const addr = server.address();
    const shownHost = typeof addr === 'object' && addr ? addr.address : host;
    const shownPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`Dev server running at http://${shownHost}:${shownPort}/`);
  });
}

main();

