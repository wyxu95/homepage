import MarkdownIt from "markdown-it";
import slugify from "@sindresorhus/slugify";
import { parse } from "node-html-parser";

const markdown = new MarkdownIt({ html: true, breaks: true });

export function renderHomepage(document, template) {
  let source = document.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  // SiYuan adds the document title before the original imported heading.
  source = source.replace(/^\s*# index\s*\n/, "").replace(/^\u200d\s*$/gm, "");
  source = source.replace(/\[!NOTE\] ✏️ - /g, "[!note]- ");
  const body = parse(markdown.render(source));
  const ids = new Set();
  for (const heading of body.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const base = slugify(heading.innerHTML) || heading.textContent;
    let id = base;
    for (let index = 1; ids.has(id); index++) id = `${base}-${index}`;
    ids.add(id);
    heading.setAttribute("id", id);
    heading.setAttribute("tabindex", "-1");
  }
  for (const quote of body.querySelectorAll("blockquote").reverse()) {
    const first = quote.querySelector("p");
    const marker = first?.innerHTML.match(/^\[!([\w-]+)\]([+-])?\s*([^\n<]*)(?:<br>\n?|\n|$)/);
    if (!marker) continue;
    const [, type, collapse, title] = marker;
    first.innerHTML = first.innerHTML.slice(marker[0].length);
    if (!first.innerHTML.trim()) first.remove();
    const classes = `callout${collapse ? " is-collapsible" : ""}${collapse === "-" ? " is-collapsed" : ""}`;
    const fold = collapse ? '<div class="callout-fold"><i icon-name="chevron-down"></i></div>' : "";
    quote.replaceWith(`<div class="${classes}" data-callout="${type.toLowerCase()}"><div class="callout-title"><div class="callout-title-inner">${title || type}</div>${fold}</div><div class="callout-content">${quote.innerHTML}</div></div>`);
  }
  for (const table of body.querySelectorAll("table")) {
    table.replaceWith(`<div class="table-wrapper">${table.outerHTML}</div>`);
  }
  for (const link of body.querySelectorAll("a")) {
    if (/^(https?:|mailto:)/.test(link.getAttribute("href") || "")) {
      link.setAttribute("class", "external-link");
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }
  for (const element of body.querySelectorAll("img,a")) {
    const attribute = element.tagName === "IMG" ? "src" : "href";
    const asset = document.assets[element.getAttribute(attribute)];
    if (asset) element.setAttribute(attribute, `data:${asset.type};base64,${asset.base64}`);
  }
  if (!body.querySelector("h1")) throw new Error("Homepage has no heading");
  return template.replace(/(<main\b[^>]*>)[\s\S]*?(<\/main>)/, (_, start, end) => start + body.innerHTML + end);
}
