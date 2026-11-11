const UPSTREAM = "https://nandanpixel-shorturl.flicker-tracker.workers.dev";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, UPSTREAM);
    const headers = new Headers(request.headers);

    // The upstream does not use browser credentials. Do not forward them cross-host.
    for (const name of ["authorization", "cookie", "host", "content-length", "connection"]) {
      headers.delete(name);
    }

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    try {
      const upstreamResponse = await fetch(new Request(target, init));

      if (incoming.pathname === "/api/shorten" && request.method === "POST") {
        const raw = await upstreamResponse.text();
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          return new Response(raw, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: upstreamResponse.headers,
          });
        }

        if (upstreamResponse.ok && typeof data.code === "string") {
          data.shortUrl = new URL(`/r/${data.code}`, incoming.origin).href;
        }

        const responseHeaders = new Headers(upstreamResponse.headers);
        responseHeaders.delete("content-length");
        responseHeaders.delete("content-encoding");
        responseHeaders.set("content-type", "application/json; charset=utf-8");
        responseHeaders.set("cache-control", "no-store");
        return new Response(JSON.stringify(data), {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: responseHeaders,
        });
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      });
    } catch {
      return json({ error: "The shortener is temporarily unavailable. Please try again." }, 502);
    }
  },
};
