const { Plugin, Setting, showMessage } = require("siyuan");

const defaults = {
  endpoint: "https://wenyuanxu.net/api/homepage/publish",
  documentId: "20260922121644-b31zzdx",
  token: "",
};

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("无法读取思源内容，请确认思源服务正常。 ");
  const result = await response.json();
  if (result.code !== 0) throw new Error(result.msg || "思源操作失败。");
  return result.data;
}

function readAsset(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      resolve({ type: blob.type || "application/octet-stream", base64: data.slice(data.indexOf(",") + 1) });
    };
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
}

module.exports = class HomepagePublisher extends Plugin {
  async onload() {
    this.config = { ...defaults, ...await this.loadData("config.json") };
    this.setting = new Setting({ confirmCallback: () => this.saveSettings() });
    this.inputs = {};
    for (const [key, title, description] of [
      ["endpoint", "发布地址", "Cloudflare 主页的发布接口。"],
      ["documentId", "主页文档 ID", "发布此文档的当前正文与引用图片。"],
      ["token", "发布密钥", "在已配置的思源插件设置中复制，可用于你的其他思源客户端。"],
    ]) {
      const input = document.createElement("input");
      input.className = "b3-text-field fn__block";
      input.type = key === "token" ? "password" : "text";
      input.value = this.config[key];
      this.inputs[key] = input;
      this.setting.addItem({ title, description, actionElement: input });
    }
    this.addIcons('<symbol id="iconHomepagePublish" viewBox="0 0 32 32"><path d="M15 3h2v15l5-5 1.5 1.5L16 22l-7.5-7.5L10 13l5 5V3zM5 23h2v4h18v-4h2v6H5z"/></symbol>');
    this.button = this.addTopBar({
      icon: "iconHomepagePublish", title: "发布主页", position: "right", callback: () => this.publish(),
    });
  }

  async saveSettings() {
    this.config = Object.fromEntries(Object.entries(this.inputs).map(([key, input]) => [key, input.value.trim()]));
    await this.saveData("config.json", this.config);
  }

  async publish() {
    if (this.publishing) return;
    if (!this.config.token) {
      this.setting.open("发布主页");
      showMessage("请先在插件设置中填写发布密钥。", 7000);
      return;
    }
    this.publishing = true;
    this.button?.classList.add("ft__primary");
    try {
      showMessage("正在发布主页…", 3000);
      await api("/api/sqlite/flushTransaction", {});
      const exported = await api("/api/export/exportMdContent", { id: this.config.documentId });
      const assets = {};
      const matches = exported.content.matchAll(/(?:\]\(|(?:src|href)=["'])(assets\/[^\s)"'<>]+)/g);
      for (const match of matches) {
        const reference = match[1];
        if (assets[reference]) continue;
        const path = decodeURIComponent(reference);
        if (path.split("/").includes("..") || path.includes("\\")) throw new Error("图片路径无效。");
        const response = await fetch("/api/file/getFile", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "/data/" + path }),
        });
        if (!response.ok || response.headers.get("Content-Type")?.startsWith("application/json")) throw new Error("引用图片无法读取，请检查主页中的图片。");
        assets[reference] = await readAsset(await response.blob());
      }
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.token}` },
        body: JSON.stringify({ documentId: this.config.documentId, markdown: exported.content, assets }),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "发布失败，请稍后重试。");
      showMessage("主页已发布，刷新 wenyuanxu.net 即可查看。", 7000);
      return result;
    } catch (error) {
      showMessage(error.message || "发布失败，请稍后重试。", 10000, "error");
    } finally {
      this.publishing = false;
      this.button?.classList.remove("ft__primary");
    }
  }
};
