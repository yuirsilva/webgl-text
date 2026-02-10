# WebGL Text Renderer (DOM-Exact Layout)

A WebGL2 text renderer that uses browser layout as the source of truth.

The DOM computes line breaks and glyph placement, then WebGL renders the glyphs at those exact positions. This project is focused on Latin text (ASCII + Latin-1 range) and `div`-based content.

## Highlights

- Browser-driven layout fidelity using `Range.getClientRects()`
- Per-glyph atlas rendering with WebGL2
- Shader presets + custom effect snippets (`warpBody`, `shadeBody`)
- Full raw shader support (vertex + fragment)
  - from string
  - from external `.glsl` files
- TypeScript modular architecture

## Project Structure

- `src/main.ts`: interactive demo logic for `index.html`
- `src/example.ts`: minimal WebGL-only example for `example.html`
- `src/webglTextRenderer.ts`: renderer core and shader registration APIs
- `src/domTextLayout.ts`: browser layout extraction and metrics
- `src/glyphAtlas.ts`: glyph rasterization and atlas management
- `src/shaderSource.ts`: default vertex/fragment generator + built-in effects
- `src/types.ts`: shared types
- `src/utils.ts`: utilities
- `shaders/custom.vertex.glsl`: sample full custom vertex shader
- `shaders/custom.fragment.glsl`: sample full custom fragment shader
- `index.html`: full controls demo
- `example.html`: WebGL-only demo (DOM text hidden)

## Requirements

- Node.js 18+
- Browser with WebGL2 support

## Install and Build

```bash
npm install
npm run build
```

For continuous compile:

```bash
npm run watch
```

## Run Demos

Serve the project with a local HTTP server (do not use `file://` for module/shader fetch workflows):

```bash
python3 -m http.server 4173
```

Then open:

- `http://localhost:4173/index.html`
- `http://localhost:4173/example.html`

## Shader APIs

### 1. High-level effect snippets (recommended)

```ts
renderer.registerShaderProgram("myFx", {
  warpBody: `
    vec2 p = fragCoord / max(resolution, vec2(1.0));
    float n = noise2(p * 20.0 + vec2(time * speed, 0.0));
    return localUV + (vec2(n) - 0.5) * 0.15 * intensity;
  `,
  shadeBody: `
    return mix(baseColor, vec3(1.0, 0.45, 0.2), 0.35 * intensity);
  `
});
```

This plugs into the internal shader template and keeps compatibility with renderer uniforms/attributes.

### 2. Full raw shaders from strings

```ts
renderer.registerRawShaderProgramFromSource("rawString", {
  vertexSource: "#version 300 es ...",
  fragmentSource: "#version 300 es ..."
});
```

### 3. Full raw shaders from files

```ts
await renderer.registerRawShaderProgramFromFiles("rawFile", {
  vertexUrl: "./shaders/custom.vertex.glsl",
  fragmentUrl: "./shaders/custom.fragment.glsl"
});
```

`src/example.ts` includes a working file-based setup with string fallback.

## Raw Shader Contract

If you provide full raw shaders, keep this interface:

### Vertex attributes

- `layout(location = 0) in vec2 a_pos;`
- `layout(location = 1) in vec2 a_uv;`
- `layout(location = 2) in vec4 a_color;`
- `layout(location = 3) in vec4 a_uv_bounds;`

### Expected uniforms

- `uniform sampler2D u_tex;`
- `uniform vec2 u_resolution;`
- `uniform float u_time;`
- `uniform float u_intensity;`
- `uniform float u_speed;`

### Output

- Fragment shader must write `out vec4 outColor;`
- Output should be premultiplied-alpha compatible (`vec4(rgb * alpha, alpha)`) for current blend mode

## Important Notes

- Latin-only scope: characters outside `\u0020-\u007E` and `\u00A0-\u00FF` are replaced with `?`
- `example.html` hides the source DOM text layer (`opacity: 0`, `user-select: none`) and renders WebGL output only
- Font loading changes trigger geometry refresh through `document.fonts` listeners

## Troubleshooting

- If text appears too small: verify font settings and rebuild (`npm run build`)
- If custom file shaders fail: confirm paths and that you are running from `http://...`, not `file://`
- If shader compile/link fails: open browser console for GLSL error messages
