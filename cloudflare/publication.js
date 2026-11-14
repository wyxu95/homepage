export class HomepagePublication {
  constructor(ctx) {
    this.storage = ctx.storage;
  }

  async fetch(request) {
    if (request.method === "PUT") {
      const { html, revision, publishedAt } = await request.json();
      const bytes = new TextEncoder().encode(html);
      const chunks = Math.ceil(bytes.length / 64_000);
      await this.storage.transaction(async txn => {
        const previous = await txn.get("page");
        const entries = { page: { revision, publishedAt, chunks } };
        for (let index = 0; index < chunks; index++) entries[`html:${index}`] = bytes.slice(index * 64_000, (index + 1) * 64_000);
        await txn.put(entries);
        const obsolete = Array.from({ length: Math.max(0, (previous?.chunks || 0) - chunks) }, (_, index) => `html:${chunks + index}`);
        if (obsolete.length) await txn.delete(obsolete);
      });
      return new Response(null, { status: 204 });
    }
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const page = await this.storage.transaction(async txn => {
      const metadata = await txn.get("page");
      if (!metadata) return null;
      const keys = Array.from({ length: metadata.chunks }, (_, index) => `html:${index}`);
      const chunks = await txn.get(keys);
      return { ...metadata, body: keys.map(key => chunks.get(key)) };
    });
    if (!page) return new Response(null, { status: 404 });
    return new Response(new Blob(page.body), { headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Homepage-Source": "siyuan-publish",
      "X-Siyuan-Revision": page.revision,
      "X-Homepage-Published-At": page.publishedAt,
    } });
  }
}

export default { fetch: () => new Response("Not found", { status: 404 }) };
