#version 300 es
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

void main() {
  vec2 uvSpan = max(v_uv_bounds.zw - v_uv_bounds.xy, vec2(1e-6));
  vec2 localUV = (v_uv - v_uv_bounds.xy) / uvSpan;

  // Local glyph ripple (deforms letterforms directly).
  vec2 warpedLocalUV = localUV;
  warpedLocalUV.x += sin((localUV.y * 20.0) + (u_time * u_speed * 5.0)) * (0.08 * u_intensity);
  warpedLocalUV = clamp(warpedLocalUV, vec2(0.0), vec2(1.0));

  vec2 warpedUV = v_uv_bounds.xy + warpedLocalUV * uvSpan;
  vec4 texel = texture(u_tex, warpedUV);

  float alpha = texel.a * v_color.a;
  if (alpha <= 0.00001) {
    discard;
  }

  vec2 p = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
  float shine = 0.5 + 0.5 * sin((p.x * 12.0) + (u_time * u_speed * 2.0));
  vec3 tint = mix(v_color.rgb, vec3(1.0, 0.55, 0.22), shine * 0.45 * u_intensity);

  outColor = vec4(tint * alpha, alpha);
}
