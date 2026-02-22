import type { ShaderEffect } from "./types.js";

export const vertexSrc = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;
layout(location = 3) in vec4 a_uv_bounds;
out vec2 v_uv;
out vec4 v_color;
out vec4 v_uv_bounds;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
  v_uv_bounds = a_uv_bounds;
}`;

export function buildFragmentSource(effect: ShaderEffect): string {
  const warpBody = effect.warpBody || "return localUV;";
  const shadeBody = effect.shadeBody || "return baseColor;";

  return `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in vec4 v_uv_bounds;
uniform sampler2D u_tex;
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

vec2 warpTextLocalUV(
  vec2 localUV,
  vec2 uv,
  vec4 uvBounds,
  vec2 fragCoord,
  vec2 resolution,
  float time,
  float intensity,
  float speed
) {
${warpBody}
}

vec3 shadeText(
  vec2 localUV,
  vec2 uv,
  vec3 baseColor,
  float alpha,
  vec2 fragCoord,
  vec2 resolution,
  float time,
  float intensity,
  float speed
) {
${shadeBody}
}

void main() {
  vec2 uvSpan = max(v_uv_bounds.zw - v_uv_bounds.xy, vec2(1e-6));
  vec2 localUV = (v_uv - v_uv_bounds.xy) / uvSpan;
  vec2 warpedLocalUV = warpTextLocalUV(localUV, v_uv, v_uv_bounds, gl_FragCoord.xy, u_resolution, u_time, u_intensity, u_speed);
  warpedLocalUV = clamp(warpedLocalUV, vec2(0.0), vec2(1.0));
  vec2 warpedUV = v_uv_bounds.xy + warpedLocalUV * uvSpan;

  vec4 texel = texture(u_tex, warpedUV);
  float alpha = texel.a * v_color.a;
  if (alpha <= 0.00001) {
    discard;
  }

  vec3 base = v_color.rgb;
  vec3 shaded = shadeText(warpedLocalUV, warpedUV, base, alpha, gl_FragCoord.xy, u_resolution, u_time, u_intensity, u_speed);
  shaded = max(shaded, vec3(0.0));

  outColor = vec4(shaded * alpha, alpha);
}`;
}
