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
  pixelCount: number;
}

export type Verdict = 'lit-strong' | 'lit-normal' | 'lit-weak' | 'unlit';

export interface MethodResult {
  method: 'RGB' | 'HSV' | 'YCbCr';
  verdict: Verdict;
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
  const avgR = top.reduce((s, p) => s + p.r, 0) / topN;
  const avgG = top.reduce((s, p) => s + p.g, 0) / topN;
  const avgB = top.reduce((s, p) => s + p.b, 0) / topN;
  return { r: avgR, g: avgG, b: avgB, peakLum: entries[0].lum, pixelCount: entries.length };
}

function verdictFromLum(lum: number, thresh: number): Verdict {
  if (lum < thresh) return 'unlit';
  if (lum > thresh + 80) return 'lit-strong';
  if (lum > thresh + 30) return 'lit-normal';
  return 'lit-weak';
}

function predictRGB(stats: RawColorStats): MethodResult {
  const { r, g, b } = stats.rgb;
  const lum = stats.peakLum;

  // Red dominant (tail/brake)
  if (r > g * 1.8 && r > b * 1.8 && r > 130) {
    return { method: 'RGB', verdict: verdictFromLum(lum, 120), reasoning: `R優位(R=${r.toFixed(0)} G=${g.toFixed(0)} B=${b.toFixed(0)})` };
  }
  // Amber (winker)
  if (r > 100 && g > 40 && b < r * 0.6 && r > g * 1.2) {
    return { method: 'RGB', verdict: verdictFromLum(lum, 110), reasoning: `橙色(R=${r.toFixed(0)} G=${g.toFixed(0)} B=${b.toFixed(0)})` };
  }
  // White (reverse)
  if (r > 100 && g > 100 && b > 80 && lum > 130) {
    return { method: 'RGB', verdict: verdictFromLum(lum, 130), reasoning: `白色(R=${r.toFixed(0)} G=${g.toFixed(0)} B=${b.toFixed(0)})` };
  }
  return { method: 'RGB', verdict: 'unlit', reasoning: `色優位なし(R=${r.toFixed(0)} G=${g.toFixed(0)} B=${b.toFixed(0)})` };
}

function predictHSV(stats: RawColorStats): MethodResult {
  const { h, s, v } = stats.hsv;
  const lum = stats.peakLum;

  // Red: H < 15 or H > 345, needs saturation
  if ((h < 15 || h > 345) && s > 35 && v > 45) {
    return { method: 'HSV', verdict: verdictFromLum(lum, 120), reasoning: `赤色相(H=${h}° S=${s}% V=${v}%)` };
  }
  // Amber/Orange: H 15-40
  if (h >= 15 && h <= 45 && s > 35 && v > 45) {
    return { method: 'HSV', verdict: verdictFromLum(lum, 110), reasoning: `橙色相(H=${h}° S=${s}% V=${v}%)` };
  }
  // Yellow: H 45-65 (can appear in strong tail/brake)
  if (h > 45 && h <= 65 && s > 35 && v > 60) {
    return { method: 'HSV', verdict: verdictFromLum(lum, 130), reasoning: `黄色相(H=${h}° S=${s}% V=${v}%)` };
  }
  // White: low saturation, high value
  if (s < 25 && v > 65) {
    return { method: 'HSV', verdict: verdictFromLum(lum, 130), reasoning: `白色(低彩度 S=${s}% V=${v}%)` };
  }
  return { method: 'HSV', verdict: 'unlit', reasoning: `ランプ色なし(H=${h}° S=${s}% V=${v}%)` };
}

function predictYCbCr(stats: RawColorStats): MethodResult {
  const { y, cb, cr } = stats.ycbcr;
  const lum = stats.peakLum;

  // Red: high Cr, low Cb
  if (cr > 148 && cb < 120 && y > 60) {
    return { method: 'YCbCr', verdict: verdictFromLum(lum, 120), reasoning: `赤(Y=${y} Cb=${cb} Cr=${cr})` };
  }
  // Amber/Orange: high Cr, moderate Cb
  if (cr > 135 && cb < 130 && y > 80) {
    return { method: 'YCbCr', verdict: verdictFromLum(lum, 110), reasoning: `橙(Y=${y} Cb=${cb} Cr=${cr})` };
  }
  // White: high Y, Cb/Cr near 128
  if (y > 150 && Math.abs(cb - 128) < 20 && Math.abs(cr - 128) < 20) {
    return { method: 'YCbCr', verdict: verdictFromLum(lum, 130), reasoning: `白(Y=${y} Cb=${cb} Cr=${cr})` };
  }
  return { method: 'YCbCr', verdict: 'unlit', reasoning: `ランプ色なし(Y=${y} Cb=${cb} Cr=${cr})` };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function analyzeROI(imageDataUrl: string, roi: ROI): Promise<FullAnalysis> {
  const img = await loadImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const x = Math.max(0, Math.round(roi.x));
  const y = Math.max(0, Math.round(roi.y));
  const w = Math.min(Math.round(roi.width),  img.naturalWidth  - x);
  const h = Math.min(Math.round(roi.height), img.naturalHeight - y);

  if (w <= 0 || h <= 0) throw new Error('ROIが画像範囲外です');

  const { data } = ctx.getImageData(x, y, w, h);
  const { r, g, b, peakLum, pixelCount } = extractTopPixels(data);

  const stats: RawColorStats = {
    rgb: { r, g, b },
    hsv: rgbToHsv(r, g, b),
    ycbcr: rgbToYcbcr(r, g, b),
    peakLum,
    pixelCount,
  };

  return {
    stats,
    predictions: [predictRGB(stats), predictHSV(stats), predictYCbCr(stats)],
  };
}
