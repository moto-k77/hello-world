export interface ROI {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawColorStats {
  // Top 10% brightest pixels averaged
  rgb: { r: number; g: number; b: number };
  hsv: { h: number; s: number; v: number }; // H: 0-360, S/V: 0-100
  ycbcr: { y: number; cb: number; cr: number }; // 0-255
  peakLum: number;
  // Mean luminance of the top-10% brightest band (see extractTopPixels) — more robust than
  // peakLum against a single saturated pixel dominating the reading. Used by video mode's
  // baseline-relative classification; photo-mode UIs are unaffected since they only read the
  // fields they already used.
  topLum: number;
  pixelCount: number;
}

export type Verdict = 'lit-strong' | 'lit-normal' | 'lit-weak' | 'unlit';
export type LampColor = '赤' | '橙' | '白' | '黄' | '不明';

export interface MethodResult {
  method: 'RGB' | 'HSV' | 'YCbCr' | 'Claude AI';
  verdict: Verdict;
  color: LampColor | null; // null when unlit
  reasoning: string;
}

export interface FullAnalysis {
  stats: RawColorStats;
  predictions: MethodResult[];
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max * 100;
  const s = max === 0 ? 0 : (d / max) * 100;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
}

function rgbToYcbcr(r: number, g: number, b: number): { y: number; cb: number; cr: number } {
  const y  =  0.299 * r + 0.587 * g + 0.114 * b;
  const cb = -0.169 * r - 0.331 * g + 0.500 * b + 128;
  const cr =  0.500 * r - 0.419 * g - 0.081 * b + 128;
  return { y: Math.round(y), cb: Math.round(cb), cr: Math.round(cr) };
}

function extractTopPixels(pixels: Uint8ClampedArray) {
  const entries: { lum: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    entries.push({ lum: r * 0.299 + g * 0.587 + b * 0.114, r, g, b });
  }
  entries.sort((a, b) => b.lum - a.lum);
  const topN = Math.max(1, Math.floor(entries.length * 0.1));
  const top = entries.slice(0, topN);

  // A strongly lit lamp often saturates the camera sensor: its brightest pixels clip to
  // near-white regardless of the lamp's real color, losing hue information. For color
  // detection, prefer saturated (non-clipped) pixels from a wider bright band instead of
  // the raw brightest ones. Peak luminance (for intensity) is unaffected by this.
  const bandN = Math.max(1, Math.floor(entries.length * 0.4));
  const band = entries.slice(0, bandN);
  const colorful = band.filter(p => {
    const mx = Math.max(p.r, p.g, p.b), mn = Math.min(p.r, p.g, p.b);
    const clipped = mn > 235;
    return !clipped && mx - mn > 25;
  });
  const useColorful = colorful.length >= Math.max(3, Math.floor(band.length * 0.02));
  const colorSource = useColorful ? colorful : top;
  const colorTopN = Math.max(1, Math.floor(colorSource.length * 0.25));
  const colorTop = useColorful
    ? [...colorSource].sort((a, b) => b.lum - a.lum).slice(0, colorTopN)
    : colorSource;

  const avgR = colorTop.reduce((s, p) => s + p.r, 0) / colorTop.length;
  const avgG = colorTop.reduce((s, p) => s + p.g, 0) / colorTop.length;
  const avgB = colorTop.reduce((s, p) => s + p.b, 0) / colorTop.length;
  // topLum: mean luminance of the top-10% brightest band, as opposed to peakLum (the single
  // brightest pixel). A single ROI pixel can be a specular glint (e.g. light reflecting off
  // plastic wrap on an unlit lamp housing) that's already near-white regardless of the lamp's
  // real state, leaving peakLum almost no headroom before the sensor clips at 255 once the lamp
  // actually lights up. Averaging over a small top band is far less dominated by one hot pixel
  // and tracks how much of the ROI is actually bright, giving video mode's baseline-relative
  // classification (see videoAnalysis.ts) a usable signal even when peakLum itself is saturated
  // in both the lit and unlit states.
  const topLum = top.reduce((s, p) => s + p.lum, 0) / top.length;
  return { r: avgR, g: avgG, b: avgB, peakLum: entries[0].lum, topLum, pixelCount: entries.length };
}

export function verdictFromLum(lum: number, thresh: number): Verdict {
  if (lum < thresh) return 'unlit';
  if (lum > thresh + 80) return 'lit-strong';
  if (lum > thresh + 30) return 'lit-normal';
  return 'lit-weak';
}

function predictRGB(stats: RawColorStats): MethodResult {
  const { r, g, b } = stats.rgb;
  const lum = stats.peakLum;

  if (r > g * 1.8 && r > b * 1.8 && r > 130) {
    return { method: 'RGB', verdict: verdictFromLum(lum, 120), color: '赤', reasoning: `R優位(R=${r.toFixed(0)} G=${g.toFixed(0)} B=${b.toFixed(0)})` };
  }
  if (r > 100 && g > 40 && b < r * 0.6 && r > g * 1.2) {
    return { method: 'RGB', verdict: verdictFromLum(lum, 110), color: '橙', reasoning: `橙色(R=${r.toFixed(0)} G=${g.toFixed(0)} B=${b.toFixed(0)})` };
  }
  if (r > 100 && g > 100 && b > 80 && lum > 130) {
    return { method: 'RGB', verdict: verdictFromLum(lum, 130), color: '白', reasoning: `白色(R=${r.toFixed(0)} G=${g.toFixed(0)} B=${b.toFixed(0)})` };
  }
  return { method: 'RGB', verdict: 'unlit', color: null, reasoning: `色優位なし(R=${r.toFixed(0)} G=${g.toFixed(0)} B=${b.toFixed(0)})` };
}

function predictHSV(stats: RawColorStats): MethodResult {
  const { h, s, v } = stats.hsv;
  const lum = stats.peakLum;

  if ((h < 15 || h > 345) && s > 35 && v > 45) {
    return { method: 'HSV', verdict: verdictFromLum(lum, 120), color: '赤', reasoning: `赤色相(H=${h}° S=${s}% V=${v}%)` };
  }
  if (h >= 15 && h <= 45 && s > 35 && v > 45) {
    return { method: 'HSV', verdict: verdictFromLum(lum, 110), color: '橙', reasoning: `橙色相(H=${h}° S=${s}% V=${v}%)` };
  }
  if (h > 45 && h <= 65 && s > 35 && v > 60) {
    return { method: 'HSV', verdict: verdictFromLum(lum, 130), color: '黄', reasoning: `黄色相(H=${h}° S=${s}% V=${v}%)` };
  }
  if (s < 25 && v > 65) {
    return { method: 'HSV', verdict: verdictFromLum(lum, 130), color: '白', reasoning: `白色(低彩度 S=${s}% V=${v}%)` };
  }
  return { method: 'HSV', verdict: 'unlit', color: null, reasoning: `ランプ色なし(H=${h}° S=${s}% V=${v}%)` };
}

function predictYCbCr(stats: RawColorStats): MethodResult {
  const { y, cb, cr } = stats.ycbcr;
  const lum = stats.peakLum;

  if (cr > 148 && cb < 120 && y > 60) {
    return { method: 'YCbCr', verdict: verdictFromLum(lum, 120), color: '赤', reasoning: `赤(Y=${y} Cb=${cb} Cr=${cr})` };
  }
  if (cr > 135 && cb < 130 && y > 80) {
    return { method: 'YCbCr', verdict: verdictFromLum(lum, 110), color: '橙', reasoning: `橙(Y=${y} Cb=${cb} Cr=${cr})` };
  }
  if (y > 150 && Math.abs(cb - 128) < 20 && Math.abs(cr - 128) < 20) {
    return { method: 'YCbCr', verdict: verdictFromLum(lum, 130), color: '白', reasoning: `白(Y=${y} Cb=${cb} Cr=${cr})` };
  }
  return { method: 'YCbCr', verdict: 'unlit', color: null, reasoning: `ランプ色なし(Y=${y} Cb=${cb} Cr=${cr})` };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Analyze a ROI on an already-drawn canvas (e.g. a decoded photo, or one of many sampled
// video frames). Factored out of analyzeROI() so callers that already have pixel data in a
// canvas (video frame sampling) don't need to re-encode/re-decode a data URL per frame per ROI.
export function analyzeCanvasRegion(canvas: HTMLCanvasElement, roi: ROI): FullAnalysis {
  const x = Math.max(0, Math.round(roi.x));
  const y = Math.max(0, Math.round(roi.y));
  const w = Math.min(Math.round(roi.width),  canvas.width  - x);
  const h = Math.min(Math.round(roi.height), canvas.height - y);

  if (w <= 0 || h <= 0) throw new Error('ROIが画像範囲外です');

  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(x, y, w, h);
  const { r, g, b, peakLum, topLum, pixelCount } = extractTopPixels(data);

  const stats: RawColorStats = {
    rgb: { r, g, b },
    hsv: rgbToHsv(r, g, b),
    ycbcr: rgbToYcbcr(r, g, b),
    peakLum,
    topLum,
    pixelCount,
  };

  return {
    stats,
    predictions: [predictRGB(stats), predictHSV(stats), predictYCbCr(stats)],
  };
}

export async function analyzeROI(imageDataUrl: string, roi: ROI): Promise<FullAnalysis> {
  const img = await loadImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return analyzeCanvasRegion(canvas, roi);
}
