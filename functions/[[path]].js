import { renderHomepage } from "../src/edge/homepage.mjs";

const endpoint = "https://siyuan-mcp.wenyuanxu.net/homepage/mcp";
const freshness = 60_000;
const pending = new Map();

async function callMcp(env, method, params, id) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SIYUAN_HOMEPAGE_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Homepage MCP returned ${response.status}`);
  const message = await response.json();
  if (message.error || message.result?.isError) throw new Error("Homepage MCP call failed");
  return message.result;
}

async function refresh(context, key, cached) {
  await callMcp(context.env, "initialize", {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "wenyuan-homepage", version: "1.0.0" },
  }, 1);
  const result = await callMcp(context.env, "tools/call", {
    name: "get_homepage", arguments: { revision: cached?.headers.get("X-Siyuan-Revision") || "" },
  }, 2);
  const content = result.structuredContent || JSON.parse(result.content.find(item => item.type === "text").text);
  const document = content.result || content;
  let html;
  if (document.unchanged && cached) {
    html = await cached.text();
  } else {
    const template = await context.next();
    if (!template.ok) throw new Error("Homepage template is unavailable");
    html = renderHomepage(document, await template.text());
  }
  const response = new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=2592000",
    "X-Siyuan-Revision": document.revision,
    "X-Siyuan-Checked-At": String(Date.now()),
    "X-Homepage-Source": "siyuan-mcp",
  } });
  await caches.default.put(key, response.clone());
  return response;
}

function visitorResponse(response, method) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("X-Siyuan-Checked-At");
  return new Response(method === "HEAD" ? null : response.body, { status: response.status, headers });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!["/", "/wenyuan-xu/index/"].includes(url.pathname)) return context.next();
  if (!["GET", "HEAD"].includes(context.request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!context.env.SIYUAN_HOMEPAGE_TOKEN) return context.next();
  const key = new Request(`${url.origin}/__siyuan_homepage_cache_v1`);
  const cached = await caches.default.match(key);
  const age = Date.now() - Number(cached?.headers.get("X-Siyuan-Checked-At") || 0);
  if (cached && age < freshness) return visitorResponse(cached, context.request.method);
  let task = pending.get(key.url);
  if (!task) {
    task = refresh(context, key, cached?.clone()).finally(() => pending.delete(key.url));
    pending.set(key.url, task);
  }
  if (cached) {
    context.waitUntil(task.catch(() => console.error("Homepage MCP refresh failed; serving cached page")));
    return visitorResponse(cached, context.request.method);
  }
  try {
    return visitorResponse((await task).clone(), context.request.method);
  } catch {
    console.error("Homepage MCP is unavailable; serving the static homepage");
    return context.next();
  }
}
