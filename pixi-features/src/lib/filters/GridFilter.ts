import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'

const DEFAULT_GRID_PX = 50.0

const GRID_FRAG = `
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform mat3  uWorldMatrix;
uniform float uGridPx;
uniform float uZoom;

void main() {
  vec2 screenPx = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 worldP   = (uWorldMatrix * vec3(screenPx, 1.0)).xy;

  // Analytical derivative: 1 world-unit / uGridPx grid-units per screen pixel.
  // Equivalent to fwidth() for axis-aligned uniform-scale grid, without needing
  // GL_OES_standard_derivatives.
  float minorPxPerCell = uZoom * uGridPx;
  float majorPxPerCell = uZoom * uGridPx * 5.0;
  vec2 minorDeriv = vec2(1.0 / minorPxPerCell);
  vec2 majorDeriv = vec2(1.0 / majorPxPerCell);

  // Minor grid
  vec2 minorCoord = worldP / uGridPx;
  vec2 minorGrid  = abs(fract(minorCoord - 0.5) - 0.5) / minorDeriv;
  float minorLine = 1.0 - min(min(minorGrid.x, minorGrid.y), 1.0);

  // Major grid (every 5 minor cells)
  vec2 majorCoord = worldP / (uGridPx * 5.0);
  vec2 majorGrid  = abs(fract(majorCoord - 0.5) - 0.5) / majorDeriv;
  float majorLine = 1.0 - min(min(majorGrid.x, majorGrid.y), 1.0);

  // Fade minor lines when zoomed out (< 8 screen px between lines)
  float minorFade = clamp((minorPxPerCell - 4.0) / 8.0, 0.0, 1.0);

  float alpha = max(minorLine * 0.5 * minorFade, majorLine * 0.85);
  vec3  col   = mix(vec3(0.165), vec3(0.23), majorLine);
  finalColor  = vec4(col * alpha, alpha);
}
`

export class GridFilter extends Filter {
  constructor() {
    const gridUniforms = new UniformGroup({
      uWorldMatrix: { value: new Float32Array([1,0,0, 0,1,0, 0,0,1]), type: 'mat3x3<f32>' },
      uGridPx:      { value: DEFAULT_GRID_PX,                          type: 'f32' },
      uZoom:        { value: 1.0,                                       type: 'f32' },
    })
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: GRID_FRAG }),
      resources: { gridUniforms },
    })
  }
}
