// OPTIONAL: a tiny Cloudflare Worker that lets the web app read the OSRS hiscores and WikiSync.
//
// Why: browsers block websites from reading another site's data unless that site allows it
// (CORS). The OSRS hiscores don't allow it, so the app can't fetch your levels on its own.
// This worker fetches them for the app and adds the "allowed" header. It ONLY forwards
// requests to the two hosts below, so it can't be abused as a general-purpose proxy.
//
// Setup (free, ~5 minutes): see "Live sync" in README.md.
// Then paste your worker's URL (e.g. https://osrs-proxy.yourname.workers.dev) into
// Skills tab -> "Sync & backup settings" -> "Live-data proxy URL".

const ALLOWED_HOSTS = ["secure.runescape.com", "sync.runescape.wiki"];
// Optional: lock the worker to your GitHub Pages site, e.g. "https://yourname.github.io".
const ALLOWED_ORIGIN = "*";
// The wiki asks tools to identify themselves - put your name/Discord here.
const USER_AGENT = "osrs-toolkit web app proxy - contact: your_name_or_discord";

export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });

    const target = new URL(request.url).searchParams.get("url");
    let url;
    try {
      url = new URL(target);
    } catch {
      return new Response("Missing or bad ?url=", { status: 400, headers: cors });
    }
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response("Host not allowed", { status: 403, headers: cors });
    }

    const upstream = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cf: { cacheTtl: 60 },
    });
    const headers = new Headers(cors);
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    headers.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
