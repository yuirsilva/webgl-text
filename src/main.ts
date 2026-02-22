import type { Controls, TextSelectionMode } from "./types.js";
import { WebGLTextRenderer } from "./webglTextRenderer.js";

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el as T;
}

const stage = requireElement<HTMLElement>("stage");

const controls: Controls = {
  fontFamily: requireElement<HTMLInputElement>("fontFamily"),
  fontSize: requireElement<HTMLInputElement>("fontSize"),
  lineHeight: requireElement<HTMLInputElement>("lineHeight"),
  textColor: requireElement<HTMLInputElement>("textColor"),
  shaderIntensity: requireElement<HTMLInputElement>("shaderIntensity"),
  shaderSpeed: requireElement<HTMLInputElement>("shaderSpeed"),
  animateShader: requireElement<HTMLInputElement>("animateShader"),
  customShaderBody: requireElement<HTMLTextAreaElement>("customShaderBody"),
  customWarpBody: requireElement<HTMLTextAreaElement>("customWarpBody"),
  applyCustomShader: requireElement<HTMLButtonElement>("applyCustomShader"),
  shaderStatus: requireElement<HTMLElement>("shaderStatus"),
  showDom: requireElement<HTMLInputElement>("showDom"),
  showWire: requireElement<HTMLInputElement>("showWire")
};

const textSelectionMode: TextSelectionMode = "opt-out";

const renderer = new WebGLTextRenderer(stage, {
  textSelection: {
    mode: textSelectionMode,
    attribute: "data-text"
  }
});
const domLayer = renderer.getDomLayerElement();
if (!domLayer.hasAttribute("contenteditable")) {
  domLayer.setAttribute("contenteditable", "true");
}

function setShaderStatus(message: string, isError = false): void {
  controls.shaderStatus.textContent = message;
  controls.shaderStatus.style.color = isError ? "#a80000" : "#204f2a";
}

function normalizeShaderError(error: unknown): string {
  const message = String((error as { message?: string } | null)?.message || error || "Unknown shader error").trim();
  const firstLine = message.split("\n")[0] || message;
  return firstLine.slice(0, 220);
}

function applyControlsToDom(): void {
  const family = controls.fontFamily.value.trim() || "'Times New Roman', serif";
  const size = Number(controls.fontSize.value) || 32;
  const lineHeight = Number(controls.lineHeight.value) || 1.4;
  const color = controls.textColor.value;

  domLayer.style.fontFamily = family;
  domLayer.style.fontSize = `${size}px`;
  domLayer.style.lineHeight = String(lineHeight);
  domLayer.style.color = color;
}

function renderCurrent(forceGeometry = false): void {
  renderer.render({
    shaderIntensity: Number(controls.shaderIntensity.value) || 0,
    shaderSpeed: Number(controls.shaderSpeed.value) || 0,
    showDom: controls.showDom.checked,
    domColor: controls.textColor.value,
    showWire: controls.showWire.checked,
    forceGeometry
  });
}

let rafId = 0;

function shouldAnimate(): boolean {
  return renderer.shouldAnimate(controls.animateShader.checked);
}

function updateAnimationLoop(): void {
  if (shouldAnimate()) {
    if (!rafId) {
      rafId = requestAnimationFrame(frame);
    }
    return;
  }

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function frame(): void {
  rafId = 0;
  renderCurrent(false);
  updateAnimationLoop();
}

function fullRefresh(): void {
  renderer.clearCaches();
  renderCurrent(true);
  updateAnimationLoop();
}

function onLayoutInput(): void {
  applyControlsToDom();
  fullRefresh();
}

controls.applyCustomShader.addEventListener("click", () => {
  try {
    renderer.compileCustomShader(controls.customShaderBody.value, controls.customWarpBody.value);
    setShaderStatus("Custom shader applied.");
    renderCurrent(false);
    updateAnimationLoop();
  } catch (error) {
    setShaderStatus(`Custom shader error: ${normalizeShaderError(error)}`, true);
  }
});

controls.shaderIntensity.addEventListener("input", () => {
  renderCurrent(false);
  updateAnimationLoop();
});

controls.shaderSpeed.addEventListener("input", () => {
  renderCurrent(false);
  updateAnimationLoop();
});

controls.animateShader.addEventListener("input", () => {
  renderCurrent(false);
  updateAnimationLoop();
});

controls.showDom.addEventListener("input", () => {
  renderCurrent(false);
});

controls.showWire.addEventListener("input", () => {
  renderer.markGeometryDirty();
  renderCurrent(true);
});

controls.fontFamily.addEventListener("input", onLayoutInput);
controls.fontSize.addEventListener("input", onLayoutInput);
controls.lineHeight.addEventListener("input", onLayoutInput);
controls.textColor.addEventListener("input", onLayoutInput);

domLayer.addEventListener("input", () => {
  renderer.sanitizeDomLayer();
  fullRefresh();
});

const ro = new ResizeObserver(() => {
  fullRefresh();
});

ro.observe(stage);
ro.observe(domLayer);

window.addEventListener("resize", fullRefresh);

document.fonts.addEventListener("loadingdone", fullRefresh);

applyControlsToDom();

try {
  renderer.compileCustomShader(controls.customShaderBody.value, controls.customWarpBody.value);
  setShaderStatus("Custom shader ready.");
} catch (error) {
  setShaderStatus(`Custom shader error: ${normalizeShaderError(error)}`, true);
}

fullRefresh();
