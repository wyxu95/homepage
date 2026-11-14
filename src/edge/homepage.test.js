import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../../functions/[[path]].js";
import { renderHomepage } from "./homepage.mjs";

const document = {
  revision: "new-revision",
  markdown: "---\ntitle: index\n---\n# index\n\n# Wenyuan Xu | 徐文远\n\n> [!profile]\n> ![photo](assets/photo.jpg)\n>\n> ## Contacts\n> - [Email](mailto:wenyuan.xu@cs.au.dk)\n\n# Publications\n\nUpdated from SiYuan.\n\n|Position|Period|\n|---|---|\n|Ph.D.|2022|",
  assets: { "assets/photo.jpg": { type: "image/jpeg", base64: "/9j/" } },
};
const template = '<html><main class="content academic-homepage">Static fallback</main></html>';
let entries;
let tasks;

function context(path = "/") {
  return {
    request: new Request(`https://wenyuanxu.net${path}`),
    env: { SIYUAN_HOMEPAGE_TOKEN: "test-token" },
    next: vi.fn(async () => new Response(template)),
    waitUntil: task => tasks.push(task),
  };
}

beforeEach(() => {
  entries = new Map();
  tasks = [];
  vi.stubGlobal("caches", { default: {
    match: async key => entries.get(key.url)?.clone(),
    put: async (key, value) => entries.set(key.url, value.clone()),
  } });
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const message = JSON.parse(options.body);
    return Response.json({ jsonrpc: "2.0", id: message.id,
      result: message.method === "initialize" ? {} : { structuredContent: { result: document } },
    });
  }));
});

afterEach(async () => {
  await Promise.all(tasks);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SiYuan homepage", () => {
  it("preserves the layout hooks, links and attachment bytes", () => {
    const html = renderHomepage(document, template);
    expect(html).toContain('data-callout="profile"');
    expect(html).toContain('src="data:image/jpeg;base64,/9j/"');
    expect(html).toContain('href="mailto:wenyuan.xu@cs.au.dk"');
    expect(html).toContain('id="publications"');
    expect(html).toContain('<div class="table-wrapper"><table>');
    expect(html).not.toMatch(/<h1[^>]*>index<\/h1>/);
  });

  it("loads MCP once and serves subsequent visits from Cloudflare cache", async () => {
    const first = await onRequest(context());
    expect(first.headers.get("X-Homepage-Source")).toBe("siyuan-mcp");
    expect(await first.text()).toContain("Updated from SiYuan.");
    const second = await onRequest(context());
    expect(await second.text()).toContain("Updated from SiYuan.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(second.headers.get("Cache-Control")).toContain("max-age=0");
  });

  it("fetches a GET template for a first HEAD request and keeps the cached body", async () => {
    const request = context();
    request.request = new Request(request.request, { method: "HEAD" });
    request.next.mockImplementation(async forwarded => new Response(forwarded?.method === "GET" ? template : null));
    const head = await onRequest(request);
    expect(await head.text()).toBe("");
    expect(request.next.mock.calls[0][0].method).toBe("GET");
    const get = await onRequest(context());
    expect(await get.text()).toContain("Updated from SiYuan.");
  });

  it("refreshes stale content with the previous revision", async () => {
    await onRequest(context());
    const key = [...entries.keys()][0];
    const old = entries.get(key);
    const headers = new Headers(old.headers);
    headers.set("X-Siyuan-Checked-At", "1");
    entries.set(key, new Response(await old.text(), { headers }));
    const request = context();
    await onRequest(request);
    await Promise.all(tasks);
    const message = JSON.parse(fetch.mock.calls.at(-1)[1].body);
    expect(message.params.arguments.revision).toBe("new-revision");
    expect(Number(entries.get(key).headers.get("X-Siyuan-Checked-At"))).toBeGreaterThan(1);
  });

  it("keeps the cached homepage available when MCP fails", async () => {
    await onRequest(context());
    const key = [...entries.keys()][0];
    const cached = entries.get(key);
    const headers = new Headers(cached.headers);
    headers.set("X-Siyuan-Checked-At", "1");
    entries.set(key, new Response(await cached.text(), { headers }));
    fetch.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await (await onRequest(context())).text()).toContain("Updated from SiYuan.");
    await Promise.all(tasks);
    expect(entries.has(key)).toBe(true);
  });

  it("serves the original page if MCP fails before the first successful fetch", async () => {
    fetch.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await (await onRequest(context())).text()).toContain("Static fallback");
  });
});
