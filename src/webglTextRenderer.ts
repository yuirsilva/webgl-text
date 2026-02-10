import { DomTextLayout } from "./domTextLayout.js";
import { GlyphAtlas } from "./glyphAtlas.js";
import { buildFragmentSource, defaultShaderKeys, shaderEffects, vertexSrc } from "./shaderSource.js";
import type {
  ProgramInfo,
  RawShaderProgramFiles,
  RawShaderProgramSource,
  RendererFrameOptions,
  ShaderEffect
} from "./types.js";
import { nowSeconds, toClip } from "./utils.js";

export class WebGLTextRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly layout: DomTextLayout;
  private readonly atlas: GlyphAtlas;

  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;

  private readonly shaderPrograms = new Map<string, ProgramInfo>();
  private geometryDirty = true;
  private vertexCount = 0;
  private readonly startMs = performance.now();

  constructor(
    private readonly stage: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly domLayer: HTMLElement,
    layoutProbe: HTMLElement
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true
    });

    if (!gl) {
      throw new Error("WebGL2 is required.");
    }

    this.gl = gl;
    this.layout = new DomTextLayout(domLayer, layoutProbe);
    this.atlas = new GlyphAtlas(gl);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error("Failed to create vertex objects");
    }

    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    const stride = 12 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 4 * 4);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 8 * 4);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    for (const key of defaultShaderKeys) {
      this.registerShaderProgram(key, shaderEffects[key]);
    }
  }

  public sanitizeDomLayer(): void {
    this.layout.sanitizeDomLayer();
  }

  public clearCaches(): void {
    this.layout.clearCaches();
    this.atlas.reset();
    this.geometryDirty = true;
  }

  public markGeometryDirty(): void {
    this.geometryDirty = true;
  }

  public hasShaderPreset(key: string): boolean {
    return this.shaderPrograms.has(key);
  }

  public registerShaderProgram(key: string, effect: ShaderEffect): void {
    const source = buildFragmentSource(effect);
    this.setProgramInfo(key, this.createProgramInfo(source));
  }

  public compileCustomShader(customShadeBody: string, customWarpBody: string): void {
    this.registerShaderProgram("custom", {
      shadeBody: customShadeBody || "return baseColor;",
      warpBody: customWarpBody || "return localUV;"
    });
  }

  // Full custom program from raw strings (similar to three.js ShaderMaterial usage).
  public registerRawShaderProgramFromSource(key: string, source: RawShaderProgramSource): void {
    const info = this.createProgramInfoFromRaw(source.vertexSource, source.fragmentSource);
    this.setProgramInfo(key, info);
  }

  // Full custom program from external .glsl files.
  public async registerRawShaderProgramFromFiles(key: string, files: RawShaderProgramFiles): Promise<void> {
    const [vertexSource, fragmentSource] = await Promise.all([
      this.fetchShaderText(files.vertexUrl, files.fetchInit),
      this.fetchShaderText(files.fragmentUrl, files.fetchInit)
    ]);

    this.registerRawShaderProgramFromSource(key, { vertexSource, fragmentSource });
  }

  public shouldAnimate(preset: string, animateEnabled: boolean): boolean {
    return animateEnabled && preset !== "plain";
  }

  public render(options: RendererFrameOptions): void {
    this.domLayer.style.color = options.showDom ? options.domColor : "transparent";

    const resized = this.resizeCanvas();
    if (resized) {
      this.geometryDirty = true;
    }

    if (options.forceGeometry || this.geometryDirty) {
      this.rebuildGeometry(options.showWire);
    }

    this.drawScene(options);
  }

  private resizeCanvas(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.stage.getBoundingClientRect();
    const targetW = Math.max(1, Math.round(rect.width * dpr));
    const targetH = Math.max(1, Math.round(rect.height * dpr));

    const resized = this.canvas.width !== targetW || this.canvas.height !== targetH;
    if (resized) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    return resized;
  }

  private rebuildGeometry(showWire: boolean): void {
    const dpr = window.devicePixelRatio || 1;
    this.layout.sanitizeDomLayer();
    const placements = this.layout.collectGlyphPlacements();
    const vertices = this.buildVertices(placements, this.canvas.width, this.canvas.height, dpr, showWire);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.DYNAMIC_DRAW);
    this.vertexCount = vertices.length / 12;
    this.geometryDirty = false;
  }

  private buildVertices(
    placements: ReturnType<DomTextLayout["collectGlyphPlacements"]>,
    width: number,
    height: number,
    dpr: number,
    showWire: boolean
  ): Float32Array {
    const out: number[] = [];

    const pushQuad = (
      x: number,
      y: number,
      w: number,
      h: number,
      u0: number,
      v0: number,
      u1: number,
      v1: number,
      color: [number, number, number, number],
      uvBounds: [number, number, number, number]
    ): void => {
      const [x0, y0] = toClip(x, y, width, height);
      const [x1, y1] = toClip(x + w, y + h, width, height);
      const [bu0, bv0, bu1, bv1] = uvBounds;

      out.push(
        x0, y1, u0, v1, ...color, bu0, bv0, bu1, bv1,
        x1, y1, u1, v1, ...color, bu0, bv0, bu1, bv1,
        x1, y0, u1, v0, ...color, bu0, bv0, bu1, bv1,

        x0, y1, u0, v1, ...color, bu0, bv0, bu1, bv1,
        x1, y0, u1, v0, ...color, bu0, bv0, bu1, bv1,
        x0, y0, u0, v0, ...color, bu0, bv0, bu1, bv1
      );
    };

    for (const p of placements) {
      const glyph = this.atlas.getGlyph(p.style, p.ch, dpr);
      if (!glyph.empty) {
        const x = p.x * dpr - glyph.baselineX;
        const y = p.y * dpr - glyph.baselineY;
        pushQuad(
          x,
          y,
          glyph.w,
          glyph.h,
          glyph.u0,
          glyph.v0,
          glyph.u1,
          glyph.v1,
          p.color,
          [glyph.u0, glyph.v0, glyph.u1, glyph.v1]
        );
      }

      if (showWire && p.boxW > 0.35) {
        const wx = p.boxX * dpr;
        const wy = p.boxY * dpr;
        const ww = p.boxW * dpr;
        const wh = p.boxH * dpr;
        const t = Math.max(1, Math.round(dpr));
        const c: [number, number, number, number] = [0.08, 0.61, 0.27, 0.65];
        const b: [number, number, number, number] = [
          this.atlas.whitePixel.u0,
          this.atlas.whitePixel.v0,
          this.atlas.whitePixel.u1,
          this.atlas.whitePixel.v1
        ];

        pushQuad(wx, wy, ww, t, this.atlas.whitePixel.u0, this.atlas.whitePixel.v0, this.atlas.whitePixel.u1, this.atlas.whitePixel.v1, c, b);
        pushQuad(wx, wy + wh - t, ww, t, this.atlas.whitePixel.u0, this.atlas.whitePixel.v0, this.atlas.whitePixel.u1, this.atlas.whitePixel.v1, c, b);
        pushQuad(wx, wy, t, wh, this.atlas.whitePixel.u0, this.atlas.whitePixel.v0, this.atlas.whitePixel.u1, this.atlas.whitePixel.v1, c, b);
        pushQuad(wx + ww - t, wy, t, wh, this.atlas.whitePixel.u0, this.atlas.whitePixel.v0, this.atlas.whitePixel.u1, this.atlas.whitePixel.v1, c, b);
      }
    }

    return new Float32Array(out);
  }

  private drawScene(options: RendererFrameOptions): void {
    const programInfo = this.getProgramInfo(options.shaderPreset);
    const elapsed = options.timeSeconds ?? nowSeconds(this.startMs);

    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.useProgram(programInfo.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlas.texture);

    this.gl.uniform1i(programInfo.uniforms.tex, 0);
    this.gl.uniform2f(programInfo.uniforms.resolution, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(programInfo.uniforms.time, elapsed);
    this.gl.uniform1f(programInfo.uniforms.intensity, options.shaderIntensity);
    this.gl.uniform1f(programInfo.uniforms.speed, options.shaderSpeed);

    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertexCount);
    this.gl.bindVertexArray(null);
  }

  private getProgramInfo(key: string): ProgramInfo {
    const hit = this.shaderPrograms.get(key);
    if (hit) {
      return hit;
    }

    const plain = this.shaderPrograms.get("plain");
    if (!plain) {
      throw new Error("Missing plain shader program");
    }
    return plain;
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Failed to create shader");
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader) || "Shader compile failed";
      this.gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const vs = this.createShader(this.gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);

    const program = this.gl.createProgram();
    if (!program) {
      throw new Error("Failed to create shader program");
    }

    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);

    this.gl.deleteShader(vs);
    this.gl.deleteShader(fs);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const message = this.gl.getProgramInfoLog(program) || "Program link failed";
      this.gl.deleteProgram(program);
      throw new Error(message);
    }

    return program;
  }

  private createProgramInfo(fragmentSource: string): ProgramInfo {
    const program = this.createProgram(vertexSrc, fragmentSource);
    return this.createProgramInfoForProgram(program);
  }

  private createProgramInfoFromRaw(vertexSource: string, fragmentSource: string): ProgramInfo {
    const program = this.createProgram(vertexSource, fragmentSource);
    return this.createProgramInfoForProgram(program);
  }

  private createProgramInfoForProgram(program: WebGLProgram): ProgramInfo {
    return {
      program,
      uniforms: {
        tex: this.gl.getUniformLocation(program, "u_tex"),
        resolution: this.gl.getUniformLocation(program, "u_resolution"),
        time: this.gl.getUniformLocation(program, "u_time"),
        intensity: this.gl.getUniformLocation(program, "u_intensity"),
        speed: this.gl.getUniformLocation(program, "u_speed")
      }
    };
  }

  private setProgramInfo(key: string, info: ProgramInfo): void {
    const old = this.shaderPrograms.get(key);
    this.shaderPrograms.set(key, info);
    if (old) {
      this.gl.deleteProgram(old.program);
    }
  }

  private async fetchShaderText(url: string, init?: RequestInit): Promise<string> {
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new Error(`Failed to fetch shader ${url}: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  }
}
