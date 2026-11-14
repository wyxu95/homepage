import { renderHomepage } from "../src/edge/homepage.mjs";

const publishPath = "/api/homepage/publish";
const documentId = "20260922121644-b31zzdx";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
};

function publication(env) {
  return env.HOMEPAGE_PUBLICATION.get(env.HOMEPAGE_PUBLICATION.idFromName("homepage"));
}

async function publish(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return Response.json({ error: "请使用发布按钮提交主页。" }, { status: 405, headers: cors });
  if (!env.HOMEPAGE_PUBLISH_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.HOMEPAGE_PUBLISH_TOKEN}`) {
    return Response.json({ error: "发布密钥不正确，请检查插件设置。" }, { status: 401, headers: cors });
  }
  if (!env.HOMEPAGE_PUBLICATION) return Response.json({ error: "主页发布服务尚未配置。" }, { status: 503, headers: cors });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 8_000_000) return Response.json({ error: "主页和图片合计超过 8 MB。" }, { status: 413, headers: cors });
  let document;
  try {
    document = JSON.parse(text);
    if (document.documentId !== documentId || typeof document.markdown !== "string" || !document.assets || Array.isArray(document.assets)) throw new Error();
    for (const [path, asset] of Object.entries(document.assets)) {
      if (!path.startsWith("assets/") || path.includes("..") || !/^[\w.+-]+\/[\w.+-]+$/.test(asset.type) || typeof asset.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) throw new Error();
    }
  } catch {
    return Response.json({ error: "发布内容无效，请从主页文档重新发布。" }, { status: 400, headers: cors });
  }
  try {
    const template = await env.ASSETS.fetch(new Request(new URL("/", request.url), { method: "GET" }));
    if (!template.ok) throw new Error("Template unavailable");
    const html = renderHomepage(document, await template.text());
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const revision = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    const publishedAt = new Date().toISOString();
    const response = await publication(env).fetch("https://publication/", {
      method: "PUT", body: JSON.stringify({ html, revision, publishedAt }),
    });
    if (!response.ok) throw new Error("Publication storage failed");
    return Response.json({ success: true, revision, publishedAt, url: "https://wenyuanxu.net/" }, { headers: cors });
  } catch {
    return Response.json({ error: "发布失败，上次发布的主页仍然保留，请稍后重试。" }, { status: 502, headers: cors });
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname;
  if (path === publishPath) return publish(context);
  if (!["/", "/wenyuan-xu/index/"].includes(path)) return context.next();
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!env.HOMEPAGE_PUBLICATION) return context.next();
  const response = await publication(env).fetch("https://publication/");
  if (response.status === 404) return context.next();
  return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers: response.headers });
}
