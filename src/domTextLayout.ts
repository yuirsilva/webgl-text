import type { GlyphPlacement, Rgba, TextSelectionMode, TextSelectionOptions } from "./types.js";
import { EPSILON, LATIN_TEXT } from "./utils.js";

const defaultTextSelectionAttribute = "data-text";
const defaultTextSelectionMode: TextSelectionMode = "opt-out";

export class DomTextLayout {
  private readonly colorCache = new Map<string, Rgba>();
  private readonly lineMetricCache = new Map<string, { baselineOffset: number }>();
  private readonly metricRoot: HTMLDivElement;
  private readonly wordCharPattern = /[0-9A-Za-z\u00C0-\u00FF]/;
  private textSelectionMode: TextSelectionMode = defaultTextSelectionMode;
  private textSelectionAttribute = defaultTextSelectionAttribute;

  constructor(
    private readonly domLayer: HTMLElement,
    private readonly layoutProbe: HTMLElement,
    textSelection?: TextSelectionOptions
  ) {
    this.setTextSelection(textSelection);

    this.metricRoot = document.createElement("div");
    this.metricRoot.style.position = "absolute";
    this.metricRoot.style.left = "-100000px";
    this.metricRoot.style.top = "0";
    this.metricRoot.style.visibility = "hidden";
    this.metricRoot.style.pointerEvents = "none";
    this.metricRoot.style.whiteSpace = "pre";
    document.body.appendChild(this.metricRoot);
  }

  public clearCaches(): void {
    this.colorCache.clear();
    this.lineMetricCache.clear();
  }

  public sanitizeDomLayer(): void {
    this.sanitizeLatinTree(this.domLayer);
  }

  public setTextSelection(textSelection?: TextSelectionOptions): void {
    this.textSelectionMode = textSelection?.mode || defaultTextSelectionMode;
    this.textSelectionAttribute = (textSelection?.attribute || defaultTextSelectionAttribute).trim() || defaultTextSelectionAttribute;
  }

  public collectGlyphPlacements(): GlyphPlacement[] {
    this.copyDomToProbe();

    const placements: GlyphPlacement[] = [];
    const probeRect = this.layoutProbe.getBoundingClientRect();
    const walker = document.createTreeWalker(this.layoutProbe, NodeFilter.SHOW_TEXT);
    const range = document.createRange();

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      if (!parent || !this.shouldProcessTextNode(node)) {
        continue;
      }

      const style = getComputedStyle(parent);
      const lineMetric = this.getLineMetric(style);
      const text = node.textContent || "";

      for (let i = 0; i < text.length; i += 1) {
        const ch = this.transformChar(text, i, style.textTransform);
        if (!LATIN_TEXT.test(ch)) {
          continue;
        }

        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rects = range.getClientRects();
        if (!rects.length) {
          continue;
        }

        const r = rects[0];
        if (r.width < EPSILON && ch.trim() === "") {
          continue;
        }

        const lineTop = r.top - probeRect.top;
        const baselineY = lineTop + lineMetric.baselineOffset;

        placements.push({
          ch,
          style,
          x: r.left - probeRect.left,
          y: baselineY,
          boxX: r.left - probeRect.left,
          boxY: lineTop,
          boxW: r.width,
          boxH: r.height,
          color: this.getColor(style.color)
        });
      }
    }

