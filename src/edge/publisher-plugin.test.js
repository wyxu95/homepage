import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadPlugin() {
  const messages = [];
  class Plugin {
    async loadData() { return { token: "test-token" }; }
    addIcons() {}
    addTopBar(button) { this.publishButton = button; return { classList: { add() {}, remove() {} } }; }
  }
  class Setting { addItem() {} open() {} }
  class Reader {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
      this.onload();
    }
  }
  const fetch = vi.fn(async (url, options) => {
    if (url === "/api/sqlite/flushTransaction") return Response.json({ code: 0 });
    if (url === "/api/export/exportMdContent") return Response.json({ code: 0, data: { content: "# Local unsynced content\n![photo](assets/photo.jpg)" } });
    if (url === "/api/file/getFile") return new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } });
    return Response.json({ success: true, revision: "published" });
  });
  const sandbox = {
    module: { exports: {} }, require: () => ({ Plugin, Setting, showMessage: message => messages.push(message) }),
    document: { createElement: () => ({}) }, fetch, FileReader: Reader, AbortSignal,
  };
  vm.runInNewContext(fs.readFileSync("plugins/siyuan-homepage-publisher/index.js", "utf8"), sandbox);
  return { plugin: new sandbox.module.exports(), fetch, messages };
}

describe("SiYuan publisher plugin", () => {
  it("publishes current local content and binary assets when its toolbar button is clicked", async () => {
    const { plugin, fetch, messages } = loadPlugin();
    await plugin.onload();
    await plugin.publishButton.callback();
    const [url, request] = fetch.mock.calls.at(-1);
    expect(url).toBe("https://wenyuanxu.net/api/homepage/publish");
    const data = JSON.parse(request.body);
    expect(data.markdown).toContain("Local unsynced content");
    expect(data.assets["assets/photo.jpg"]).toEqual({ type: "image/jpeg", base64: "/9j/" });
    expect(messages.at(-1)).toContain("主页已发布");
    expect(plugin.publishing).toBe(false);
  });

  it("shows publication errors and permits a retry", async () => {
    const { plugin, fetch, messages } = loadPlugin();
    await plugin.onload();
    fetch.mockImplementation(async () => { throw new Error("网络连接失败"); });
    await plugin.publishButton.callback();
    expect(messages.at(-1)).toBe("网络连接失败");
    expect(plugin.publishing).toBe(false);
  });
});
