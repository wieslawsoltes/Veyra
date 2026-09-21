import { clamp, finite, normalizedPoints, parseColor, seededNoise, vector3 } from './utils.js';

const luminance = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const smooth = (lo, hi, x) => { const t = clamp((x - lo) / Math.max(1e-8, hi - lo)); return t * t * (3 - 2 * t); };
export const blank = (width, height) => new Uint8ClampedArray(width * height * 4);

/** Premultiplied separable box approximation; radius is measured in output pixels. */
export function blurCPU(input, width, height, radius) {
  const r = Math.round(finite(radius, 0, 0, 64));
  if (!r) return input.slice();
  let src = new Float32Array(input.length), dst = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 4) {
    const a = input[i + 3] / 255;
    src[i] = input[i] * a; src[i + 1] = input[i + 1] * a; src[i + 2] = input[i + 2] * a; src[i + 3] = input[i + 3];
  }
  // Two horizontal/vertical pairs approximate a Gaussian without an O(radius) pixel loop.
  const half = Math.max(1, Math.round(r / 2)), count = half * 2 + 1;
  for (let pass = 0; pass < 4; pass++) {
    const vertical = pass % 2 === 1;
    const lines = vertical ? width : height, length = vertical ? height : width;
    const stride = vertical ? width * 4 : 4;
    for (let line = 0; line < lines; line++) {
      const base = vertical ? line * 4 : line * width * 4;
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let k = -half; k <= half; k++) sum += src[base + clamp(k, 0, length - 1) * stride + channel];
        for (let pos = 0; pos < length; pos++) {
          dst[base + pos * stride + channel] = sum / count;
          sum += src[base + clamp(pos + half + 1, 0, length - 1) * stride + channel] - src[base + clamp(pos - half, 0, length - 1) * stride + channel];
        }
      }
    }
    [src, dst] = [dst, src];
  }
  const out = new Uint8ClampedArray(input.length);
  for (let i = 0; i < out.length; i += 4) {
    const a = src[i + 3]; out[i + 3] = a;
    if (a > 1e-6) { out[i] = src[i] * 255 / a; out[i + 1] = src[i + 1] * 255 / a; out[i + 2] = src[i + 2] * 255 / a; }
  }
  return out;
}
function sample(input, width, height, x, y, out) {
  if (x < -0.5 || y < -0.5 || x > width - 0.5 || y > height - 0.5) { out.fill(0); return; }
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const ax = clamp(x0, 0, width - 1), bx = clamp(x0 + 1, 0, width - 1), ay = clamp(y0, 0, height - 1), by = clamp(y0 + 1, 0, height - 1);
  for (let c = 0; c < 4; c++) out[c] = (input[(ay * width + ax) * 4 + c] * (1 - fx) + input[(ay * width + bx) * 4 + c] * fx) * (1 - fy) + (input[(by * width + ax) * 4 + c] * (1 - fx) + input[(by * width + bx) * 4 + c] * fx) * fy;
}
function polygonMask(points, x, y, feather) {
  if (points.length < 3) return 0;
  let inside = false, distance = Infinity, previous = points.at(-1);
  for (const point of points) {
    const dx = point[0] - previous[0], dy = point[1] - previous[1];
    const t = clamp(((x - previous[0]) * dx + (y - previous[1]) * dy) / Math.max(1e-8, dx * dx + dy * dy));
    distance = Math.min(distance, Math.hypot(x - previous[0] - t * dx, y - previous[1] - t * dy));
    if ((point[1] > y) !== (previous[1] > y) && x < (previous[0] - point[0]) * (y - point[1]) / (previous[1] - point[1]) + point[0]) inside = !inside;
    previous = point;
  }
  return feather > 0 ? smooth(-feather, feather, inside ? distance : -distance) : inside ? 1 : 0;
}
export function mergeCPU(a, b, mode = 'over', mix = 1, mask = null) {
  const out = new Uint8ClampedArray(a.length); mix = finite(mix, 1, 0, 1);
  for (let i = 0; i < a.length; i += 4) {
    const ba = a[i + 3] / 255, fa = b[i + 3] / 255 * mix * (mask ? mask[i + 3] / 255 : 1), alpha = fa + ba * (1 - fa);
    out[i + 3] = alpha * 255;
    if (alpha < 1e-8) continue;
    for (let c = 0; c < 3; c++) {
      const bg = a[i + c] / 255, fg = b[i + c] / 255;
      let blend = fg;
      if (mode === 'screen') blend = 1 - (1 - bg) * (1 - fg);
      else if (mode === 'add') blend = Math.min(1, bg + fg);
      else if (mode === 'multiply') blend = bg * fg;
      out[i + c] = ((1 - fa) * ba * bg + (1 - ba) * fa * fg + ba * fa * blend) / alpha * 255;
    }
  }
  return out;
}
export function applyCPU(type, input, inputB, p, width, height, scale = 1, hasInput = true, mask = null) {
  const a = input || blank(width, height), out = new Uint8ClampedArray(a.length);
  if (type === 'Viewer' || type === 'Source') return a;
  if (type === 'Blur') return blurCPU(a, width, height, finite(p.radius, 8, 0, 256) * scale);
  if (type === 'Merge') return mergeCPU(a, inputB || blank(width, height), p.mode, p.mix ?? p.opacity, mask);
  if (type === 'Glow') {
    const high = new Uint8ClampedArray(a.length), threshold = finite(p.threshold, 0.7, 0, 1), intensity = finite(p.intensity, 1, 0, 16);
    for (let i = 0; i < a.length; i += 4) {
      const mask = smooth(threshold, Math.min(threshold + 0.15, 1.001), luminance(a[i] / 255, a[i + 1] / 255, a[i + 2] / 255));
      for (let c = 0; c < 4; c++) high[i + c] = a[i + c] * mask;
    }
    const blurred = blurCPU(high, width, height, finite(p.radius, 12, 0, 256) * scale);
    for (let i = 0; i < a.length; i += 4) {
      const alpha = blurred[i + 3] / 255;
      for (let c = 0; c < 3; c++) out[i + c] = a[i + c] + blurred[i + c] * alpha * intensity;
      out[i + 3] = Math.max(a[i + 3], blurred[i + 3] * Math.min(intensity, 1));
    }
    return out;
  }
  if (type === 'Transform') {
    const tx = finite(p.x, 0, -8, 8), ty = finite(p.y, 0, -8, 8), s = Math.max(0.0001, Math.abs(finite(p.scale, 1, -100, 100)));
    const angle = finite(p.rotation, 0, -36000, 36000) * Math.PI / 180, c = Math.cos(angle), sn = Math.sin(angle), sampleValue = new Float32Array(4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = x + 0.5 - (0.5 + tx) * width, py = y + 0.5 - (0.5 + ty) * height;
      sample(a, width, height, (c * px + sn * py) / s + width / 2 - 0.5, (-sn * px + c * py) / s + height / 2 - 0.5, sampleValue);
      sampleValue[3] *= finite(p.opacity, 1, 0, 1);
      out.set(sampleValue, (y * width + x) * 4);
    }
    return out;
  }
  const color = parseColor(p.color, type === 'ChromaKey' ? [0, 1, 0, 1] : [0, 0, 0, 1]);
  const exposure = 2 ** finite(p.exposure, 0, -16, 16), gamma = finite(p.gamma, 1, 0.01, 10), contrast = finite(p.contrast, 1, 0, 10), saturation = finite(p.saturation, 1, 0, 10);
  const gain = vector3(p.gain, 1), lift = vector3(p.lift, 0), points = normalizedPoints(p.points), feather = finite(p.feather, 0, 0, 1);
  const tolerance = finite(p.tolerance, 0.2, 0, 2), softness = finite(p.softness, 0.1, 0.00001, 2);
  const amount = finite(p.amount, type === 'Vignette' ? 0.6 : type === 'Sharpen' || type === 'Invert' ? 1 : 0.12, 0, 10), seed = finite(p.seed, 1, 0, 16777215) | 0;
  const crop = [finite(p.x, 0), finite(p.y, 0), finite(p.width, 1, 0, 8), finite(p.height, 1, 0, 8)];
  const suppliedMatrix = Array.isArray(p.matrix) ? p.matrix : [];
  const matrix = Array.from({ length: 20 }, (_, i) => finite(suppliedMatrix.length === 16 ? (i % 5 === 4 ? 0 : suppliedMatrix[Math.floor(i / 5) * 4 + i % 5]) : suppliedMatrix[i], i === 0 || i === 6 || i === 12 || i === 18 ? 1 : 0));
  for (let i = 0; i < a.length; i += 4) {
    const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width), u = (x + 0.5) / width, v = (y + 0.5) / height;
    let r = a[i] / 255, g = a[i + 1] / 255, b = a[i + 2] / 255, alpha = a[i + 3] / 255;
    switch (type) {
      case 'Constant': [r, g, b, alpha] = color; alpha *= finite(p.alpha, 1, 0, 1); break;
      case 'Grade': {
        r = Math.max(0, (r * exposure * gain[0] + lift[0] - 0.18) * contrast + 0.18) ** (1 / gamma);
        g = Math.max(0, (g * exposure * gain[1] + lift[1] - 0.18) * contrast + 0.18) ** (1 / gamma);
        b = Math.max(0, (b * exposure * gain[2] + lift[2] - 0.18) * contrast + 0.18) ** (1 / gamma);
        r = Math.min(r, 65504); g = Math.min(g, 65504); b = Math.min(b, 65504);
        const l = luminance(r, g, b); r = l + (r - l) * saturation; g = l + (g - l) * saturation; b = l + (b - l) * saturation; break;
      }
      case 'ChromaKey': alpha *= smooth(tolerance, tolerance + softness, Math.hypot(r - color[0], g - color[1], b - color[2])); break;
      case 'Roto': { if (!hasInput) { r = g = b = alpha = 1; } const value = polygonMask(points, u, v, feather); alpha *= p.invert ? 1 - value : value; break; }
      case 'Noise': { const n = seededNoise(x, y, seed); if (hasInput) { r += (n - 0.5) * amount; g += (n - 0.5) * amount; b += (n - 0.5) * amount; } else { r = g = b = n * amount; alpha = 1; } break; }
      case 'Vignette': { const factor = 1 - amount * smooth(0.25, 1, Math.hypot(u - 0.5, v - 0.5) * Math.SQRT2); r *= factor; g *= factor; b *= factor; break; }
      case 'Sharpen': {
        const left = (y * width + Math.max(0, x - 1)) * 4, right = (y * width + Math.min(width - 1, x + 1)) * 4, top = (Math.max(0, y - 1) * width + x) * 4, bottom = (Math.min(height - 1, y + 1) * width + x) * 4;
        r += (4 * r - (a[left] + a[right] + a[top] + a[bottom]) / 255) * amount * 0.25;
        g += (4 * g - (a[left + 1] + a[right + 1] + a[top + 1] + a[bottom + 1]) / 255) * amount * 0.25;
        b += (4 * b - (a[left + 2] + a[right + 2] + a[top + 2] + a[bottom + 2]) / 255) * amount * 0.25; break;
      }
      case 'Invert': r += (1 - 2 * r) * clamp(amount); g += (1 - 2 * g) * clamp(amount); b += (1 - 2 * b) * clamp(amount); break;
      case 'Crop': if (u < crop[0] || v < crop[1] || u > crop[0] + crop[2] || v > crop[1] + crop[3]) r = g = b = alpha = 0; break;
      case 'Premultiply': r *= alpha; g *= alpha; b *= alpha; break;
      case 'Unpremultiply': if (alpha > 1e-6) { r /= alpha; g /= alpha; b /= alpha; } else { r = g = b = 0; } break;
      case 'ColorMatrix': {
        const ir = r, ig = g, ib = b, ia = alpha;
        r = ir * matrix[0] + ig * matrix[1] + ib * matrix[2] + ia * matrix[3] + matrix[4];
        g = ir * matrix[5] + ig * matrix[6] + ib * matrix[7] + ia * matrix[8] + matrix[9];
        b = ir * matrix[10] + ig * matrix[11] + ib * matrix[12] + ia * matrix[13] + matrix[14];
        alpha = ir * matrix[15] + ig * matrix[16] + ib * matrix[17] + ia * matrix[18] + matrix[19]; break;
      }
      default: break;
    }
    out[i] = r * 255; out[i + 1] = g * 255; out[i + 2] = b * 255; out[i + 3] = alpha * 255;
  }
  return out;
}
export function viewCPU(input, exposure = 0, gamma = 1, channel = 'rgba') {
  const out = new Uint8ClampedArray(input.length), multiplier = 2 ** finite(exposure, 0, -16, 16), power = 1 / finite(gamma, 1, 0.01, 10);
  for (let i = 0; i < input.length; i += 4) {
    let r = (input[i] / 255 * multiplier) ** power, g = (input[i + 1] / 255 * multiplier) ** power, b = (input[i + 2] / 255 * multiplier) ** power, alpha = input[i + 3] / 255;
    if (channel !== 'rgba' && channel !== 'rgb') {
      const v = channel === 'r' ? r : channel === 'g' ? g : channel === 'b' ? b : channel === 'a' || channel === 'alpha' ? alpha : luminance(r, g, b);
      r = g = b = v; alpha = 1;
    }
    out[i] = r * 255; out[i + 1] = g * 255; out[i + 2] = b * 255; out[i + 3] = alpha * 255;
  }
  return out;
}
