// Video-based multi-position lamp inspection (検証機能).
//
// Generalizes diffDetection.ts's "2 photos → aligned diff → blob candidates" approach from a
// single before/after pair to N frames sampled from a video: instead of one delta, we track the
// luminance RANGE (max-min) of each aligned pixel across all sampled frames. A position that
// lights up/dims/changes color at any point during the clip will have a high range even without
// a clean "baseline" shot, while constant bright backgrounds (factory ceiling lights etc.) stay
// low-range and are correctly ignored.
import { analyzeCanvasRegion } from './colorAnalysis';
import type { ROI, Verdict, LampColor, MethodResult } from './colorAnalysis';

export interface SampledFrames {
  timestamps: number[];
  frames: HTMLCanvasElement[];
  width: number;
  height: number;
  duration: number;
}

export interface VideoLampCandidate {
  roi: ROI;
  rangeScore: number;
}

export interface FrameSample {
  timestamp: number;
  verdict: Verdict;
  color: LampColor | null;
}

export interface LampSegment {
  startTime: number;
  endTime: number;
  verdict: Verdict;
  color: LampColor | null;
}

export interface VideoCandidateResult {
  roi: ROI;
  rangeScore: number;
  series: FrameSample[];
  segments: LampSegment[];
}

export interface VideoAnalysisResult {
  referenceFrameDataUrl: string;
  width: number;
  height: number;
  duration: number;
  candidates: VideoCandidateResult[];
}

// ── frame sampling ──────────────────────────────────────────

const MAX_FRAMES = 60;
const WORK_WIDTH = 480;

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => finish();
    video.addEventListener('seeked', onSeeked);
    video.currentTime = t;
    // Fallback in case 'seeked' never fires (some codecs/browsers are unreliable here) —
    // this is a verification tool, not safety-critical, so a stale frame once in a while is fine.
    setTimeout(finish, 800);
  });
}

// Loads the video File into an offscreen <video>, then seeks through it and grabs a canvas per
// timestamp at a reduced working resolution. Frame count is capped so long videos don't blow up
// memory/time; for a 14s clip at targetFps=5 that's ~70 frames, clamped down to MAX_FRAMES.
export async function sampleFramesFromVideo(file: File, targetFps = 5): Promise<SampledFrames> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('動画の読み込みに失敗しました'));
    });

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('動画の長さを取得できませんでした');
    }

    let frameCount = Math.max(2, Math.round(duration * targetFps));
    if (frameCount > MAX_FRAMES) frameCount = MAX_FRAMES;

    const srcW = video.videoWidth || WORK_WIDTH;
    const srcH = video.videoHeight || WORK_WIDTH;
    const width = Math.min(WORK_WIDTH, srcW);
    const height = Math.max(1, Math.round((width * srcH) / srcW));

    const timestamps: number[] = [];
    const frames: HTMLCanvasElement[] = [];

    for (let i = 0; i < frameCount; i++) {
      const t = frameCount === 1 ? 0 : (duration * i) / (frameCount - 1);
      await seekTo(video, Math.max(0, Math.min(duration - 0.03, t)));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(video, 0, 0, width, height);
      frames.push(canvas);
      timestamps.push(video.currentTime);
    }

    return { timestamps, frames, width, height, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── alignment (adapted from diffDetection.ts's block-matching search) ──

interface GrayFrame {
  data: Float32Array;
  width: number;
  height: number;
}

function toGrayFrame(source: HTMLCanvasElement, width: number, height: number): GrayFrame {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  return { data: gray, width, height };
}

function sad(base: GrayFrame, other: GrayFrame, dx: number, dy: number): number {
  const { width, height } = base;
  let sum = 0, count = 0;
  for (let y = 0; y < height; y++) {
    const oy = y + dy;
    if (oy < 0 || oy >= height) continue;
    for (let x = 0; x < width; x++) {
      const ox = x + dx;
      if (ox < 0 || ox >= width) continue;
      sum += Math.abs(base.data[y * width + x] - other.data[oy * width + ox]);
      count++;
    }
  }
  return count === 0 ? Infinity : sum / count;
}

function findBestOffset(base: GrayFrame, other: GrayFrame, range: number): { dx: number; dy: number } {
  let best = { dx: 0, dy: 0, score: Infinity };
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const score = sad(base, other, dx, dy);
      if (score < best.score) best = { dx, dy, score };
    }
  }
  return { dx: best.dx, dy: best.dy };
}

// ── connected components (copied from diffDetection.ts) ──

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
  const minSize = Math.min(fullWidth, fullHeight) * 0.05;
  let { x, y, width, height } = roi;
  width = Math.max(width, minSize);
  height = Math.max(height, minSize);
  x = Math.max(0, Math.min(x, fullWidth - width));
  y = Math.max(0, Math.min(y, fullHeight - height));
  width = Math.min(width, fullWidth - x);
  height = Math.min(height, fullHeight - y);
  return { x, y, width, height };
}

