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

export type TextSelectionMode = "opt-out" | "opt-in";

export interface TextSelectionOptions {
  mode?: TextSelectionMode;
  attribute?: string;
}

export interface RendererInitOptions {
  textSelection?: TextSelectionOptions;
}

export interface PostPassOptions {
  enabled: boolean;
  intensity: number;
  speed: number;
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
  shaderIntensity: number;
  shaderSpeed: number;
  postPass?: PostPassOptions;
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
