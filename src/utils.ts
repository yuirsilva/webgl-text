export const LATIN_TEXT = /^[\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF]*$/;
export const EPSILON = 0.35;

export function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el as T;
}

export function parsePx(value: string | null | undefined, fallback = 0): number {
  if (typeof value !== "string") {
    return fallback;
  }

  if (value.endsWith("px")) {
    const n = Number(value.slice(0, -2));
    return Number.isFinite(n) ? n : fallback;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseFontPx(fontValue: string | null | undefined, fallback = 0): number {
  if (typeof fontValue !== "string") {
    return fallback;
  }

  const m = fontValue.match(/([0-9]+(?:\.[0-9]+)?)px/);
  if (!m) {
    return fallback;
  }

  const n = Number(m[1]);
  return Number.isFinite(n) ? n : fallback;
}

export function composeCanvasFont(style: CSSStyleDeclaration, scale: number): string {
  const size = Math.max(1, parsePx(style.fontSize, 16) * scale);
  const parts = [style.fontStyle || "normal", style.fontWeight || "400", `${size}px`, style.fontFamily || "serif"];
  return parts.join(" ");
}

export function setCanvasFont(ctx: CanvasRenderingContext2D, style: CSSStyleDeclaration, scale: number): void {
  const wantedSize = Math.max(1, parsePx(style.fontSize, 16) * scale);
  const preferred = composeCanvasFont(style, scale);
  ctx.font = preferred;

  if (Math.abs(parseFontPx(ctx.font, 0) - wantedSize) > 0.5) {
    ctx.font = `${wantedSize}px ${style.fontFamily || "serif"}`;
  }
}

export function toClip(x: number, y: number, width: number, height: number): [number, number] {
  return [(x / width) * 2 - 1, 1 - (y / height) * 2];
}

export function nowSeconds(startMs: number): number {
  return (performance.now() - startMs) * 0.001;
}
