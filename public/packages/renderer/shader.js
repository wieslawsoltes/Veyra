export const OP = Object.freeze({ COPY: 0, CONSTANT: 1, GRADE: 2, BLUR: 3, TRANSFORM: 4, MERGE: 5, KEY: 6, ROTO: 7, HIGH: 8, GLOW: 9, NOISE: 10, VIGNETTE: 11, SHARPEN: 12, INVERT: 13, CROP: 14, PREMULTIPLY: 15, UNPREMULTIPLY: 16, MATRIX: 17, VIEW: 18 });

export const SHADER = /* wgsl */ `
struct Uniforms { p: array<vec4<f32>, 80> };
@group(0) @binding(0) var imageA: texture_2d<f32>;
@group(0) @binding(1) var imageB: texture_2d<f32>;
@group(0) @binding(2) var imageMask: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var<uniform> u: Uniforms;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var result: VertexOutput;
  result.position = vec4<f32>(positions[index], 0.0, 1.0);
  result.uv = positions[index] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  return result;
}
fn a(uv: vec2<f32>) -> vec4<f32> { return textureSampleLevel(imageA, linearSampler, uv, 0.0); }
fn b(uv: vec2<f32>) -> vec4<f32> { return textureSampleLevel(imageB, linearSampler, uv, 0.0); }
fn outside(uv: vec2<f32>) -> bool { return any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)); }
fn luminance(rgb: vec3<f32>) -> f32 { return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722)); }
fn noise(x: u32, y: u32, seed: u32) -> f32 {
  var h = (x + 1u) * 374761393u + (y + 1u) * 668265263u + seed * 1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u; h = h ^ (h >> 16u);
  return f32(h) / 4294967295.0;
}
fn merged(bg: vec4<f32>, fgRaw: vec4<f32>, mode: i32, mixAmount: f32) -> vec4<f32> {
  let fa = clamp(fgRaw.a * mixAmount, 0.0, 1.0); let ba = bg.a;
  let alpha = fa + ba * (1.0 - fa);
  var blend = fgRaw.rgb;
  if (mode == 1) { blend = vec3<f32>(1.0) - (vec3<f32>(1.0) - bg.rgb) * (vec3<f32>(1.0) - fgRaw.rgb); }
  if (mode == 2) { blend = min(vec3<f32>(1.0), bg.rgb + fgRaw.rgb); }
  if (mode == 3) { blend = bg.rgb * fgRaw.rgb; }
  let premul = (1.0 - fa) * ba * bg.rgb + (1.0 - ba) * fa * fgRaw.rgb + ba * fa * blend;
  return vec4<f32>(premul / max(alpha, 0.000001), alpha);
}
@fragment fn fragmentMain(vertex: VertexOutput) -> @location(0) vec4<f32> {
  let uv = vertex.uv; let op = i32(u.p[0].x); let size = u.p[0].yz;
  let v = u.p[1]; var color = a(uv);
  switch op {
    case 1: { color = u.p[3]; }
    case 2: {
      var rgb = color.rgb * exp2(v.x) * u.p[4].rgb + u.p[5].rgb;
      rgb = (rgb - vec3<f32>(0.18)) * v.z + vec3<f32>(0.18);
      rgb = min(pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(1.0 / max(v.y, 0.01))), vec3<f32>(65504.0));
      color = vec4<f32>(mix(vec3<f32>(luminance(rgb)), rgb, v.w), color.a);
    }
    case 3: {
      var total = vec4<f32>(0.0); var weight = 0.0;
      for (var i = -12; i <= 12; i = i + 1) {
        let fi = f32(i); let w = exp(-0.5 * fi * fi / 16.0);
        let c = a(uv + v.yz * (fi * v.x / 12.0) / size);
        total = total + vec4<f32>(c.rgb * c.a, c.a) * w; weight = weight + w;
      }
      total = total / weight;
      color = vec4<f32>(total.rgb / max(total.a, 0.000001), total.a);
    }
    case 4: {
      let pos = (uv - vec2<f32>(0.5) - v.xy) * size;
      let c = cos(v.w); let s = sin(v.w);
      let point = vec2<f32>(c * pos.x + s * pos.y, -s * pos.x + c * pos.y) / max(abs(v.z), 0.0001) / size + vec2<f32>(0.5);
      color = a(point); if (outside(point)) { color = vec4<f32>(0.0); }
      color.a = color.a * u.p[2].x;
    }
    case 5: {
      var mixAmount = v.y;
      if (v.z > 0.5) { mixAmount = mixAmount * textureSampleLevel(imageMask, linearSampler, uv, 0.0).a; }
      color = merged(color, b(uv), i32(v.x), mixAmount);
    }
    case 6: {
      let distance = length(color.rgb - u.p[3].rgb);
      let mask = smoothstep(v.x, v.x + max(v.y, 0.00001), distance);
      color.a = color.a * mask;
    }
    case 7: {
      let count = i32(v.x); var inside = false; var distance = 100.0;
      if (count >= 3) {
        var prev = u.p[16 + count - 1].xy;
        for (var i = 0; i < 64; i = i + 1) {
          if (i >= count) { break; }
          let point = u.p[16 + i].xy;
          let edge = point - prev;
          let t = clamp(dot(uv - prev, edge) / max(dot(edge, edge), 0.00000001), 0.0, 1.0);
          distance = min(distance, length(uv - prev - edge * t));
          if ((point.y > uv.y) != (prev.y > uv.y)) {
            let crossing = (prev.x - point.x) * (uv.y - point.y) / (prev.y - point.y) + point.x;
            if (uv.x < crossing) { inside = !inside; }
          }
          prev = point;
        }
      }
      var mask = select(0.0, 1.0, inside);
      if (v.y > 0.000001 && count >= 3) { mask = smoothstep(-v.y, v.y, select(-distance, distance, inside)); }
      if (v.w > 0.5) { mask = 1.0 - mask; }
      if (v.z < 0.5) { color = vec4<f32>(1.0); }
      color.a = color.a * mask;
    }
    case 8: {
      let mask = smoothstep(v.x, min(v.x + 0.15, 1.001), luminance(color.rgb));
      color = vec4<f32>(color.rgb * mask, color.a * mask);
    }
    case 9: {
      let glow = b(uv);
      color = vec4<f32>(color.rgb + glow.rgb * glow.a * v.x, max(color.a, glow.a * min(v.x, 1.0)));
    }
    case 10: {
      let n = noise(u32(clamp(uv.x * size.x, 0.0, size.x - 1.0)), u32(clamp(uv.y * size.y, 0.0, size.y - 1.0)), u32(v.x));
      if (v.z < 0.5) { color = vec4<f32>(vec3<f32>(n * v.y), 1.0); }
      else { color = vec4<f32>(color.rgb + vec3<f32>((n - 0.5) * v.y), color.a); }
    }
    case 11: {
      let d = length((uv - vec2<f32>(0.5)) * 1.41421356);
      color = vec4<f32>(color.rgb * (1.0 - v.x * smoothstep(0.25, 1.0, d)), color.a);
    }
    case 12: {
      let px = vec2<f32>(1.0 / size.x, 0.0); let py = vec2<f32>(0.0, 1.0 / size.y);
      let neighbor = a(uv + px).rgb + a(uv - px).rgb + a(uv + py).rgb + a(uv - py).rgb;
      color = vec4<f32>(color.rgb + (color.rgb * 4.0 - neighbor) * v.x * 0.25, color.a);
    }
    case 13: { color = vec4<f32>(mix(color.rgb, vec3<f32>(1.0) - color.rgb, v.x), color.a); }
    case 14: {
      if (uv.x < v.x || uv.y < v.y || uv.x > v.x + v.z || uv.y > v.y + v.w) { color = vec4<f32>(0.0); }
    }
    case 15: { color = vec4<f32>(color.rgb * color.a, color.a); }
    case 16: { color = vec4<f32>(color.rgb / max(color.a, 0.000001), color.a); }
    case 17: {
      color = vec4<f32>(dot(color, u.p[6]), dot(color, u.p[7]), dot(color, u.p[8]), dot(color, u.p[9])) + u.p[10];
    }
    case 18: {
      color = vec4<f32>(pow(max(color.rgb * exp2(v.x), vec3<f32>(0.0)), vec3<f32>(1.0 / max(v.y, 0.01))), color.a);
      let channel = i32(v.z);
      if (channel == 1) { color = vec4<f32>(vec3<f32>(color.r), 1.0); }
      if (channel == 2) { color = vec4<f32>(vec3<f32>(color.g), 1.0); }
      if (channel == 3) { color = vec4<f32>(vec3<f32>(color.b), 1.0); }
      if (channel == 4) { color = vec4<f32>(vec3<f32>(color.a), 1.0); }
      if (channel == 5) { color = vec4<f32>(vec3<f32>(luminance(color.rgb)), 1.0); }
    }
    default: {}
  }
  color = clamp(color, vec4<f32>(0.0), vec4<f32>(1.0));
  if (u.p[0].w > 0.5) { color = vec4<f32>(color.rgb * color.a, color.a); }
  return color;
}
`;
