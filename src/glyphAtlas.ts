import type { CachedGlyph } from "./types.js";
import { parsePx, setCanvasFont } from "./utils.js";

export class GlyphAtlas {
  public readonly texture: WebGLTexture;
  public readonly whitePixel = {
    u0: 0,
    v0: 0,
    u1: 0,
    v1: 0
  };

  private readonly width = 4096;
  private readonly height = 4096;
  private x = 2;
  private y = 2;
  private rowH = 0;
  private readonly map = new Map<string, CachedGlyph>();

  private readonly glyphMeasureCtx: CanvasRenderingContext2D;
  private readonly glyphScratch: HTMLCanvasElement;
  private glyphScratchCtx: CanvasRenderingContext2D;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error("Failed to create atlas texture");
    }
    this.texture = texture;

    const glyphMeasureCanvas = document.createElement("canvas");
    glyphMeasureCanvas.width = 16;
    glyphMeasureCanvas.height = 16;

    const measureCtx = glyphMeasureCanvas.getContext("2d", { willReadFrequently: false });
    if (!measureCtx) {
      throw new Error("Failed to create measure canvas context");
    }

    measureCtx.textAlign = "left";
    measureCtx.textBaseline = "alphabetic";
    this.glyphMeasureCtx = measureCtx;

    const scratch = document.createElement("canvas");
    const scratchCtx = scratch.getContext("2d", { willReadFrequently: false });
    if (!scratchCtx) {
      throw new Error("Failed to create glyph scratch context");
    }

    scratchCtx.textAlign = "left";
    scratchCtx.textBaseline = "alphabetic";
    this.glyphScratch = scratch;
    this.glyphScratchCtx = scratchCtx;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.width,
      this.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );

    this.reset();
  }

  public reset(): void {
    this.map.clear();
    this.x = 2;
    this.y = 2;
    this.rowH = 0;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.width,
      this.height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );

    const one = new Uint8Array([255, 255, 255, 255]);
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, one);
    this.whitePixel.u0 = 0.5 / this.width;
    this.whitePixel.v0 = 0.5 / this.height;
    this.whitePixel.u1 = this.whitePixel.u0;
    this.whitePixel.v1 = this.whitePixel.v0;
  }

  public getGlyph(style: CSSStyleDeclaration, ch: string, dpr: number): CachedGlyph {
    const key = `${style.fontStyle}|${style.fontVariant}|${style.fontWeight}|${style.fontSize}|${style.fontFamily}|${ch}|${dpr}`;
    const cached = this.map.get(key);
    if (cached) {
      return cached;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      const spacer: CachedGlyph = { empty: true };
      this.map.set(key, spacer);
      return spacer;
    }

    setCanvasFont(this.glyphMeasureCtx, style, dpr);
    const m = this.glyphMeasureCtx.measureText(ch);

    const left = m.actualBoundingBoxLeft || 0;
    const right = m.actualBoundingBoxRight || Math.max(1, m.width);
    const ascent = m.actualBoundingBoxAscent || parsePx(style.fontSize, 16) * dpr * 0.8;
    const descent = m.actualBoundingBoxDescent || parsePx(style.fontSize, 16) * dpr * 0.2;

    const pad = Math.max(1, Math.ceil(dpr));
    const w = Math.max(1, Math.ceil(left + right + pad * 2));
    const h = Math.max(1, Math.ceil(ascent + descent + pad * 2));
    const baselineX = pad + left;
    const baselineY = pad + ascent;

    if (this.glyphScratch.width !== w || this.glyphScratch.height !== h) {
      this.glyphScratch.width = w;
      this.glyphScratch.height = h;
      const ctx = this.glyphScratch.getContext("2d", { willReadFrequently: false });
      if (!ctx) {
        throw new Error("Failed to resize glyph scratch context");
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      this.glyphScratchCtx = ctx;
    }

    this.glyphScratchCtx.clearRect(0, 0, w, h);
    setCanvasFont(this.glyphScratchCtx, style, dpr);
    this.glyphScratchCtx.fillStyle = "rgba(255,255,255,1)";
    this.glyphScratchCtx.fillText(ch, baselineX, baselineY);

    const slot = this.allocGlyphSlot(w, h);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, slot.x, slot.y, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.glyphScratch);

    const glyph: CachedGlyph = {
      empty: false,
      u0: slot.x / this.width,
      v0: slot.y / this.height,
      u1: (slot.x + w) / this.width,
      v1: (slot.y + h) / this.height,
      w,
      h,
      baselineX,
      baselineY
    };

    this.map.set(key, glyph);
    return glyph;
  }

  private allocGlyphSlot(w: number, h: number): { x: number; y: number } {
    if (this.x + w >= this.width) {
      this.x = 2;
      this.y += this.rowH + 1;
      this.rowH = 0;
    }

    if (this.y + h >= this.height) {
      throw new Error("Glyph atlas full");
    }

    const out = { x: this.x, y: this.y };
    this.x += w + 1;
    this.rowH = Math.max(this.rowH, h);
    return out;
  }
}
