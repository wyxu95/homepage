import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../../functions/[[path]].js";
import { HomepagePublication } from "../../cloudflare/publication.js";
import { renderHomepage } from "./homepage.mjs";

const document = {
  documentId: "20260922121644-b31zzdx",
  markdown: "---\ntitle: index\n---\n# index\n\n# Wenyuan Xu | 徐文远\n\n> [!profile]\n> ![photo](assets/photo.jpg)\n>\n> ## Contacts\n> - [Email](mailto:wenyuan.xu@cs.au.dk)\n\n# Publications\n\nPublished from SiYuan.\n\n|Position|Period|\n|---|---|\n|Ph.D.|2022|",
  assets: { "assets/photo.jpg": { type: "image/jpeg", base64: "/9j/" } },
};
const template = '<html><main class="content academic-homepage">Static fallback</main></html>';
let entries;
let object;
let env;

beforeEach(() => {
  entries = new Map();
  const storage = {
    transaction: async callback => {
      const working = new Map(entries);
      const result = await callback({
        get: async key => Array.isArray(key) ? new Map(key.map(name => [name, working.get(name)])) : working.get(key),
        put: async values => { for (const [key, value] of Object.entries(values)) working.set(key, value); },
        delete: async keys => { for (const key of keys) working.delete(key); },
      });
      entries = working;
      return result;
    },
  };
  object = new HomepagePublication({ storage });
  env = {
    HOMEPAGE_PUBLISH_TOKEN: "test-token",
    ASSETS: { fetch: vi.fn(async () => new Response(template)) },
    HOMEPAGE_PUBLICATION: { idFromName: name => name, get: () => ({ fetch: (url, init) => object.fetch(new Request(url, init)) }) },
  };
});

function context(path = "/", init) {
  return { request: new Request(`https://wenyuanxu.net${path}`, init), env, next: async () => new Response(template) };
}

function publish(snapshot = document, token = "test-token") {
  return onRequest(context("/api/homepage/publish", {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(snapshot),
  }));
}

describe("published SiYuan homepage", () => {
  it("serves no plugin archive from the retired public download URL", async () => {
    const response = await onRequest(context("/downloads/siyuan-homepage-publisher.zip"));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("preserves layout hooks, links and attachment bytes", () => {
    const html = renderHomepage(document, template);
    expect(html).toContain('data-callout="profile"');
    expect(html).toContain('src="data:image/jpeg;base64,/9j/"');
    expect(html).toContain('href="mailto:wenyuan.xu@cs.au.dk"');
    expect(html).toContain('id="publications"');
    expect(html).toContain('<div class="table-wrapper"><table>');
    expect(html).not.toMatch(/<h1[^>]*>index<\/h1>/);
  });

  it("publishes once and immediately serves the same version to different visitors", async () => {
    const response = await publish();
    expect(response.status).toBe(200);
    const result = await response.json();
    for (let visitor = 0; visitor < 2; visitor++) {
      const page = await onRequest(context());
      expect(page.headers.get("X-Siyuan-Revision")).toBe(result.revision);
      expect(page.headers.get("Cache-Control")).toBe("no-store");
      expect(await page.text()).toContain("Published from SiYuan.");
    }
  });

  it("retains the published version until the next explicit publication", async () => {
    await publish();
    const draft = { ...document, markdown: document.markdown.replace("Published from SiYuan.", "New unpublished draft") };
    expect(await (await onRequest(context())).text()).not.toContain("New unpublished draft");
    await publish(draft);
    expect(await (await onRequest(context())).text()).toContain("New unpublished draft");
  });

  it("rejects invalid keys, documents and malformed content without overwriting publication", async () => {
    await publish();
    expect((await publish(document, "wrong-token")).status).toBe(401);
    expect((await publish({ ...document, documentId: "another-note" })).status).toBe(400);
    expect((await publish({ ...document, assets: { "../private": {} } })).status).toBe(400);
    expect(await (await onRequest(context())).text()).toContain("Published from SiYuan.");
  });

  it("allows browser preflight and serves HEAD without modifying publication", async () => {
    const preflight = await onRequest(context("/api/homepage/publish", { method: "OPTIONS" }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    await publish();
    expect(await (await onRequest(context("/", { method: "HEAD" }))).text()).toBe("");
    expect(await (await onRequest(context())).text()).toContain("Published from SiYuan.");
  });

  it("stores large Unicode pages atomically and removes obsolete chunks", async () => {
    const html = "徐文远".repeat(30_000);
    await object.fetch(new Request("https://publication/", { method: "PUT", body: JSON.stringify({ html, revision: "large", publishedAt: "now" }) }));
    expect(await (await object.fetch(new Request("https://publication/"))).text()).toBe(html);
    expect(entries.size).toBeGreaterThan(2);
    await publish();
    expect(entries.size).toBe(2);
  });

  it("retains the previous version if rendering or storage fails", async () => {
    await publish();
    expect((await publish({ ...document, markdown: "Missing heading" })).status).toBe(502);
    expect(await (await onRequest(context())).text()).toContain("Published from SiYuan.");
  });
});
