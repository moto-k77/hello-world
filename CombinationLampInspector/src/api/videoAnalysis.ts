// Video-based multi-position lamp inspection (検証機能).
//
// Generalizes diffDetection.ts's "2 photos → aligned diff → blob candidates" approach from a
// single before/after pair to N frames sampled from a video: instead of one delta, we track the
// luminance RANGE (max-min) of each aligned pixel across all sampled frames. A position that
// lights up/dims/changes color at any point during the clip will have a high range even without
// a clean "baseline" shot, while constant bright backgrounds (factory ceiling lights etc.) stay
// low-range and are correctly ignored.
import { analyzeCanvasRegion, verdictFromLum } from './colorAnalysis';
import type { ROI, Verdict, LampColor, FullAnalysis, MethodResult } from './colorAnalysis';

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
  // Undefined for manually-placed/edited ROIs (VideoRoiEditor) — there's no "range across frames"
  // score for a box the user just drew, only for the auto-detector's candidates.
  rangeScore?: number;
  series: FrameSample[];
  segments: LampSegment[];
}

export interface VideoAnalysisResult {
  referenceFrameDataUrl: string;
  width: number;
  height: number;
  duration: number;
  candidates: VideoCandidateResult[];
  // The sampled frames used to produce `candidates`, kept around so the ROI editor can re-run
  // classification (classifyRois) on user-edited boxes without re-decoding the video. App.tsx
  // also stashes this in its own state and nulls it out on retake so the ~60 in-memory canvases
  // can be GC'd once a session ends.
  sampled: SampledFrames;
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

// Video mode's key advantage over a single photo: the SAME ROI is seen across dozens of frames,
// so instead of judging "lit or not" against a fixed absolute luminance, we can judge each frame
// against that ROI's own across-video floor. This matters a lot for real factory footage: the
// scene is bright and lamp housings/plastic wrap reflect ceiling lights, so an OFF lamp's ROI can
// still have a high absolute brightness (→ would wrongly read as lit) while its saturation is low
// (→ reads as 白). Judging relative to the ROI's own baseline instead correctly reads "barely
// brighter than usual" as 消灯 regardless of how bright the room is.
//
// We use stats.topLum (mean of the top-10% brightest pixels), not stats.peakLum (the single
// brightest pixel), as the baseline/verdict signal. Verified against the real sample clip: an
// unlit lamp housing wrapped in plastic film has a small specular glint that already drives
// peakLum to ~225-255, leaving only ~0-30 of headroom before the sensor clips at 255 once the
// lamp actually lights up — on some ROIs that headroom was *smaller* than any reasonable "is it
// lit" delta, making peakLum useless for this footage regardless of threshold. topLum is far less
// dominated by that one hot pixel and tracks how much of the ROI is actually bright, giving a much
// larger, usable separation between the real off/on states (see PR description for the measured
// before/after numbers on the sample clip).
const BASELINE_PERCENTILE = 0.10;
// D1: minimum rise above baseline before a frame counts as "lit" at all. Tuned against the real
// sample factory clip (see videoAnalysis test harness) — with topLum, the lamp housing ROI's
// baseline (10th percentile) sat around 60-90 while lit frames rose to 150-230+, so 30 leaves
// comfortable margin above sensor/compression noise without also flagging the off frames (whose
// frame-to-frame topLum jitter was under 10) as weakly lit.
const BASELINE_LIT_DELTA = 30;

function baselineLum(lums: number[]): number {
  if (lums.length === 0) return 0;
  const sorted = [...lums].sort((a, b) => a - b);
  // A robust "floor", not the absolute min — resists one anomalously dark frame (motion blur,
  // a bad seek) from dragging the baseline down and making every other frame look "lit".
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * BASELINE_PERCENTILE));
  return sorted[idx];
}

