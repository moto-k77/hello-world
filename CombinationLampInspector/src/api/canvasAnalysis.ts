import type { LampId } from '../types';

export interface AnalysisResult {
  isLit: boolean;
  confidence: 'high' | 'medium' | 'low';
  comment: string;
}

export interface ROI {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

interface PixelStats {
  peakLum: number;
  avgTopR: number;
  avgTopG: number;
  avgTopB: number;
}

function extractPixelStats(pixels: Uint8ClampedArray): PixelStats {
  const entries: { lum: number; r: number; g: number; b: number }[] = [];

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    entries.push({ lum, r, g, b });
  }

  entries.sort((a, b) => b.lum - a.lum);

  // Analyze top 10% brightest pixels (lamp filament / LED hot spot)
  const topN = Math.max(1, Math.floor(entries.length * 0.1));
  const top = entries.slice(0, topN);
  const avgTopR = top.reduce((s, p) => s + p.r, 0) / topN;
  const avgTopG = top.reduce((s, p) => s + p.g, 0) / topN;
  const avgTopB = top.reduce((s, p) => s + p.b, 0) / topN;

  return { peakLum: entries[0].lum, avgTopR, avgTopG, avgTopB };
}

function evaluateLamp(lampId: LampId, stats: PixelStats): AnalysisResult {
  const { peakLum, avgTopR, avgTopG, avgTopB } = stats;

  // Confidence based on peak luminance separation from threshold
  function confidence(peak: number, litThresh: number): 'high' | 'medium' | 'low' {
    const margin = Math.abs(peak - litThresh);
    if (margin > 40) return 'high';
    if (margin > 15) return 'medium';
    return 'low';
  }

  switch (lampId) {
    case 'tail':
    case 'brake': {
      // Red light: R dominant, peak luminance high
      const LIT_THRESH = 110;
      const redDominant = avgTopR > avgTopG * 1.4 && avgTopR > avgTopB * 1.4;
      const isLit = peakLum > LIT_THRESH && avgTopR > 100;
      const conf = redDominant && peakLum > LIT_THRESH + 20 ? 'high' : confidence(peakLum, LIT_THRESH);
      return {
        isLit,
        confidence: conf,
        comment: isLit
          ? `赤色の輝点を検出（ピーク輝度 ${peakLum.toFixed(0)}、R=${avgTopR.toFixed(0)}）`
          : `輝点が不十分（ピーク輝度 ${peakLum.toFixed(0)}、消灯の可能性）`,
      };
    }

    case 'winker_left':
    case 'winker_right': {
      // Amber/orange: high R, medium G, low B
      const LIT_THRESH = 110;
      const amberColor = avgTopR > 100 && avgTopG > 40 && avgTopB < avgTopR * 0.6;
      const isLit = peakLum > LIT_THRESH && amberColor;
      return {
        isLit,
        confidence: isLit && peakLum > LIT_THRESH + 30 ? 'high' : confidence(peakLum, LIT_THRESH),
        comment: isLit
          ? `橙色の輝点を検出（ピーク輝度 ${peakLum.toFixed(0)}、R=${avgTopR.toFixed(0)} G=${avgTopG.toFixed(0)}）`
          : `橙色輝点が不十分（ピーク輝度 ${peakLum.toFixed(0)}、消灯の可能性）`,
      };
    }

    case 'reverse': {
      // White light: all channels high
      const LIT_THRESH = 130;
      const whiteColor = avgTopR > 100 && avgTopG > 100 && avgTopB > 80;
      const isLit = peakLum > LIT_THRESH && whiteColor;
      return {
        isLit,
        confidence: isLit && peakLum > LIT_THRESH + 30 ? 'high' : confidence(peakLum, LIT_THRESH),
        comment: isLit
          ? `白色の輝点を検出（ピーク輝度 ${peakLum.toFixed(0)}）`
          : `白色輝点が不十分（ピーク輝度 ${peakLum.toFixed(0)}、消灯の可能性）`,
      };
    }

    default:
      return { isLit: false, confidence: 'low', comment: '未知のランプ種別' };
  }
}

export async function analyzeLampImage(
  imageDataUrl: string,
  lampId: LampId,
  roi: ROI
): Promise<AnalysisResult> {
  const img = await loadImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0);

  const clampedRoi = {
    x: Math.max(0, Math.round(roi.x)),
    y: Math.max(0, Math.round(roi.y)),
    width: Math.min(Math.round(roi.width), img.naturalWidth - Math.round(roi.x)),
    height: Math.min(Math.round(roi.height), img.naturalHeight - Math.round(roi.y)),
  };

  if (clampedRoi.width <= 0 || clampedRoi.height <= 0) {
    throw new Error('ROI が画像範囲外です。撮り直してください');
  }

  const imageData = ctx.getImageData(
    clampedRoi.x,
    clampedRoi.y,
    clampedRoi.width,
    clampedRoi.height,
  );

  const stats = extractPixelStats(imageData.data);
  return evaluateLamp(lampId, stats);
}
