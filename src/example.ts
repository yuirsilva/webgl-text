import { WebGLTextRenderer } from "./webglTextRenderer.js";
import type { TextSelectionMode } from "./types.js";
import { requireElement } from "./utils.js";

const stage = requireElement<HTMLElement>("stage");
const showDomOutput = document.getElementById("showDomOutput") as HTMLInputElement | null;
const textSelectionMode: TextSelectionMode = "opt-out";

const renderer = new WebGLTextRenderer(stage, {
  textSelection: {
    mode: textSelectionMode,
    attribute: "data-text"
  }
});
const canvas = renderer.getCanvasElement();
const domLayer = renderer.getDomLayerElement();

const options = {
  shaderIntensity: 0,
  shaderSpeed: 1.2,
  postPass: {
    enabled: true,
    intensity: 0,
    speed: 1.0
  },
  showDom: false,
  domColor: "#121212",
  showWire: false,
  forceGeometry: false
};

async function setupCustomShader(): Promise<void> {
  await renderer.registerRawShaderProgramFromFiles("fileCustom", {
    vertexUrl: "./shaders/custom.vertex.glsl",
    fragmentUrl: "./shaders/custom.fragment.glsl"
  });
}

function setupPostPass(): void {
  renderer.registerRawPostPassProgramFromSource("softBlur", {
    vertexSource: `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}`,
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
  vec2 texel = 1.0 / max(u_resolution, vec2(1.0));
  float radius = 1.0 + (2.0 * u_intensity);
  vec2 blur = texel * radius;
  vec4 color = texture(u_scene, v_uv) * 0.4;
  color += texture(u_scene, v_uv + vec2( blur.x, 0.0)) * 0.15;
  color += texture(u_scene, v_uv + vec2(-blur.x, 0.0)) * 0.15;
  color += texture(u_scene, v_uv + vec2(0.0,  blur.y)) * 0.15;
  color += texture(u_scene, v_uv + vec2(0.0, -blur.y)) * 0.15;
  outColor = color;
}`
  });
}

let rafId = 0;

function applyViewMode(): void {
  const showDom = showDomOutput?.checked ?? false;
  options.showDom = showDom;
  domLayer.style.opacity = showDom ? "1" : "0";
  canvas.style.opacity = showDom ? "0" : "1";
}

function render(forceGeometry = false): void {
  renderer.render({ ...options, forceGeometry });
}

function frame(): void {
  rafId = 0;
  render();

  rafId = requestAnimationFrame(frame);
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
if (showDomOutput) {
  showDomOutput.addEventListener("input", () => {
    applyViewMode();
    render(false);
  });
}

async function init(): Promise<void> {
  await setupCustomShader();
  // setupPostPass();
  applyViewMode();
  fullRefresh();
  startLoop();
}

init().catch((error) => {
  console.error("Failed to initialize custom shader:", error);
  fullRefresh();
  startLoop();
});