// ── intensity: lit AREA (meanLum), not peak/top luminance ──────────────
//
// A stronger lamp doesn't make its brightest pixels brighter — the sensor is already clipping
// them (see topLum/peakLum comments above), so weak and strong states both drive the top-10%
// band to near-saturation and the old verdictFromLum(topLum, ...) step classifier collapsed them
// into the same bucket. What actually grows with lamp strength is how much of the ROI is bright:
// a stronger lamp has a bigger blown-out core and a wider halo/bloom around the lens. meanLum —
// the mean luminance over EVERY pixel of the ROI — tracks that growing lit area and keeps rising
// well after topLum has ceilinged out, making it the standard clipping-robust intensity proxy.
//
// Note the honest limitation: this is relative to the range observed WITHIN this clip, so a
// video where the lamp only ever lights weakly will read that state as its "max". That's
// acceptable for this verification tool — the operator is expected to film the full test
// sequence including both states — and the MEAN_RANGE_FLOOR guard below prevents a clip where
// the lamp barely varies at all from having that near-zero range stretched into fake weak/strong
// swings from pure sensor noise.
const MEAN_MAX_PERCENTILE = 0.90;
// Minimum meanLum spread (max-base) within the clip before we trust relative scaling at all.
// Below this the lamp essentially doesn't vary in this clip (or only ever shows one state) and
// treating tiny fluctuations as meaningful weak/strong swings would just amplify noise.
const MEAN_RANGE_FLOOR = 15;
// ── intensity stability: median smoothing + hysteresis ─────────────────
//
// A real user's factory clip (14s, red/orange lamp with a genuine weak→strong→weak sequence)
// exposed two problems with the original single-pass "two hard cut-points" classifier
// (REL_WEAK_MAX=0.55 / REL_STRONG_MIN=0.60 — a near-zero-width "normal" band): the strong plateau
// was interrupted by 0.2-0.3s slivers reading 弱/中 wherever the per-frame rel value's ordinary
// frame-to-frame noise happened to dip across the boundary, e.g. 2.2-4.1s 橙強 → 4.1-4.3s 橙中 →
// 4.3-11.5s 橙強. Two mechanisms fix this without touching the lit/unlit gate or per-ROI color
// logic (both verified-good):
//
// 1. Median-of-3 smoothing over each lit RUN's own chronological rel series (window shrinks to 2
//    at a run's first/last frame; never smooths across an unlit gap, which would smear two
//    distinct on-cycles together) — a single-frame dip/spike mid-plateau can no longer flip the
//    label on its own, since it gets outvoted by its two neighbors.
// 2. Hysteresis instead of two hard cut-points: the classifier tracks a running state (strong/
//    normal/weak) per lit run and requires crossing a wider ENTER threshold to newly declare
//    strong/weak, but only a nearer LEAVE threshold to fall back out of it — so noise that
//    oscillates near a single cut-point can no longer repeatedly flip the label back and forth.
//
// Tuned against the real user clip's measured meanLum-based rel values (see PR/commit body for
// the full per-frame dump): the red lamp's genuine weak phase (~1.9-5.0s window per the user's
// own result) sits at rel ~0.42-0.52, its genuine strong phase (~4.3-11.5s) sits at rel
// ~0.65-1.47, and its dimmer trailing tail (~12.0-14.1s) sits back down in the weak band. The
// amber lamp (single steady-on state) sits at rel ~0.62-1.06 throughout, safely inside the
// "stay strong" hysteresis zone once entered.
const REL_ENTER_STRONG = 0.65; // must reach this to newly become strong from normal/weak
const REL_LEAVE_STRONG = 0.55; // must fall below this to leave strong (else stays strong)
const REL_ENTER_WEAK = 0.45;   // must drop to this to newly become weak from normal/strong
const REL_LEAVE_WEAK = 0.52;   // must rise above this to leave weak (else stays weak)

function robustMax(lums: number[]): number {
  if (lums.length === 0) return 0;
  const sorted = [...lums].sort((a, b) => a - b);
  // Robust "ceiling", not the absolute max — resists one anomalously bright glitch frame from
  // inflating the range and compressing every other frame's rel toward 0.
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * MEAN_MAX_PERCENTILE));
  return sorted[idx];
}

