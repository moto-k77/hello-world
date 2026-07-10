import type { ROI } from './colorAnalysis';

export interface DiffCandidate {
  roi: ROI;
  intensity: number;
}

interface GrayFrame {
  data: Float32Array;
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

function drawGray(img: HTMLImageElement, width: number, height: number): GrayFrame {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  return { data: gray, width, height };
}

function sad(base: GrayFrame, lit: GrayFrame, dx: number, dy: number): number {
  const { width, height } = base;
  let sum = 0, count = 0;
  for (let y = 0; y < height; y++) {
    const ly = y + dy;
    if (ly < 0 || ly >= height) continue;
    for (let x = 0; x < width; x++) {
      const lx = x + dx;
      if (lx < 0 || lx >= width) continue;
      sum += Math.abs(base.data[y * width + x] - lit.data[ly * width + lx]);
      count++;
    }
  }
  return count === 0 ? Infinity : sum / count;
}

// Coarse block-matching search for the (dx, dy) translation that best aligns lit onto base.
function findBestOffset(base: GrayFrame, lit: GrayFrame, range: number): { dx: number; dy: number } {
  let best = { dx: 0, dy: 0, score: Infinity };
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const score = sad(base, lit, dx, dy);
      if (score < best.score) best = { dx, dy, score };
    }
  }
  return { dx: best.dx, dy: best.dy };
}

class UnionFind {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a: number): number {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]];
      a = this.parent[a];
    }
    return a;
  }
  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function clampROI(roi: ROI, fullWidth: number, fullHeight: number): ROI {
  const minSize = Math.min(fullWidth, fullHeight) * 0.06;
  let { x, y, width, height } = roi;
  width = Math.max(width, minSize);
  height = Math.max(height, minSize);
  x = Math.max(0, Math.min(x, fullWidth - width));
  y = Math.max(0, Math.min(y, fullHeight - height));
  width = Math.min(width, fullWidth - x);
  height = Math.min(height, fullHeight - y);
  return { x, y, width, height };
}

// Compares a "lights off" and a "lights on" photo of the same scene, tolerating handheld
// camera drift between the two shots, and returns bounding boxes of regions that got brighter.
export async function detectDiffRegions(
  baseImageDataUrl: string,
  litImageDataUrl: string,
): Promise<DiffCandidate[]> {
  const [baseImg, litImg] = await Promise.all([
    loadImage(baseImageDataUrl),
    loadImage(litImageDataUrl),
  ]);
  const fullWidth = baseImg.naturalWidth;
  const fullHeight = baseImg.naturalHeight;

  // Step 1: estimate handshake offset at low resolution (cheap search, generous tolerance).
  const ALIGN_W = 80;
  const ALIGN_H = Math.max(1, Math.round((80 * fullHeight) / fullWidth));
  const baseAlign = drawGray(baseImg, ALIGN_W, ALIGN_H);
  const litAlign = drawGray(litImg, ALIGN_W, ALIGN_H);
  const { dx: dxAlign, dy: dyAlign } = findBestOffset(baseAlign, litAlign, 10);

  // Step 2: diff at a slightly higher resolution, shifted by the estimated offset.
  const DIFF_W = 160;
  const DIFF_H = Math.max(1, Math.round((160 * fullHeight) / fullWidth));
  const scaleAlignToDiff = DIFF_W / ALIGN_W;
  const dx = Math.round(dxAlign * scaleAlignToDiff);
  const dy = Math.round(dyAlign * scaleAlignToDiff);

  const baseDiff = drawGray(baseImg, DIFF_W, DIFF_H);
  const litDiff = drawGray(litImg, DIFF_W, DIFF_H);

  const THRESHOLD = 35;
  const mask = new Uint8Array(DIFF_W * DIFF_H);
  const deltas = new Float32Array(DIFF_W * DIFF_H);
  for (let y = 0; y < DIFF_H; y++) {
    const ly = y + dy;
    if (ly < 0 || ly >= DIFF_H) continue;
    for (let x = 0; x < DIFF_W; x++) {
      const lx = x + dx;
      if (lx < 0 || lx >= DIFF_W) continue;
      const delta = litDiff.data[ly * DIFF_W + lx] - baseDiff.data[y * DIFF_W + x];
      if (delta > THRESHOLD) {
        mask[y * DIFF_W + x] = 1;
        deltas[y * DIFF_W + x] = delta;
      }
    }
  }

  // Step 3: connected components to group bright pixels into blob candidates.
  const uf = new UnionFind(DIFF_W * DIFF_H);
  for (let y = 0; y < DIFF_H; y++) {
    for (let x = 0; x < DIFF_W; x++) {
      const idx = y * DIFF_W + x;
      if (!mask[idx]) continue;
      if (x + 1 < DIFF_W && mask[idx + 1]) uf.union(idx, idx + 1);
      if (y + 1 < DIFF_H && mask[idx + DIFF_W]) uf.union(idx, idx + DIFF_W);
    }
  }

  const groups = new Map<number, { minX: number; maxX: number; minY: number; maxY: number; sum: number; count: number }>();
  for (let y = 0; y < DIFF_H; y++) {
    for (let x = 0; x < DIFF_W; x++) {
      const idx = y * DIFF_W + x;
      if (!mask[idx]) continue;
      const root = uf.find(idx);
      let g = groups.get(root);
      if (!g) {
        g = { minX: x, maxX: x, minY: y, maxY: y, sum: 0, count: 0 };
        groups.set(root, g);
      }
      g.minX = Math.min(g.minX, x);
      g.maxX = Math.max(g.maxX, x);
      g.minY = Math.min(g.minY, y);
      g.maxY = Math.max(g.maxY, y);
      g.sum += deltas[idx];
      g.count++;
    }
  }

  const MIN_BLOB_PIXELS = 4;
  const scaleX = fullWidth / DIFF_W;
  const scaleY = fullHeight / DIFF_H;
  const PAD = 1.6;

  const candidates: DiffCandidate[] = [];
  for (const g of groups.values()) {
    if (g.count < MIN_BLOB_PIXELS) continue;
    const w = g.maxX - g.minX + 1;
    const h = g.maxY - g.minY + 1;
    const cx = (g.minX + g.maxX + 1) / 2;
    const cy = (g.minY + g.maxY + 1) / 2;
    const padW = w * PAD;
    const padH = h * PAD;
    const roi = clampROI(
      {
        x: (cx - padW / 2) * scaleX,
        y: (cy - padH / 2) * scaleY,
        width: padW * scaleX,
        height: padH * scaleY,
      },
      fullWidth,
      fullHeight,
    );
    candidates.push({ roi, intensity: g.sum / g.count });
  }

  candidates.sort((a, b) => b.intensity - a.intensity);
  return candidates.slice(0, 6);
}
