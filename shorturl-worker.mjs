const CODE_PATTERN = /^[A-Za-z0-9_-]{4,24}$/;
const RANDOM_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_URL_LENGTH = 8000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function privateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function validateDestination(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_URL_LENGTH) {
    return { error: `Enter a link no longer than ${MAX_URL_LENGTH.toLocaleString()} characters.` };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: "That link is not a valid web address." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only http:// and https:// links can be shortened." };
  }
  if (!parsed.hostname || parsed.username || parsed.password || privateOrLocalHost(parsed.hostname)) {
    return { error: "Enter a public web address without a username or password." };
  }
  return { url: parsed.href };
}

function randomCode(length = 7) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length]).join("");
}

function securityHeaders(headers) {
  const output = new Headers(headers);
  output.set("X-Content-Type-Options", "nosniff");
  output.set("Referrer-Policy", "no-referrer");
  output.set("X-Frame-Options", "DENY");
  output.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  output.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  return output;
}

function notFoundPage() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link not found | Nandan Pixel</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f5ee;color:#17263c;font:16px system-ui,sans-serif}.card{max-width:440px;margin:24px;padding:36px;border:1px solid #e6dfd1;border-radius:20px;background:#fffefa;box-shadow:0 22px 56px #17263c12}h1{font-size:28px;letter-spacing:-.04em}p{color:#536174;line-height:1.65}a{color:#17263c;font-weight:700}</style><main class="card"><h1>That short link was not found.</h1><p>It may have been mistyped, or it may no longer be available.</p><a href="/">Make a new short link</a></main></html>`, {
    status: 404,
    headers: securityHeaders({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }),
  });
}

export class LinkStore {
  constructor(ctx) {
    this.ctx = ctx;
    this.createQueue = Promise.resolve();
  }

  async serializeCreate(operation) {
    const result = this.createQueue.then(operation, operation);
    this.createQueue = result.catch(() => {});
    return result;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/create") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid request." }, 400);
      }
      const checked = validateDestination(payload?.url);
      if (checked.error) return json({ error: checked.error }, 400);

      const alias = typeof payload.alias === "string" ? payload.alias.trim() : "";
      if (alias && !CODE_PATTERN.test(alias)) {
        return json({ error: "Custom names need 4–24 letters, numbers, hyphens or underscores." }, 400);
      }

      return this.serializeCreate(async () => {
        let code = alias;
        if (code) {
          const existing = await this.ctx.storage.get(`link:${code}`);
          if (existing) return json({ error: "That custom name is already in use. Try another." }, 409);
        } else {
          for (let attempt = 0; attempt < 12; attempt++) {
            const candidate = randomCode();
            const existing = await this.ctx.storage.get(`link:${candidate}`);
            if (!existing) { code = candidate; break; }
          }
          if (!code) return json({ error: "Could not find an available short name. Please try again." }, 503);
        }
        const record = { destination: checked.url, createdAt: new Date().toISOString() };
        await this.ctx.storage.put(`link:${code}`, record);
        return json({ code, ...record }, 201);
      });
    }

    if (request.method === "GET" && url.pathname === "/resolve") {
      const code = url.searchParams.get("code") || "";
      if (!CODE_PATTERN.test(code)) return json({ error: "Not found." }, 404);
      const record = await this.ctx.storage.get(`link:${code}`);
      if (!record) return json({ error: "Not found." }, 404);
      return json(record);
    }

    return json({ error: "Not found." }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const storeId = env.LINKS.idFromName("nandanpixel-short-links");
    const store = env.LINKS.get(storeId);

    if (url.pathname === "/api/health" && request.method === "GET") {
      const response = await store.fetch("https://links.internal/health");
      return json({ ok: response.ok, storage: "durable" });
    }

    if (url.pathname === "/api/shorten") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > 12000) return json({ error: "The request is too large." }, 413);
      let payload;
      try {
        const raw = await request.text();
        if (raw.length > 12000) return json({ error: "The request is too large." }, 413);
        payload = JSON.parse(raw);
      } catch {
        return json({ error: "Enter a valid link." }, 400);
      }
      const checked = validateDestination(payload?.url);
      if (checked.error) return json({ error: checked.error }, 400);
      const alias = typeof payload.alias === "string" ? payload.alias.trim() : "";
      if (alias && !CODE_PATTERN.test(alias)) {
        return json({ error: "Custom names need 4–24 letters, numbers, hyphens or underscores." }, 400);
      }
      const response = await store.fetch("https://links.internal/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: checked.url, alias }),
      });
      const data = await response.json();
      if (!response.ok) return json(data, response.status);
      return json({
        shortUrl: new URL(`/r/${data.code}`, url.origin).href,
        code: data.code,
        destination: data.destination,
        createdAt: data.createdAt,
      }, 201);
    }

    if (url.pathname.startsWith("/r/")) {
      const code = url.pathname.slice(3);
      if (!CODE_PATTERN.test(code)) return notFoundPage();
      const response = await store.fetch(`https://links.internal/resolve?code=${encodeURIComponent(code)}`);
      if (!response.ok) return notFoundPage();
      const record = await response.json();
      return new Response(null, {
        status: 302,
        headers: securityHeaders({
          location: record.destination,
          "cache-control": "no-store",
          "x-robots-tag": "noindex, nofollow",
        }),
      });
    }

    const asset = await env.ASSETS.fetch(request);
    const headers = securityHeaders(asset.headers);
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },
};