// Color, ignoring each method's own absolute-threshold verdict — we've already decided lit/unlit
// ourselves from the baseline-relative luminance, so all that's needed here is which hue the
// per-method color logic (RGB/HSV/YCbCr, including the clipping-aware bright-pixel selection in
// extractTopPixels) picked out, not whether that method separately thought the ROI was "lit".
//
// When the 3 methods disagree, prefer a chromatic (赤/橙/黄) vote over 白/不明 rather than a plain
// majority/first-wins tie-break. Verified on the real sample clip: a partially-clipped amber
// frame had RGB→白, HSV→(no match), YCbCr→橙 — a 1-1 tie that a plain vote resolves to whichever
// method happens to come first, discarding the one method that actually recovered the hue. 白/不明
// only mean "no method found a clear hue", which is exactly the known clipping failure mode this
// whole file exists to work around, so they should never outrank an actual hue match.
function colorVote(preds: MethodResult[]): LampColor | null {
  const withColor = preds.filter(p => p.color);
  if (!withColor.length) return null;
  const chromatic = withColor.filter(p => p.color !== '白' && p.color !== '不明');
  const pool = chromatic.length > 0 ? chromatic : withColor;
  const counts: Record<string, number> = {};
  pool.forEach(p => { counts[p.color as string] = (counts[p.color as string] ?? 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as LampColor;
}

// A physical lamp has ONE color — the ROI editor's whole premise is one box per lamp — so instead
// of a per-frame color (previously patched up post-hoc by a per-run fallback when clipping made a
// frame read 白/不明), we decide ONE color for the whole ROI and apply it to every lit frame.
//
// A strongly lit lamp clips toward white/orange (loses hue), while a weakly lit lamp's true hue
// survives (see the module-level problem description: the real sample's red lamp reads 赤 while
// weak and 橙/白 while strong-and-blown-out). So we want the LEAST-clipped frames' hue vote — but
// "least clipped" needs to be judged per lit CYCLE (contiguous run of lit frames = one physical
// on-period), not by pooling every lit frame in the whole clip and taking the dimmest N%.
//
// Measured on the real sample clip: pooling by raw brightness (whether ranked by topLum or by
// meanLum) doesn't work, because the STRONG phase itself has transient dips — a frame or two
// mid-run reading meaningfully dimmer than the plateau around it (auto-exposure/bloom
// fluctuation, or just motion-blur-adjacent frames) — that are still fully within the
// strong/clipped-orange on-period, not the lamp's real weak state. Pooled by raw per-frame
// brightness, those dip frames were dim enough to crowd into the "least clipped" sample right
// alongside the genuinely weak on-period's frames, diluting or outright flipping the vote to 橙.
//
// Grouping by lit RUN first sidesteps this entirely: average each run's meanLum, and trust only
// the single dimmest run's own per-frame hue votes. A transient dip mid-strong-run pulls that
// run's own average down only slightly (it's outnumbered by the rest of the plateau within the
// same run) — nowhere near the runs where the lamp is actually, sustainedly, dim. If the ROI only
// ever has one lit run (e.g. the amber lamp here — on once, steady, off once), that run trivially
// "wins" and its own full-run majority is used, which is just a stable, large-sample vote.
function isChromatic(c: LampColor | null): c is LampColor {
  return c !== null && c !== '白' && c !== '不明';
}

function chromaticMajority(frames: { color: LampColor | null }[]): LampColor | null {
  const counts: Record<string, number> = {};
  for (const f of frames) {
    if (isChromatic(f.color)) counts[f.color] = (counts[f.color] ?? 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked.length > 0 ? (ranked[0][0] as LampColor) : null;
}

// sampleFramesFromVideo's seekTo() has an 800ms stale-frame fallback for browsers/codecs where
// the 'seeked' event doesn't reliably fire — when that triggers, several consecutive nominal
// timestamps can end up holding bit-identical decoded pixels (same exact RGB). Left alone, that
// single stale frame would be counted several times over in both a run's average brightness and
// its majority hue vote, letting one seek hiccup out-weight genuinely distinct frames. Collapse
// runs of exactly-identical consecutive frames to one before either computation.
function dedupeStaleFrames<T extends { r: number; g: number; b: number }>(frames: T[]): T[] {
  const out: T[] = [];
  for (const f of frames) {
    const prev = out[out.length - 1];
    if (prev && prev.r === f.r && prev.g === f.g && prev.b === f.b) continue;
    out.push(f);
  }
  return out;
}

type ColorVoteFrame = { meanLum: number; color: LampColor | null; r: number; g: number; b: number };

function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((s, n) => s + n, 0) / nums.length;
}

// Decide the single color for a ROI from its lit runs (each a contiguous stretch of lit frames —
// see the comment above for why we group by run rather than pooling every lit frame in the clip).
// Returns null only if the ROI has no lit frames anywhere.
function decideRoiColor(litRunsChrono: ColorVoteFrame[][]): LampColor | null {
  const runs = litRunsChrono.map(dedupeStaleFrames).filter(r => r.length > 0);
  if (runs.length === 0) return null;
  const allFrames = runs.flat();
  // If literally no lit frame ever recovered a chromatic hue, this is a genuinely white lamp
  // (e.g. a reverse light) rather than a clipping artifact — 白 for the whole ROI.
  if (!allFrames.some(f => isChromatic(f.color))) return '白';

  let dimmestRun = runs[0];
  let dimmestAvg = average(dimmestRun.map(f => f.meanLum));
  for (const run of runs.slice(1)) {
    const runAvg = average(run.map(f => f.meanLum));
    if (runAvg < dimmestAvg) {
      dimmestRun = run;
      dimmestAvg = runAvg;
    }
  }

  // Fall back to every lit frame across all runs if the dimmest run itself happens to have no
  // chromatic vote (e.g. a hot alignment glitch throughout that one run) — better than reporting
  // 白 when some other run clearly saw the hue.
  return chromaticMajority(dimmestRun) ?? chromaticMajority(allFrames) ?? '白';
}

function medianOf3ish(vals: number[]): number {
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Odd window (the normal 3-wide case): plain middle value. Even window (2-wide, only at a lit
  // run's very first/last frame where the window shrinks) has no single middle — average the two.
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Median-smooth a lit run's own chronological rel series with a 3-wide window (shrinking to 2 at
// the run's edges). Never called across an unlit gap — see REL_* comments above.
function medianSmoothRun(rels: number[]): number[] {
  return rels.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(rels.length - 1, i + 1);
    return medianOf3ish(rels.slice(lo, hi + 1));
  });
}

type IntensityState = 'strong' | 'normal' | 'weak';

// Hysteresis state machine over one lit run's smoothed rel series — see REL_ENTER_*/REL_LEAVE_*
// comments above for the mechanism and tuned values. The first frame has no prior state to hold
// onto, so it's classified with the (wider) ENTER thresholds directly.
function hysteresisStates(rels: number[]): IntensityState[] {
  const states: IntensityState[] = [];
  let state: IntensityState = 'normal';
  rels.forEach((rel, i) => {
    if (i === 0) {
      if (rel >= REL_ENTER_STRONG) state = 'strong';
      else if (rel <= REL_ENTER_WEAK) state = 'weak';
      else state = 'normal';
    } else if (state === 'strong') {
      if (rel < REL_LEAVE_STRONG) state = rel <= REL_ENTER_WEAK ? 'weak' : 'normal';
    } else if (state === 'weak') {
      if (rel > REL_LEAVE_WEAK) state = rel >= REL_ENTER_STRONG ? 'strong' : 'normal';
    } else {
      if (rel >= REL_ENTER_STRONG) state = 'strong';
      else if (rel <= REL_ENTER_WEAK) state = 'weak';
    }
    states.push(state);
  });
  return states;
}

function intensityStateToVerdict(state: IntensityState): Verdict {
  if (state === 'strong') return 'lit-strong';
  if (state === 'weak') return 'lit-weak';
  return 'lit-normal';
}

// Same-color short-segment absorption (safety net applied after collapseSegments, in the one
// place both analyzeVideoFile and classifyRois share). Even with median smoothing + hysteresis,
// a run's rel can still occasionally hover long enough near a LEAVE threshold to produce a short
// (but real, not single-frame) intensity segment. Any LIT segment shorter than minDuration whose
// same-color LIT neighbor(s) exist gets absorbed into the longer of those neighbors (re-labeling
// its verdict/color to match) — repeated until stable, then adjacent segments that end up
// identical are coalesced. Deliberately never touches unlit segments or crosses a lit/unlit
// boundary: turn-signal blinking (~0.35s on/off cycles) must pass through completely untouched,
// since this only removes intensity flapping WITHIN a continuously-lit run.
export function absorbShortLitSegments(segments: LampSegment[], minDuration = 0.5): LampSegment[] {
  const segs = segments.map(s => ({ ...s }));

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.verdict === 'unlit') continue;
      if (s.endTime - s.startTime >= minDuration) continue;

      const left = i > 0 ? segs[i - 1] : undefined;
      const right = i < segs.length - 1 ? segs[i + 1] : undefined;
      const leftOk = !!left && left.verdict !== 'unlit' && left.color === s.color;
      const rightOk = !!right && right.verdict !== 'unlit' && right.color === s.color;
      if (!leftOk && !rightOk) continue;

      const leftDur = leftOk ? left!.endTime - left!.startTime : -1;
      const rightDur = rightOk ? right!.endTime - right!.startTime : -1;
      if (leftDur >= rightDur) {
        left!.endTime = s.endTime;
      } else {
        right!.startTime = s.startTime;
      }
      segs.splice(i, 1);
      changed = true;
      break; // indices shifted — restart the scan
    }
  }

  // Absorption can leave two now-identical (verdict+color) lit segments directly adjacent
  // (their formerly-distinguishing middle segment is gone) — coalesce those too.
  const merged: LampSegment[] = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.verdict === s.verdict && prev.color === s.color) {
      prev.endTime = s.endTime;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function buildSeries(frames: HTMLCanvasElement[], timestamps: number[], roi: ROI): FrameSample[] {
  // Pass 1: raw per-frame stats/predictions (analyzeCanvasRegion already does the clipping-aware
  // color extraction and per-method hue classification; we just don't trust its absolute verdict).
  const raw = frames.map((canvas): FullAnalysis | null => {
    try {
      return analyzeCanvasRegion(canvas, roi);
    } catch {
      return null;
    }
  });

  const validRaw = raw.filter((r): r is FullAnalysis => r !== null);
  const baseline = baselineLum(validRaw.map(r => r.stats.topLum));
  const meanBase = baselineLum(validRaw.map(r => r.stats.meanLum));
  const meanMax = robustMax(validRaw.map(r => r.stats.meanLum));
  const meanRange = meanMax - meanBase;

  // Pass 2a: per-frame lit/unlit GATE (unchanged — verified accurate for on/off transitions to
  // ~0.2s) plus the raw ingredients (meanLum, rel, hue vote) intensity/color need downstream.
  const base = raw.map((r, i) => {
    if (!r) {
      return { timestamp: timestamps[i], lit: false, meanLum: 0, rel: 0, color: null as LampColor | null, r: 0, g: 0, b: 0 };
    }
    const gate = verdictFromLum(r.stats.topLum, baseline + BASELINE_LIT_DELTA);
    const lit = gate !== 'unlit';
    const rel = meanRange > 0 ? (r.stats.meanLum - meanBase) / meanRange : 0;
    return {
      timestamp: timestamps[i],
      lit,
      meanLum: r.stats.meanLum,
      rel,
      color: colorVote(r.predictions),
      r: r.stats.rgb.r,
      g: r.stats.rgb.g,
      b: r.stats.rgb.b,
    };
  });

  // Pass 2b: intensity verdict from the baseline-normalized meanLum signal (area-based,
  // clipping-robust — see MEAN_RANGE_FLOOR/REL_* comments above, instead of topLum's absolute
  // steps which collapsed weak/strong into the same bucket once topLum itself saturated).
  // Computed per lit RUN (contiguous stretch of `lit` frames) so median smoothing never smears
  // across an unlit gap and hysteresis state resets cleanly for each new on-cycle.
  const intensity: Verdict[] = base.map(() => 'unlit');
  if (meanRange >= MEAN_RANGE_FLOOR) {
    let i = 0;
    while (i < base.length) {
      if (!base[i].lit) { i++; continue; }
      let j = i;
      while (j < base.length && base[j].lit) j++;
      const runRel = base.slice(i, j).map(f => f.rel);
      const smoothed = medianSmoothRun(runRel);
      const states = hysteresisStates(smoothed);
      states.forEach((state, k) => { intensity[i + k] = intensityStateToVerdict(state); });
      i = j;
    }
  } else {
    // Lamp doesn't meaningfully vary in this clip (or only ever shows one state) — relative
    // scaling would just be noise amplification, so treat every lit frame as normal.
    base.forEach((f, i) => { if (f.lit) intensity[i] = 'lit-normal'; });
  }

  const perFrame = base.map((f, i) => ({
    timestamp: f.timestamp,
    lit: f.lit,
    verdict: intensity[i],
    meanLum: f.meanLum,
    color: f.color,
    r: f.r,
    g: f.g,
    b: f.b,
  }));

  // Pass 3: one color for the whole ROI, from its dimmest lit run (see decideRoiColor).
  const litRuns: ColorVoteFrame[][] = [];
  let currentRun: ColorVoteFrame[] = [];
  for (const f of perFrame) {
    if (f.lit) {
      currentRun.push({ meanLum: f.meanLum, color: f.color, r: f.r, g: f.g, b: f.b });
    } else if (currentRun.length > 0) {
      litRuns.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length > 0) litRuns.push(currentRun);
  const roiColor = decideRoiColor(litRuns);

  return perFrame.map((f): FrameSample => ({
    timestamp: f.timestamp,
    verdict: f.verdict,
    color: f.lit ? roiColor : null,
  }));
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
  // Shared by both analyzeVideoFile and classifyRois (the only two callers of collapseSegments) —
  // see absorbShortLitSegments for why this safety-net pass runs here.
  return absorbShortLitSegments(segments);
}

// Re-run classification for a set of (possibly user-edited) ROIs against already-sampled frames —
// no re-decoding of the video needed. Used by VideoRoiEditor's confirm step: the user moves/
// resizes/adds/deletes boxes over the existing reference frame, and we just re-run buildSeries +
// collapseSegments per box against the SampledFrames already held in memory from the initial
// analyzeVideoFile() pass.
export function classifyRois(sampled: SampledFrames, rois: ROI[]): VideoCandidateResult[] {
  const { frames, timestamps, duration } = sampled;
  return rois.map((roi): VideoCandidateResult => {
    const series = buildSeries(frames, timestamps, roi);
    const segments = collapseSegments(series, duration);
    return { roi, series, segments };
  });
}

// ── top-level orchestrator ──

export async function analyzeVideoFile(file: File, targetFps = 5): Promise<VideoAnalysisResult> {
  const sampled = await sampleFramesFromVideo(file, targetFps);
  const { timestamps, frames, width, height, duration } = sampled;
  if (frames.length === 0) throw new Error('動画からフレームを取得できませんでした');

  const positions = detectLampPositions(frames, width, height);
  const candidates: VideoCandidateResult[] = positions.map(p => {
    const series = buildSeries(frames, timestamps, p.roi);
    const segments = collapseSegments(series, duration);
    return { roi: p.roi, rangeScore: p.rangeScore, series, segments };
  });

  const refIndex = Math.floor(frames.length / 2);
  const referenceFrameDataUrl = frames[refIndex].toDataURL('image/jpeg', 0.9);

  return { referenceFrameDataUrl, width, height, duration, candidates, sampled };
}