// ── position detection: per-pixel luminance range across all aligned frames ──

const ALIGN_W = 80;
const ALIGN_RANGE = 10;
const DIFF_W = 160;
// Real factory footage can have substantial whole-scene brightness flicker (wet reflective
// floors, ceiling lights, auto-exposure hunting near a very bright lamp) that is nearly as
// strong, in absolute terms, as the lamp itself — a fixed absolute threshold would then flag
// almost the entire frame as "changed" and merge it into one giant blob. Instead we take the
// Nth percentile of per-pixel range across the frame as an adaptive threshold: whatever the
// scene's overall noise/flicker floor is, only the most extreme, spatially-concentrated ~(100 -
// RANGE_PERCENTILE)% of pixels qualify, which in practice isolates real localized lamp changes
// even when the background is fairly noisy. A minimum floor still guards against manufacturing
// candidates out of pure sensor/codec noise in an otherwise-static video.
const RANGE_PERCENTILE = 0.90;
const MIN_RANGE_THRESHOLD = 30;
const MIN_BLOB_PIXELS = 6;
const MAX_CANDIDATES = 8;
const PAD = 1.4;
// A blob spanning most of the frame is not a "lamp position" — it's a sign the whole scene
// changed (global exposure/lighting), so we reject blobs above this fraction of the frame area.
const MAX_BLOB_AREA_FRACTION = 0.35;

export function detectLampPositions(
  frames: HTMLCanvasElement[],
  width: number,
  height: number,
): VideoLampCandidate[] {
  if (frames.length === 0) return [];

  const alignH = Math.max(1, Math.round((ALIGN_W * height) / width));
  const diffH = Math.max(1, Math.round((DIFF_W * height) / width));

  const alignFrames = frames.map(f => toGrayFrame(f, ALIGN_W, alignH));
  const diffFrames = frames.map(f => toGrayFrame(f, DIFF_W, diffH));

  // Align every frame to the first sampled frame (reference), tolerating handheld drift.
  const refAlign = alignFrames[0];
  const offsets = alignFrames.map(af => findBestOffset(refAlign, af, ALIGN_RANGE));
  const scaleAlignToDiff = DIFF_W / ALIGN_W;

  // A very bright lamp can trigger the camera's auto-exposure/auto-white-balance to shift the
  // brightness of the ENTIRE frame (not just the lamp), which would otherwise show up as one
  // giant high-range blob spanning the whole image. Subtract each frame's own mean luminance
  // before computing range so that common, frame-wide brightness shifts cancel out and only
  // genuinely localized changes (the lamp itself) remain.
  for (const frame of diffFrames) {
    let sum = 0;
    for (let i = 0; i < frame.data.length; i++) sum += frame.data[i];
    const mean = sum / frame.data.length;
    for (let i = 0; i < frame.data.length; i++) frame.data[i] -= mean;
  }

  const gridSize = DIFF_W * diffH;
  const minMap = new Float32Array(gridSize).fill(Infinity);
  const maxMap = new Float32Array(gridSize).fill(-Infinity);
  const countMap = new Int32Array(gridSize);

  for (let f = 0; f < diffFrames.length; f++) {
    const frame = diffFrames[f];
    const dx = Math.round(offsets[f].dx * scaleAlignToDiff);
    const dy = Math.round(offsets[f].dy * scaleAlignToDiff);
    for (let y = 0; y < diffH; y++) {
      const sy = y + dy;
      if (sy < 0 || sy >= diffH) continue;
      for (let x = 0; x < DIFF_W; x++) {
        const sx = x + dx;
        if (sx < 0 || sx >= DIFF_W) continue;
        const idx = y * DIFF_W + x;
        const v = frame.data[sy * DIFF_W + sx];
        if (v < minMap[idx]) minMap[idx] = v;
        if (v > maxMap[idx]) maxMap[idx] = v;
        countMap[idx]++;
      }
    }
  }

  // Require a pixel to have been sampled in at least half the frames (near the alignment
  // border it may fall out of frame for some offsets) before trusting its range.
  const minSamples = Math.max(3, Math.floor(diffFrames.length * 0.5));
  const validRanges: number[] = [];
  const rangeByIdx = new Float32Array(gridSize);
  for (let i = 0; i < gridSize; i++) {
    if (countMap[i] < minSamples) continue;
    const range = maxMap[i] - minMap[i];
    rangeByIdx[i] = range;
    validRanges.push(range);
  }
  validRanges.sort((a, b) => a - b);
  const percentileIdx = Math.min(validRanges.length - 1, Math.floor(validRanges.length * RANGE_PERCENTILE));
  const adaptiveThreshold = Math.max(MIN_RANGE_THRESHOLD, validRanges[percentileIdx] ?? MIN_RANGE_THRESHOLD);

  const mask = new Uint8Array(gridSize);
  const rangeVals = new Float32Array(gridSize);
  for (let i = 0; i < gridSize; i++) {
    if (countMap[i] < minSamples) continue;
    if (rangeByIdx[i] > adaptiveThreshold) {
      mask[i] = 1;
      rangeVals[i] = rangeByIdx[i];
    }
  }

  const uf = new UnionFind(gridSize);
  for (let y = 0; y < diffH; y++) {
    for (let x = 0; x < DIFF_W; x++) {
      const idx = y * DIFF_W + x;
      if (!mask[idx]) continue;
      if (x + 1 < DIFF_W && mask[idx + 1]) uf.union(idx, idx + 1);
      if (y + 1 < diffH && mask[idx + DIFF_W]) uf.union(idx, idx + DIFF_W);
    }
  }

  const groups = new Map<number, { minX: number; maxX: number; minY: number; maxY: number; sum: number; count: number }>();
  for (let y = 0; y < diffH; y++) {
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
      g.sum += rangeVals[idx];
      g.count++;
    }
  }

  const scaleX = width / DIFF_W;
  const scaleY = height / diffH;
  const candidates: VideoLampCandidate[] = [];
  for (const g of groups.values()) {
    if (g.count < MIN_BLOB_PIXELS) continue;
    const w = g.maxX - g.minX + 1;
    const h = g.maxY - g.minY + 1;
    // Reject blobs spanning most of the frame — that's whole-scene change (exposure/lighting
    // shift), not a distinct lamp position.
    if ((w * h) / gridSize > MAX_BLOB_AREA_FRACTION) continue;
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
      width,
      height,
    );
    // Score by TOTAL range mass (sum), not average — a real lamp housing is a physically large,
    // sustained-change region, whereas small hyper-bright point sources (ceiling light fixtures,
    // specular glints) can have an even higher *average* range per pixel but cover far fewer
    // pixels. Summing correctly ranks the spatially-extended lamp above those point sources.
    candidates.push({ roi, rangeScore: g.sum });
  }

  candidates.sort((a, b) => b.rangeScore - a.rangeScore);
  return candidates.slice(0, MAX_CANDIDATES);
}

