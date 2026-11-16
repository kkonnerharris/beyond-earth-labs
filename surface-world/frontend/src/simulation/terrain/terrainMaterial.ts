import * as THREE from 'three'

/**
 * Splat-blended terrain material (illustrative textures from Higgsfield):
 *   - regolith on gentle ground, sampled at two scales to hide tiling
 *   - dark dune sand inside the loose-regolith zone
 *   - layered cliff rock on steep slopes, tri-planar so walls don't stretch
 * Blend weights come from a per-vertex `splat` attribute computed from real slope and hazard data, so the
 * look follows the same terrain the planner uses. Vertex colours still multiply in for macro shading.
 *
 * On real terrain an orthoimage (HiRISE, 25 cm/px, averaged to ~0.5 m) is draped over the whole map and
 * becomes the albedo: what you see is the actual ground. HiRISE RED is grayscale, so it is mapped onto a
 * Mars colour ramp for display. The illustrative textures then only add sub-metre grain on top.
 */
export interface TerrainTextures {
  regolith: THREE.Texture; regolithN: THREE.Texture
  sand: THREE.Texture; sandN: THREE.Texture
  cliff: THREE.Texture
  ortho?: THREE.Texture | null
  /** true-colour imagery (Earth): used as-is instead of the grayscale-to-Mars ramp */
  orthoRgb?: boolean
  size?: number
}

export function makeTerrainMaterial(t: TerrainTextures): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 })
  // normalMap enables three's tangent-frame helpers; we sample our own blended normals with them.
  m.normalMap = t.regolithN
  m.normalScale = new THREE.Vector2(1.1, 1.1)
  m.customProgramCacheKey = () => (t.ortho ? (t.orthoRgb ? "terrain-ortho-rgb" : "terrain-ortho") : "terrain-splat")
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tReg: { value: t.regolith }, tRegN: { value: t.regolithN },
      tSand: { value: t.sand }, tSandN: { value: t.sandN },
      tCliff: { value: t.cliff },
      tOrtho: { value: t.ortho ?? null }, uSize: { value: t.size ?? 1 },
    })
    const ortho = !!t.ortho
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tReg; uniform sampler2D tRegN; uniform sampler2D tSand; uniform sampler2D tSandN; uniform sampler2D tCliff;
uniform sampler2D tOrtho; uniform float uSize;
varying vec3 vSplat; varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <map_fragment>', `
vec2 uvTop = vWPos.xz / 9.0;
vec3 cReg = mix(texture2D(tReg, uvTop).rgb, texture2D(tReg, vWPos.xz / 41.0 + vec2(0.37, 0.71)).rgb, 0.35);
vec3 cSand = texture2D(tSand, uvTop * 0.85).rgb;
vec3 bw = pow(abs(normalize(vWNrm)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
vec3 cCliff = texture2D(tCliff, vWPos.zy / 14.0).rgb * bw.x + texture2D(tCliff, vWPos.xz / 14.0).rgb * bw.y + texture2D(tCliff, vWPos.xy / 14.0).rgb * bw.z;
vec3 w = vSplat / max(1e-3, vSplat.x + vSplat.y + vSplat.z);
${ortho ? `
// Real ground: HiRISE orthoimage, north up, covering the map exactly.
vec4 oc = texture2D(tOrtho, vec2(vWPos.x / uSize + 0.5, 0.5 - vWPos.z / uSize));
${t.orthoRgb ? 'vec3 ramp = oc.rgb * 0.87;' : `float g = oc.r;
vec3 ramp = mix(vec3(0.20, 0.11, 0.07), vec3(0.62, 0.38, 0.24), smoothstep(0.0, 0.55, g));
ramp = mix(ramp, vec3(0.93, 0.76, 0.60), smoothstep(0.5, 1.0, g));`}
float fine = dot(texture2D(tReg, uvTop).rgb, vec3(0.333));
float coarse = dot(texture2D(tReg, vWPos.xz / 41.0 + vec2(0.37, 0.71)).rgb, vec3(0.333));
float grain = clamp(fine / max(coarse, 0.05), 0.6, 1.4);
float cl = dot(cCliff, vec3(0.333)) / 0.45;
diffuseColor.rgb *= ramp * mix(1.0, grain, 0.3) * mix(1.0, cl, w.z * 0.35) * 1.15;
` : `diffuseColor.rgb *= cReg * w.x + cSand * w.y + cCliff * w.z;`}
`)
      .replace('#include <normal_fragment_maps>', `
{
  vec3 nReg = texture2D(tRegN, uvTop).xyz * 2.0 - 1.0;
  vec3 nSand = texture2D(tSandN, uvTop * 0.85).xyz * 2.0 - 1.0;
  vec3 mapN = normalize(mix(vec3(0.0, 0.0, 1.0), nReg * w.x + nSand * w.y, 1.0 - w.z));
  mapN.xy *= normalScale;
  mat3 tbn = getTangentFrame( - vViewPosition, normal, uvTop );
  tbn[0] *= faceDirection; tbn[1] *= faceDirection;
  normal = normalize( tbn * mapN );
}
`)
  }
  return m
}

/** Per-vertex splat weights from slope (degrees) and the loose-regolith hazard zones. */
export function computeSplat(n: number, cell: number, size: number, slope: Float32Array,
  sandZones: { x: number; z: number; r: number }[]): Float32Array {
  const out = new Float32Array(n * n * 3)
  const h = size / 2
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j
      const x = j * cell - h, z = i * cell - h
      const cliff = THREE.MathUtils.smoothstep(slope[k], 15, 26)
      let sand = 0
      for (const s of sandZones) sand = Math.max(sand, Math.pow(THREE.MathUtils.clamp(1 - Math.hypot(x - s.x, z - s.z) / (s.r * 0.95), 0, 1), 0.6))
      sand *= 1 - cliff
      out[k * 3] = Math.max(0, 1 - cliff - sand)
      out[k * 3 + 1] = sand
      out[k * 3 + 2] = cliff
    }
  }
  return out
}
