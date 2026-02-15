#version 300 es
precision mediump float;

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

  // Gentle text-space wobble.
  float wobble = sin((a_pos.x * 10.0) + (u_time * u_speed * 2.5));
  pos.y += wobble * (0.015 * u_intensity);

  gl_Position = vec4(pos, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
  v_uv_bounds = a_uv_bounds;
}