// ── per-candidate time series + segment collapsing ──

function majorityVerdict(preds: MethodResult[]): Verdict {
  const c: Record<Verdict, number> = { 'unlit': 0, 'lit-weak': 0, 'lit-normal': 0, 'lit-strong': 0 };
  preds.forEach(p => c[p.verdict]++);
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as Verdict;
}

function majorityColor(preds: MethodResult[]): LampColor | null {
  const lit = preds.filter(p => p.verdict !== 'unlit' && p.color);
  if (!lit.length) return null;
  const c: Record<string, number> = {};
  lit.forEach(p => { if (p.color) c[p.color] = (c[p.color] ?? 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as LampColor;
}

function buildSeries(frames: HTMLCanvasElement[], timestamps: number[], roi: ROI): FrameSample[] {
  return frames.map((canvas, i) => {
    try {
      const { predictions } = analyzeCanvasRegion(canvas, roi);
      return { timestamp: timestamps[i], verdict: majorityVerdict(predictions), color: majorityColor(predictions) };
    } catch {
      return { timestamp: timestamps[i], verdict: 'unlit' as Verdict, color: null };
    }
  });
}

function collapseSegments(series: FrameSample[], duration: number): LampSegment[] {
  if (series.length === 0) return [];
  const segments: LampSegment[] = [];
  let start = series[0];
  let prev = series[0];
  for (let i = 1; i <= series.length; i++) {
    const cur = i < series.length ? series[i] : undefined;
    const changed = !cur || cur.verdict !== prev.verdict || cur.color !== prev.color;
    if (changed) {
      segments.push({
        startTime: start.timestamp,
        endTime: cur ? cur.timestamp : duration,
        verdict: prev.verdict,
        color: prev.color,
      });
      if (cur) start = cur;
    }
    if (cur) prev = cur;
  }
  return segments;
}

// ── top-level orchestrator ──

export async function analyzeVideoFile(file: File, targetFps = 5): Promise<VideoAnalysisResult> {
  const { timestamps, frames, width, height, duration } = await sampleFramesFromVideo(file, targetFps);
  if (frames.length === 0) throw new Error('動画からフレームを取得できませんでした');

  const positions = detectLampPositions(frames, width, height);
  const candidates: VideoCandidateResult[] = positions.map(p => {
    const series = buildSeries(frames, timestamps, p.roi);
    const segments = collapseSegments(series, duration);
    return { roi: p.roi, rangeScore: p.rangeScore, series, segments };
  });

  const refIndex = Math.floor(frames.length / 2);
  const referenceFrameDataUrl = frames[refIndex].toDataURL('image/jpeg', 0.9);

  return { referenceFrameDataUrl, width, height, duration, candidates };
}
