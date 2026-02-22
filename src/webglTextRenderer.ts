import { DomTextLayout } from "./domTextLayout.js";
import { GlyphAtlas } from "./glyphAtlas.js";
import { buildFragmentSource, vertexSrc } from "./shaderSource.js";
import type {
  ProgramInfo,
  RawShaderProgramFiles,
  RawShaderProgramSource,
  RendererInitOptions,
  RendererFrameOptions,
  ShaderEffect,
  TextSelectionOptions
} from "./types.js";
import { nowSeconds, toClip } from "./utils.js";

const postPassVertexSrc = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}`;

const defaultPostPassSources: Record<string, RawShaderProgramSource> = {
  identity: {
    vertexSource: postPassVertexSrc,
    fragmentSource: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
out vec4 outColor;

void main() {
  outColor = texture(u_scene, v_uv);
}`
  },
  ripple: {
    vertexSource: postPassVertexSrc,
    fragmentSource: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
out vec4 outColor;

void main() {
  vec2 centered = v_uv - vec2(0.5);
  float radius = length(centered);
  vec2 dir = centered / max(radius, 0.0001);
  float wave = sin(radius * 40.0 - u_time * u_speed * 7.0);
  vec2 mappedUV = clamp(v_uv + dir * wave * (0.02 * u_intensity), vec2(0.0), vec2(1.0));
  outColor = texture(u_scene, mappedUV);
}`
  },
  noise: {
    vertexSource: postPassVertexSrc,
    fragmentSource: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 p = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
  float nx = noise2(p * 18.0 + vec2(u_time * u_speed, 0.0));
  float ny = noise2(p * 18.0 + vec2(8.7, -u_time * u_speed));
  vec2 offset = (vec2(nx, ny) - 0.5) * (0.06 * u_intensity);
  vec2 mappedUV = v_uv + offset;
  mappedUV = clamp(mappedUV, vec2(0.0), vec2(1.0));
  outColor = texture(u_scene, mappedUV);
}`
  }
};

interface ResolvedStageLayers {
  canvas: HTMLCanvasElement;
  domLayer: HTMLElement;
  layoutProbe: HTMLElement;
}

const defaultLayerIds = {
  canvas: "glCanvas",
  domLayer: "domLayer",
  layoutProbe: "layoutProbe"
} as const;

const defaultShaderKey = "__default";

export class WebGLTextRenderer {
  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly domLayer: HTMLElement;
  private readonly layoutProbe: HTMLElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly layout: DomTextLayout;
  private readonly atlas: GlyphAtlas;

  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly postVao: WebGLVertexArrayObject;
  private readonly postVbo: WebGLBuffer;
  private readonly sceneFramebuffer: WebGLFramebuffer;
  private readonly sceneTexture: WebGLTexture;
  private sceneTargetWidth = 0;
  private sceneTargetHeight = 0;

  private readonly shaderPrograms = new Map<string, ProgramInfo>();
  private readonly postPassPrograms = new Map<string, ProgramInfo>();
  private activeShaderKey = defaultShaderKey;
  private activePostPassKey = "identity";
  private geometryDirty = true;
  private vertexCount = 0;
  private readonly startMs = performance.now();
  private lastRenderOptions: RendererFrameOptions | null = null;
  private scrollRafId = 0;

