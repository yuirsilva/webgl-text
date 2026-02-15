export type Rgba = [number, number, number, number];

export interface ShaderEffect {
  warpBody: string;
  shadeBody: string;
}

export interface RawShaderProgramSource {
  vertexSource: string;
  fragmentSource: string;
}

export interface RawShaderProgramFiles {
  vertexUrl: string;
  fragmentUrl: string;
  fetchInit?: RequestInit;
}

export interface WarpPassEffect {
  warpBody: string;
  colorBody?: string;
}

export interface ProgramInfo {
  program: WebGLProgram;
  uniforms: {
    tex: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    intensity: WebGLUniformLocation | null;
    speed: WebGLUniformLocation | null;
  };
}

export interface Glyph {
  empty: false;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
  baselineX: number;
  baselineY: number;
}

export interface EmptyGlyph {
  empty: true;
}

export type CachedGlyph = Glyph | EmptyGlyph;

export interface GlyphPlacement {
  ch: string;
  style: CSSStyleDeclaration;
  x: number;
  y: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  color: Rgba;
}

export interface RendererFrameOptions {
  shaderPreset: string;
  shaderIntensity: number;
  shaderSpeed: number;
  warpPass?: {
    enabled: boolean;
    preset: string;
    intensity: number;
    speed: number;
  };
  showDom: boolean;
  domColor: string;
  showWire: boolean;
  forceGeometry?: boolean;
  timeSeconds?: number;
}

export interface Controls {
  fontFamily: HTMLInputElement;
  fontSize: HTMLInputElement;
  lineHeight: HTMLInputElement;
  textColor: HTMLInputElement;
  shaderPreset: HTMLSelectElement;
  shaderIntensity: HTMLInputElement;
  shaderSpeed: HTMLInputElement;
  animateShader: HTMLInputElement;
  customShaderBody: HTMLTextAreaElement;
  customWarpBody: HTMLTextAreaElement;
  applyCustomShader: HTMLButtonElement;
  shaderStatus: HTMLElement;
  showDom: HTMLInputElement;
  showWire: HTMLInputElement;
}
