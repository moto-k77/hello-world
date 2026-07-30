import { useRef, useState } from 'react';
import type { VideoAnalysisResult, VideoCandidateResult, LampSegment } from '../api/videoAnalysis';
import type { Verdict, LampColor } from '../api/colorAnalysis';

interface Props {
  result: VideoAnalysisResult;
  videoUrl: string | null;
  onRetake: () => void;
}

const COLOR_STYLE: Record<string, string> = {
  '赤': 'bg-red-600',
  '橙': 'bg-orange-500',
  '白': 'bg-slate-200',
  '黄': 'bg-yellow-400',
  '不明': 'bg-slate-500',
};

// Tailwind needs full literal class names present in source to generate the CSS (JIT content
// scanning) — can't build "border-" + colorClass at runtime, hence a parallel border map.
const BORDER_STYLE: Record<string, string> = {
  '赤': 'border-red-600',
  '橙': 'border-orange-500',
  '白': 'border-slate-200',
  '黄': 'border-yellow-400',
  '不明': 'border-slate-500',
};

function verdictLabel(v: Verdict): string {
  if (v === 'unlit') return '消灯';
  if (v === 'lit-weak') return '弱';
  if (v === 'lit-normal') return '中';
  return '強';
}

function segmentClass(verdict: Verdict, color: LampColor | null): string {
  if (verdict === 'unlit' || !color) return 'bg-slate-700';
  const base = COLOR_STYLE[color] ?? 'bg-slate-500';
  if (verdict === 'lit-strong') return base;
  if (verdict === 'lit-normal') return `${base} opacity-75`;
  return `${base} opacity-45`;
}

function fmtT(t: number): string {
  return `${t.toFixed(1)}s`;
}

function segmentText(verdict: Verdict, color: LampColor | null): string {
  return verdict === 'unlit' ? '消灯' : `${color ?? '不明'} ${verdictLabel(verdict)}`;
}

// Which segment is "playing" at the given video time. Segment timestamps come from sampled
// frame times, not exactly 0/duration (e.g. the first segment may start at 0.07s due to
// seek/keyframe snapping, not 0) — so currentTime can briefly fall just outside the first/last
// segment's range. Clamp to the nearest edge segment in that case rather than falling through
// to the wrong (last) segment.
function activeSegment(segments: LampSegment[], t: number): LampSegment | undefined {
  if (segments.length === 0) return undefined;
  if (t < segments[0].startTime) return segments[0];
  if (t >= segments[segments.length - 1].endTime) return segments[segments.length - 1];
  return segments.find(s => t >= s.startTime && t < s.endTime) ?? segments[segments.length - 1];
}

function CandidateCard({
  result,
  index,
  currentTime,
  onSeek,
}: {
  result: VideoCandidateResult;
  index: number;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const { segments, roi, rangeScore } = result;
  const start = segments.length ? segments[0].startTime : 0;
  const total = segments.length ? segments[segments.length - 1].endTime - start : 1;
  const playheadPct = total > 0 ? Math.min(100, Math.max(0, ((currentTime - start) / total) * 100)) : 0;

  return (
    <div className="bg-slate-800 rounded-2xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-white">位置{index + 1}</p>
        <p className="text-xs text-slate-500 font-mono">
          {Math.round(roi.width)}×{Math.round(roi.height)} / 変化量 {rangeScore.toFixed(0)}
        </p>
      </div>

      <div className="relative w-full h-6 rounded-lg overflow-hidden border border-slate-700 flex">
        {segments.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(s.startTime)}
            className={`${segmentClass(s.verdict, s.color)} h-full cursor-pointer p-0 m-0 border-0 block`}
            style={{ flexBasis: `${total > 0 ? ((s.endTime - s.startTime) / total) * 100 : 0}%` }}
            title={`${fmtT(s.startTime)}–${fmtT(s.endTime)} ${segmentText(s.verdict, s.color)}`}
          />
        ))}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none shadow-[0_0_2px_rgba(0,0,0,0.8)]"
          style={{ left: `${playheadPct}%` }}
        />
      </div>

      <p className="text-xs text-slate-400 leading-relaxed break-words">
        {segments.map((s, i) => (
          <span key={i}>
            {i > 0 && ' → '}
            {fmtT(s.startTime)}–{fmtT(s.endTime)} {segmentText(s.verdict, s.color)}
          </span>
        ))}
      </p>
    </div>
  );
}

export function VideoResult({ result, videoUrl, onRetake }: Props) {
  const { referenceFrameDataUrl, width, height, candidates } = result;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const handleTimeSync = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };

  const handleSeek = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  };

  if (candidates.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 gap-6">
        <p className="text-slate-300 text-center">
          点灯位置の変化を検出できませんでした。
          <br />
          ランプ全体が映るよう、点灯の変化がある動画で撮り直してください。
        </p>
        <button onClick={onRetake} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold">
          撮り直す
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4 gap-4 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">🎥 動画検査結果</h2>
        <button onClick={onRetake} className="text-xs text-slate-400 underline">撮り直す</button>
      </div>

      <p className="text-slate-400 text-xs leading-relaxed">
        明るさが変化した箇所を{candidates.length}件検出しました。動画を再生・シークすると、枠の色とラベルがその時点の判定に合わせて変化します。
        タイムラインのバーをタップするとその区間の先頭にジャンプします。
      </p>

      <div className="relative w-full rounded-2xl overflow-hidden bg-black">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className="w-full rounded-2xl select-none"
            onTimeUpdate={handleTimeSync}
            onSeeking={handleTimeSync}
          />
        ) : (
          // Fallback in case the object URL wasn't available for some reason — still shows the
          // one static reference frame rather than a broken player.
          <img src={referenceFrameDataUrl} className="w-full rounded-2xl select-none" draggable={false} />
        )}
        {candidates.map((c, i) => {
          const left = (c.roi.x / width) * 100;
          const top = (c.roi.y / height) * 100;
          const w = (c.roi.width / width) * 100;
          const h = (c.roi.height / height) * 100;
          const seg = activeSegment(c.segments, currentTime);
          const isLit = !!seg && seg.verdict !== 'unlit' && !!seg.color;
          const borderClass = isLit ? (BORDER_STYLE[seg!.color as string] ?? 'border-yellow-400') : 'border-slate-500';
          const labelText = seg ? segmentText(seg.verdict, seg.color) : '位置' + (i + 1);
          return (
            <div
              key={i}
              className={`absolute border-2 rounded-lg pointer-events-none transition-colors ${borderClass}`}
              style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
            >
              <span className="absolute -top-5 left-0 text-xs font-bold text-white bg-black/60 px-1.5 py-0.5 rounded whitespace-nowrap">
                位置{i + 1}: {labelText}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        {candidates.map((c, i) => (
          <CandidateCard key={i} result={c} index={i} currentTime={currentTime} onSeek={handleSeek} />
        ))}
      </div>

      <button
        onClick={onRetake}
        className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-2xl transition-colors mt-2"
      >
        別の動画で撮り直す
      </button>
    </div>
  );
}
