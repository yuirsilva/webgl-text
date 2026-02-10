import { WebGLTextRenderer } from "./webglTextRenderer.js";

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el as T;
}

const stage = requireElement<HTMLElement>("stage");
const canvas = requireElement<HTMLCanvasElement>("glCanvas");
const domLayer = requireElement<HTMLElement>("domLayer");
const layoutProbe = requireElement<HTMLElement>("layoutProbe");

const renderer = new WebGLTextRenderer(stage, canvas, domLayer, layoutProbe);

domLayer.style.fontFamily = "'Times New Roman', serif";
domLayer.style.fontSize = "56px";
domLayer.style.lineHeight = "1.18";
domLayer.style.color = "#121212";

const options = {
  shaderPreset: "plain",
  shaderIntensity: 0.72,
  shaderSpeed: 1.2,
  showDom: false,
  domColor: "#121212",
  showWire: false,
  forceGeometry: false
};

const fallbackSource = {
  vertexSource: `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;
layout(location = 3) in vec4 a_uv_bounds;
uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
out vec2 v_uv;
out vec4 v_color;
out vec4 v_uv_bounds;
void main() {
  vec2 pos = a_pos;
  pos.y += sin(a_pos.x * 12.0 + u_time * u_speed * 3.0) * 0.012 * u_intensity;
  gl_Position = vec4(pos, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
  v_uv_bounds = a_uv_bounds;
}`,
    fragmentSource: `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
in vec4 v_uv_bounds;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
out vec4 outColor;
void main() {
  vec2 uvSpan = max(v_uv_bounds.zw - v_uv_bounds.xy, vec2(1e-6));
  vec2 localUV = (v_uv - v_uv_bounds.xy) / uvSpan;
  vec2 warped = localUV;
  warped.y += sin(localUV.x * 22.0 + u_time * u_speed * 5.0) * 0.09 * u_intensity;
  warped = clamp(warped, vec2(0.0), vec2(1.0));
  vec2 sampleUV = v_uv_bounds.xy + warped * uvSpan;
  vec4 texel = texture(u_tex, sampleUV);
  float alpha = texel.a * v_color.a;
  if (alpha <= 0.00001) discard;
  vec3 color = mix(v_color.rgb, vec3(0.14, 0.9, 0.7), 0.35 * u_intensity);
  outColor = vec4(color * alpha, alpha);
}`
};

async function setupCustomShader(): Promise<void> {
  try {
    await renderer.registerRawShaderProgramFromFiles("fileCustom", {
      vertexUrl: "./shaders/custom.vertex.glsl",
      fragmentUrl: "./shaders/custom.fragment.glsl"
    });
    options.shaderPreset = "fileCustom";
  } catch (error) {
    console.warn("Falling back to inline shader source:", error);
    renderer.registerRawShaderProgramFromSource("stringCustom", fallbackSource);
    options.shaderPreset = "stringCustom";
  }
}

let rafId = 0;

function render(forceGeometry = false): void {
  renderer.render({ ...options, forceGeometry });
}

function frame(): void {
  rafId = 0;
  render(false);
  if (renderer.shouldAnimate(options.shaderPreset, true)) {
    rafId = requestAnimationFrame(frame);
  }
}

function startLoop(): void {
  if (!rafId) {
    rafId = requestAnimationFrame(frame);
  }
}

function fullRefresh(): void {
  renderer.clearCaches();
  render(true);
}

const ro = new ResizeObserver(() => {
  fullRefresh();
});
ro.observe(stage);
ro.observe(domLayer);

window.addEventListener("resize", fullRefresh);
document.fonts.addEventListener("loadingdone", fullRefresh);

async function bootstrap(): Promise<void> {
  await setupCustomShader();
  fullRefresh();
  startLoop();
}

bootstrap().catch((error) => {
  console.error("Failed to initialize custom shader:", error);
  fullRefresh();
  startLoop();
});