  constructor(stage: HTMLElement, initOptions?: RendererInitOptions);
  constructor(
    stage: HTMLElement,
    canvas: HTMLCanvasElement,
    domLayer: HTMLElement,
    layoutProbe: HTMLElement,
    initOptions?: RendererInitOptions
  );
  constructor(
    stage: HTMLElement,
    canvasOrOptions?: HTMLCanvasElement | RendererInitOptions,
    domLayerArg?: HTMLElement,
    layoutProbeArg?: HTMLElement,
    initOptionsArg?: RendererInitOptions
  ) {
    this.stage = stage;

    const hasExplicitLayers = canvasOrOptions instanceof HTMLCanvasElement;
    const resolvedLayers = hasExplicitLayers
      ? this.resolveProvidedLayers(canvasOrOptions, domLayerArg, layoutProbeArg)
      : this.ensureStageLayers();
    const initOptions = hasExplicitLayers ? initOptionsArg : canvasOrOptions;

    this.canvas = resolvedLayers.canvas;
    this.domLayer = resolvedLayers.domLayer;
    this.layoutProbe = resolvedLayers.layoutProbe;

    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true
    });

    if (!gl) {
      throw new Error("WebGL2 is required.");
    }

    this.gl = gl;
    this.layout = new DomTextLayout(this.domLayer, this.layoutProbe, initOptions?.textSelection);
    this.atlas = new GlyphAtlas(gl);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const postVao = gl.createVertexArray();
    const postVbo = gl.createBuffer();
    const sceneFramebuffer = gl.createFramebuffer();
    const sceneTexture = gl.createTexture();
    if (!vao || !vbo || !postVao || !postVbo || !sceneFramebuffer || !sceneTexture) {
      throw new Error("Failed to create WebGL objects");
    }

    this.vao = vao;
    this.vbo = vbo;
    this.postVao = postVao;
    this.postVbo = postVbo;
    this.sceneFramebuffer = sceneFramebuffer;
    this.sceneTexture = sceneTexture;

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

    gl.bindVertexArray(this.postVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.postVbo);
    const postVerts = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
       1,  1, 1, 1,
      -1, -1, 0, 0,
       1,  1, 1, 1,
      -1,  1, 0, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, postVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
    gl.bindVertexArray(null);

    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    this.registerShaderProgram(defaultShaderKey, {
      warpBody: "return localUV;",
      shadeBody: "return baseColor;"
    });

    for (const key of Object.keys(defaultPostPassSources)) {
      this.registerRawPostPassProgramFromSource(key, defaultPostPassSources[key]);
    }

    this.domLayer.addEventListener("scroll", () => {
      this.geometryDirty = true;
      if (!this.lastRenderOptions || this.scrollRafId) {
        return;
      }

      this.scrollRafId = requestAnimationFrame(() => {
        this.scrollRafId = 0;
        if (!this.lastRenderOptions) {
          return;
        }
        this.render({ ...this.lastRenderOptions, forceGeometry: true });
      });
    }, { passive: true });
  }

  private resolveProvidedLayers(
    canvas: HTMLCanvasElement,
    domLayer?: HTMLElement,
    layoutProbe?: HTMLElement
  ): ResolvedStageLayers {
    if (!domLayer || !layoutProbe) {
      throw new Error("When passing canvas, domLayer and layoutProbe are required.");
    }

    return { canvas, domLayer, layoutProbe };
  }

  private ensureStageLayers(): ResolvedStageLayers {
    const canvas = this.findDirectChildById<HTMLCanvasElement>(defaultLayerIds.canvas) || this.createCanvasLayer();
    const domLayer = this.findDirectChildById<HTMLElement>(defaultLayerIds.domLayer) || this.createDomLayer();
    const layoutProbe = this.findDirectChildById<HTMLElement>(defaultLayerIds.layoutProbe) || this.createLayoutProbe();

    if (getComputedStyle(this.stage).position === "static" && !this.stage.style.position) {
      this.stage.style.position = "relative";
    }

    const hasCanvas = canvas.parentElement === this.stage;
    const hasDomLayer = domLayer.parentElement === this.stage;
    const hasLayoutProbe = layoutProbe.parentElement === this.stage;

    if (!hasDomLayer) {
      const transferNodes = Array.from(this.stage.childNodes).filter((node) => {
        if (node === canvas || node === layoutProbe) {
          return false;
        }
        return !(node.nodeType === Node.TEXT_NODE && !(node.textContent || "").trim());
      });

      for (const node of transferNodes) {
        domLayer.appendChild(node);
      }

      // If domLayer is auto-created, mirror stage layout props so classes like
      // `flex flex-col gap-*` on stage still affect moved text children.
      this.copyStageLayoutToDomLayer(domLayer);
    }

    if (!hasCanvas) {
      if (domLayer.parentElement === this.stage) {
        this.stage.insertBefore(canvas, domLayer);
      } else {
        this.stage.appendChild(canvas);
      }
    }

    if (!hasDomLayer) {
      this.stage.appendChild(domLayer);
    }

    if (!hasLayoutProbe) {
      this.stage.appendChild(layoutProbe);
    }

    return { canvas, domLayer, layoutProbe };
  }

  private copyStageLayoutToDomLayer(domLayer: HTMLElement): void {
    const style = getComputedStyle(this.stage);
    domLayer.style.display = style.display;
    domLayer.style.flexDirection = style.flexDirection;
    domLayer.style.flexWrap = style.flexWrap;
    domLayer.style.justifyContent = style.justifyContent;
    domLayer.style.padding = style.padding;
    domLayer.style.margin = style.margin;
    domLayer.style.alignItems = style.alignItems;
    domLayer.style.alignContent = style.alignContent;
    domLayer.style.gap = style.gap;
    domLayer.style.rowGap = style.rowGap;
    domLayer.style.columnGap = style.columnGap;
  }

  private findDirectChildById<T extends HTMLElement>(id: string): T | null {
    for (const child of Array.from(this.stage.children)) {
      if (child.id === id) {
        return child as T;
      }
    }
    return null;
  }

  private applyBaseLayerBounds(el: HTMLElement): void {
    el.style.position = "absolute";
    el.style.inset = "0";
  }

  private createCanvasLayer(): HTMLCanvasElement {
    const el = document.createElement("canvas");
    el.id = defaultLayerIds.canvas;
    el.setAttribute("aria-label", "WebGL text output");
    this.applyBaseLayerBounds(el);
    el.style.width = "100%";
    el.style.height = "100%";
    return el;
  }

  private createDomLayer(): HTMLElement {
    const el = document.createElement("div");
    el.id = defaultLayerIds.domLayer;
    el.className = "dom-layer";
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("spellcheck", "false");
    this.applyBaseLayerBounds(el);
    el.style.whiteSpace = "pre-wrap";
    el.style.overflowWrap = "anywhere";
    el.style.lineBreak = "auto";
    el.style.overflowY = "auto";
    el.style.overflowX = "hidden";
    el.style.opacity = "0";
    el.style.userSelect = "none";
    el.style.pointerEvents = "auto";
    el.style.fontKerning = "normal";
    el.style.fontVariantLigatures = "none";
    return el;
  }

  private createLayoutProbe(): HTMLElement {
    const el = document.createElement("div");
    el.id = defaultLayerIds.layoutProbe;
    el.className = "layout-probe";
    el.setAttribute("aria-hidden", "true");
    this.applyBaseLayerBounds(el);
    el.style.whiteSpace = "pre-wrap";
    el.style.overflowWrap = "anywhere";
    el.style.lineBreak = "auto";
    el.style.overflowY = "auto";
    el.style.overflowX = "hidden";
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";
    el.style.fontKerning = "normal";
    el.style.fontVariantLigatures = "none";
    return el;
  }

  public getCanvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  public getDomLayerElement(): HTMLElement {
    return this.domLayer;
  }

  public getLayoutProbeElement(): HTMLElement {
    return this.layoutProbe;
  }

  public sanitizeDomLayer(): void {
    this.layout.sanitizeDomLayer();
  }

  public setTextSelection(textSelection?: TextSelectionOptions): void {
    this.layout.setTextSelection(textSelection);
    this.geometryDirty = true;
  }

  public clearCaches(): void {
    this.layout.clearCaches();
    this.atlas.reset();
    this.geometryDirty = true;
  }

  public markGeometryDirty(): void {
    this.geometryDirty = true;
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
    this.activeShaderKey = "custom";
  }

  // Full custom program from raw strings (similar to three.js ShaderMaterial usage).
  public registerRawShaderProgramFromSource(key: string, source: RawShaderProgramSource): void {
    const info = this.createProgramInfoFromRaw(source.vertexSource, source.fragmentSource);
    this.setProgramInfo(key, info);
    this.activeShaderKey = key;
  }

  // Full custom program from external .glsl files.
  public async registerRawShaderProgramFromFiles(key: string, files: RawShaderProgramFiles): Promise<void> {
    const [vertexSource, fragmentSource] = await Promise.all([
      this.fetchShaderText(files.vertexUrl, files.fetchInit),
      this.fetchShaderText(files.fragmentUrl, files.fetchInit)
    ]);

    this.registerRawShaderProgramFromSource(key, { vertexSource, fragmentSource });
  }

  public registerRawPostPassProgramFromSource(key: string, source: RawShaderProgramSource): void {
    const info = this.createPostPassProgramInfoFromRaw(source.vertexSource, source.fragmentSource);
    this.setPostPassProgramInfo(key, info);
    this.activePostPassKey = key;
  }

  public async registerRawPostPassProgramFromFiles(key: string, files: RawShaderProgramFiles): Promise<void> {
    const [vertexSource, fragmentSource] = await Promise.all([
      this.fetchShaderText(files.vertexUrl, files.fetchInit),
      this.fetchShaderText(files.fragmentUrl, files.fetchInit)
    ]);

    this.registerRawPostPassProgramFromSource(key, { vertexSource, fragmentSource });
  }

  public shouldAnimate(animateEnabled: boolean): boolean {
    return animateEnabled && this.activeShaderKey !== defaultShaderKey;
  }

  public render(options: RendererFrameOptions): void {
    this.lastRenderOptions = { ...options };
    this.domLayer.style.color = options.showDom ? options.domColor : "transparent";

    if (this.syncDomLayerOverflowState()) {
      this.geometryDirty = true;
    }

    const resized = this.resizeCanvas();
    if (resized) {
      this.geometryDirty = true;
    }

    if (options.forceGeometry || this.geometryDirty) {
      this.rebuildGeometry(options.showWire);
    }

    const elapsed = options.timeSeconds ?? nowSeconds(this.startMs);
    const postPass = options.postPass;
    if (postPass?.enabled) {
      this.ensureSceneTargetSize();
      this.drawTextScene(options, elapsed, this.sceneFramebuffer);
      this.drawPostPass(elapsed, postPass.intensity, postPass.speed);
      return;
    }

    this.drawTextScene(options, elapsed, null);
  }

  private syncDomLayerOverflowState(): boolean {
    const needsY = this.domLayer.scrollHeight - this.domLayer.clientHeight > 1;
    const needsX = this.domLayer.scrollWidth - this.domLayer.clientWidth > 1;

    const nextY = needsY ? "auto" : "hidden";
    const nextX = needsX ? "auto" : "hidden";

    let changed = false;

    if (this.domLayer.style.overflowY !== nextY) {
      this.domLayer.style.overflowY = nextY;
      changed = true;
    }

    if (this.domLayer.style.overflowX !== nextX) {
      this.domLayer.style.overflowX = nextX;
      changed = true;
    }

    return changed;
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
        const x = Math.round(p.x * dpr - glyph.baselineX);
        const y = Math.round(p.y * dpr - glyph.baselineY);
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

  private ensureSceneTargetSize(): void {
    if (this.sceneTargetWidth === this.canvas.width && this.sceneTargetHeight === this.canvas.height) {
      return;
    }

    this.sceneTargetWidth = this.canvas.width;
    this.sceneTargetHeight = this.canvas.height;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sceneTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.sceneTargetWidth,
      this.sceneTargetHeight,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.sceneFramebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      this.sceneTexture,
      0
    );

    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Scene framebuffer is incomplete");
    }
  }

  private drawTextScene(options: RendererFrameOptions, elapsed: number, target: WebGLFramebuffer | null): void {
    const programInfo = this.getProgramInfo(this.activeShaderKey);

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

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
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  private drawPostPass(elapsed: number, intensity: number, speed: number): void {
    const programInfo = this.getPostPassProgramInfo(this.activePostPassKey);

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.useProgram(programInfo.program);
    this.gl.bindVertexArray(this.postVao);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sceneTexture);

    this.gl.uniform1i(programInfo.uniforms.tex, 0);
    this.gl.uniform2f(programInfo.uniforms.resolution, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(programInfo.uniforms.time, elapsed);
    this.gl.uniform1f(programInfo.uniforms.intensity, intensity);
    this.gl.uniform1f(programInfo.uniforms.speed, speed);

    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    this.gl.bindVertexArray(null);
  }

  private getProgramInfo(key: string): ProgramInfo {
    const hit = this.shaderPrograms.get(key);
    if (hit) {
      return hit;
    }

    const defaultProgram = this.shaderPrograms.get(defaultShaderKey);
    if (!defaultProgram) {
      throw new Error("Missing default shader program");
    }
    return defaultProgram;
  }

  private getPostPassProgramInfo(key: string): ProgramInfo {
    const hit = this.postPassPrograms.get(key);
    if (hit) {
      return hit;
    }

    const identity = this.postPassPrograms.get("identity");
    if (!identity) {
      throw new Error("Missing identity post pass program");
    }
    return identity;
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

  private createPostPassProgramInfoFromRaw(vertexSource: string, fragmentSource: string): ProgramInfo {
    const program = this.createProgram(vertexSource, fragmentSource);
    return this.createPostPassProgramInfoForProgram(program);
  }

  private createPostPassProgramInfoForProgram(program: WebGLProgram): ProgramInfo {
    return {
      program,
      uniforms: {
        tex: this.gl.getUniformLocation(program, "u_scene"),
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

  private setPostPassProgramInfo(key: string, info: ProgramInfo): void {
    const old = this.postPassPrograms.get(key);
    this.postPassPrograms.set(key, info);
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
