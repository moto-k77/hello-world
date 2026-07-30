import type { VideoAnalysisResult, VideoCandidateResult } from '../api/videoAnalysis';
import type { Verdict, LampColor } from '../api/colorAnalysis';

interface Props {
  result: VideoAnalysisResult;
  onRetake: () => void;
}

const COLOR_STYLE: Record<string, string> = {
  '赤': 'bg-red-600',
  '橙': 'bg-orange-500',
  '白': 'bg-slate-200',
  '黄': 'bg-yellow-400',
  '不明': 'bg-slate-500',
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

function CandidateCard({ result, index }: { result: VideoCandidateResult; index: number }) {
  const { segments, roi, rangeScore } = result;
  const total = segments.length
    ? segments[segments.length - 1].endTime - segments[0].startTime
    : 1;

  return (
    <div className="bg-slate-800 rounded-2xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-white">位置{index + 1}</p>
        <p className="text-xs text-slate-500 font-mono">
          {Math.round(roi.width)}×{Math.round(roi.height)} / 変化量 {rangeScore.toFixed(0)}
        </p>
      </div>

      <div className="flex w-full h-6 rounded-lg overflow-hidden border border-slate-700">
        {segments.map((s, i) => (
          <div
            key={i}
            className={segmentClass(s.verdict, s.color)}
            style={{ flexBasis: `${total > 0 ? ((s.endTime - s.startTime) / total) * 100 : 0}%` }}
            title={`${fmtT(s.startTime)}–${fmtT(s.endTime)} ${segmentText(s.verdict, s.color)}`}
          />
        ))}
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

export function VideoResult({ result, onRetake }: Props) {
  const { referenceFrameDataUrl, width, height, candidates } = result;

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
        明るさが変化した箇所を{candidates.length}件検出しました。各位置の色・強さの時間変化はバーの下に表示しています。
      </p>

      <div className="relative w-full rounded-2xl overflow-hidden bg-black">
        <img src={referenceFrameDataUrl} className="w-full rounded-2xl select-none" draggable={false} />
        {candidates.map((c, i) => {
          const left = (c.roi.x / width) * 100;
          const top = (c.roi.y / height) * 100;
          const w = (c.roi.width / width) * 100;
          const h = (c.roi.height / height) * 100;
          return (
            <div
              key={i}
              className="absolute border-2 border-yellow-400 rounded-lg pointer-events-none"
              style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
            >
              <span className="absolute -top-5 left-0 text-xs font-bold text-white bg-black/60 px-1.5 py-0.5 rounded">
                位置{i + 1}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        {candidates.map((c, i) => (
          <CandidateCard key={i} result={c} index={i} />
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
