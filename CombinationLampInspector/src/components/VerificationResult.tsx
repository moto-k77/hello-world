import type { RawColorStats, MethodResult, Verdict } from '../api/colorAnalysis';
import type { GroundTruth } from '../types';

interface Props {
  lampLabel: string;
  imageDataUrl: string;
  stats: RawColorStats;
  predictions: MethodResult[];
  onRecord: (gt: GroundTruth) => void;
  onRetake: () => void;
}

function verdictLabel(v: Verdict) {
  if (v === 'unlit')       return { text: '消灯', color: 'text-slate-400', bg: 'bg-slate-700/50' };
  if (v === 'lit-weak')    return { text: '弱点灯', color: 'text-yellow-300', bg: 'bg-yellow-900/40' };
  if (v === 'lit-normal')  return { text: '点灯', color: 'text-green-300', bg: 'bg-green-900/40' };
  return                          { text: '強点灯', color: 'text-white', bg: 'bg-green-700/60' };
}

function ColorBar({ label, value, max = 255, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-400 w-6 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-slate-300 w-8 text-right">{Math.round(value)}</span>
    </div>
  );
}

// Majority vote across 3 methods
function majorityVerdict(predictions: MethodResult[]): Verdict {
  const counts: Record<Verdict, number> = { 'unlit': 0, 'lit-weak': 0, 'lit-normal': 0, 'lit-strong': 0 };
  predictions.forEach(p => counts[p.verdict]++);
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as Verdict;
}

export function VerificationResult({ lampLabel, imageDataUrl, stats, predictions, onRecord, onRetake }: Props) {
  const { rgb, hsv, ycbcr, peakLum } = stats;
  const mv = majorityVerdict(predictions);
  const { text: mvText, color: mvColor, bg: mvBg } = verdictLabel(mv);

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4 gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{lampLabel} — 解析結果</h2>
        <button onClick={onRetake} className="text-xs text-slate-400 underline">撮り直す</button>
      </div>

      {/* Captured image */}
      <img src={imageDataUrl} className="w-full rounded-2xl object-cover max-h-48" />

      {/* Color space raw values */}
      <div className="bg-slate-800 rounded-2xl p-4 space-y-4">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">色空間データ（上位10%輝点平均）</p>

        <div className="space-y-1">
          <p className="text-xs text-slate-500 mb-1">RGB</p>
          <ColorBar label="R" value={rgb.r} color="bg-red-500" />
          <ColorBar label="G" value={rgb.g} color="bg-green-500" />
          <ColorBar label="B" value={rgb.b} color="bg-blue-500" />
          <ColorBar label="輝度" value={peakLum} color="bg-white" />
        </div>

        <div className="space-y-1">
          <p className="text-xs text-slate-500 mb-1">HSV</p>
          <ColorBar label="H" value={hsv.h} max={360} color="bg-gradient-to-r from-red-500 via-yellow-400 to-blue-500" />
          <ColorBar label="S" value={hsv.s} max={100} color="bg-pink-400" />
          <ColorBar label="V" value={hsv.v} max={100} color="bg-slate-300" />
        </div>

        <div className="space-y-1">
          <p className="text-xs text-slate-500 mb-1">YCbCr</p>
          <ColorBar label="Y" value={ycbcr.y} color="bg-slate-300" />
          <ColorBar label="Cb" value={ycbcr.cb} color="bg-blue-400" />
          <ColorBar label="Cr" value={ycbcr.cr} color="bg-red-400" />
        </div>

        {/* Numeric summary */}
        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-700 text-center text-xs">
          <div>
            <p className="text-slate-500">RGB</p>
            <p className="text-slate-300 font-mono">{Math.round(rgb.r)}/{Math.round(rgb.g)}/{Math.round(rgb.b)}</p>
          </div>
          <div>
            <p className="text-slate-500">HSV</p>
            <p className="text-slate-300 font-mono">{hsv.h}°/{hsv.s}%/{hsv.v}%</p>
          </div>
          <div>
            <p className="text-slate-500">YCbCr</p>
            <p className="text-slate-300 font-mono">{ycbcr.y}/{ycbcr.cb}/{ycbcr.cr}</p>
          </div>
        </div>
      </div>

      {/* Algorithm predictions */}
      <div className="bg-slate-800 rounded-2xl p-4 space-y-2">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">アルゴリズム予測</p>
        {predictions.map(p => {
          const { text, color, bg } = verdictLabel(p.verdict);
          return (
            <div key={p.method} className={`rounded-xl p-3 ${bg} flex items-start justify-between gap-2`}>
              <div>
                <span className="text-xs font-bold text-slate-400">{p.method}法</span>
                <p className="text-xs text-slate-300 mt-0.5">{p.reasoning}</p>
              </div>
              <span className={`text-sm font-bold shrink-0 ${color}`}>{text}</span>
            </div>
          );
        })}
        <div className={`rounded-xl p-3 ${mvBg} border border-white/10 flex items-center justify-between`}>
          <span className="text-xs font-bold text-slate-300">多数決</span>
          <span className={`text-base font-bold ${mvColor}`}>{mvText}</span>
        </div>
      </div>

      {/* Ground truth input */}
      <div className="bg-slate-800 rounded-2xl p-4">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">実際の状態を記録</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onRecord('lit')}
            className="bg-green-700 hover:bg-green-600 text-white font-bold py-4 rounded-2xl text-sm transition-colors"
          >
            ✅ 点灯していた
          </button>
          <button
            onClick={() => onRecord('unlit')}
            className="bg-slate-600 hover:bg-slate-500 text-white font-bold py-4 rounded-2xl text-sm transition-colors"
          >
            ⬛ 消灯していた
          </button>
        </div>
      </div>
    </div>
  );
}