    return placements;
  }

  private sanitizeLatinTree(root: Node): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!this.shouldProcessTextNode(node)) {
        continue;
      }

      if (!LATIN_TEXT.test(node.data)) {
        node.data = node.data.replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF]/g, "?");
      }
    }
  }

  private copyDomToProbe(): void {
    this.layoutProbe.innerHTML = this.domLayer.innerHTML;
    this.syncRootTextSelectionAttribute();
    const sourceStyle = getComputedStyle(this.domLayer);

    this.layoutProbe.style.fontFamily = sourceStyle.fontFamily;
    this.layoutProbe.style.fontSize = sourceStyle.fontSize;
    this.layoutProbe.style.lineHeight = sourceStyle.lineHeight;
    this.layoutProbe.style.display = sourceStyle.display;
    this.layoutProbe.style.flexDirection = sourceStyle.flexDirection;
    this.layoutProbe.style.flexWrap = sourceStyle.flexWrap;
    this.layoutProbe.style.justifyContent = sourceStyle.justifyContent;
    this.layoutProbe.style.alignItems = sourceStyle.alignItems;
    this.layoutProbe.style.alignContent = sourceStyle.alignContent;
    this.layoutProbe.style.gap = sourceStyle.gap;
    this.layoutProbe.style.rowGap = sourceStyle.rowGap;
    this.layoutProbe.style.columnGap = sourceStyle.columnGap;
    this.layoutProbe.style.letterSpacing = sourceStyle.letterSpacing;
    this.layoutProbe.style.wordSpacing = sourceStyle.wordSpacing;
    this.layoutProbe.style.textTransform = sourceStyle.textTransform;
    this.layoutProbe.style.textIndent = sourceStyle.textIndent;
    this.layoutProbe.style.textRendering = sourceStyle.textRendering;
    this.layoutProbe.style.padding = sourceStyle.padding;
    this.layoutProbe.style.overflowX = sourceStyle.overflowX;
    this.layoutProbe.style.overflowY = sourceStyle.overflowY;
    this.layoutProbe.style.width = `${this.domLayer.clientWidth}px`;
    this.layoutProbe.style.height = `${this.domLayer.clientHeight}px`;

    this.sanitizeLatinTree(this.layoutProbe);
    this.layoutProbe.scrollLeft = this.domLayer.scrollLeft;
    this.layoutProbe.scrollTop = this.domLayer.scrollTop;
  }

  private syncRootTextSelectionAttribute(): void {
    const rootValue = this.domLayer.getAttribute(this.textSelectionAttribute);
    if (rootValue === null) {
      this.layoutProbe.removeAttribute(this.textSelectionAttribute);
      return;
    }

    this.layoutProbe.setAttribute(this.textSelectionAttribute, rootValue);
  }

  private shouldProcessTextNode(node: Text): boolean {
    return this.resolveNodeSelection(node.parentElement);
  }

  private resolveNodeSelection(start: Element | null): boolean {
    let current: Element | null = start;
    while (current) {
      const raw = current.getAttribute(this.textSelectionAttribute);
      if (raw !== null) {
        return this.parseSelectionFlag(raw);
      }
      current = current.parentElement;
    }

    return this.textSelectionMode === "opt-out";
  }

  private parseSelectionFlag(raw: string): boolean {
    const normalized = raw.trim().toLowerCase();
    if (!normalized || normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }

    return this.textSelectionMode === "opt-out";
  }

  private transformChar(text: string, index: number, transformValue: string): string {
    const ch = text[index] || "";
    if (!ch) {
      return ch;
    }

    const normalized = transformValue.trim().toLowerCase();
    if (!normalized || normalized === "none") {
      return ch;
    }

    if (normalized.includes("uppercase")) {
      return this.normalizeTransformedChar(ch, ch.toLocaleUpperCase());
    }

    if (normalized.includes("lowercase")) {
      return this.normalizeTransformedChar(ch, ch.toLocaleLowerCase());
    }

    if (normalized.includes("capitalize") && this.shouldCapitalizeChar(text, index)) {
      return this.normalizeTransformedChar(ch, ch.toLocaleUpperCase());
    }

    return ch;
  }

  private shouldCapitalizeChar(text: string, index: number): boolean {
    const ch = text[index];
    if (!this.wordCharPattern.test(ch)) {
      return false;
    }

    if (index === 0) {
      return true;
    }

    const prev = text[index - 1];
    return !this.wordCharPattern.test(prev);
  }

  private normalizeTransformedChar(source: string, transformed: string): string {
    return transformed.length === 1 ? transformed : source;
  }

  private getColor(cssColor: string): Rgba {
    const cached = this.colorCache.get(cssColor);
    if (cached) {
      return cached;
    }

    const el = document.createElement("span");
    el.style.color = cssColor;
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color;
    el.remove();

    const m = resolved.match(/rgba?\(([^)]+)\)/);
    let rgba: Rgba = [0, 0, 0, 1];

    if (m) {
      const parts = m[1].split(",").map((x) => x.trim());
      rgba = [
        Number(parts[0]) / 255,
        Number(parts[1]) / 255,
        Number(parts[2]) / 255,
        parts[3] === undefined ? 1 : Number(parts[3])
      ];
    }

    this.colorCache.set(cssColor, rgba);
    return rgba;
  }

  private getLineMetric(style: CSSStyleDeclaration): { baselineOffset: number } {
    const key = `${style.fontStyle}|${style.fontVariant}|${style.fontWeight}|${style.fontSize}|${style.fontFamily}|${style.lineHeight}`;
    const hit = this.lineMetricCache.get(key);
    if (hit) {
      return hit;
    }

    const line = document.createElement("span");
    line.style.display = "inline";
    line.style.fontFamily = style.fontFamily;
    line.style.fontSize = style.fontSize;
    line.style.fontStyle = style.fontStyle;
    line.style.fontWeight = style.fontWeight;
    line.style.fontVariant = style.fontVariant;
    line.style.lineHeight = style.lineHeight;
    line.style.letterSpacing = style.letterSpacing;

    const probe = document.createElement("span");
    probe.textContent = "Hg";

    const marker = document.createElement("span");
    marker.style.display = "inline-block";
    marker.style.width = "0";
    marker.style.height = "0";
    marker.style.padding = "0";
    marker.style.margin = "0";
    marker.style.border = "0";
    marker.style.verticalAlign = "baseline";

    line.append(probe, marker);
    this.metricRoot.appendChild(line);

    const lineRect = line.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const baselineOffset = markerRect.top - lineRect.top;

    line.remove();

    const out = { baselineOffset };
    this.lineMetricCache.set(key, out);
    return out;
  }
}
