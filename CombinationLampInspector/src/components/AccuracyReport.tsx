import type { VerificationEntry } from '../types';
import type { Verdict } from '../api/colorAnalysis';
import { exportCSV, exportPhoto } from '../storage/db';

interface Props {
  entries: VerificationEntry[];
  onClear: () => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

function isCorrect(verdict: Verdict, gt: 'lit' | 'unlit'): boolean {
  const lit = verdict !== 'unlit';
  return lit === (gt === 'lit');
}

function pct(n: number, total: number) {
  if (total === 0) return '—';
  return `${Math.round((n / total) * 100)}%`;
}

export function AccuracyReport({ entries, onClear, onDelete, onBack }: Props) {
  if (entries.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 gap-6">
        <p className="text-slate-400">まだ検証データがありません</p>
        <button onClick={onBack} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold">戻る</button>
      </div>
    );
  }

  const methods = ['RGB', 'HSV', 'YCbCr'] as const;
  const methodStats = methods.map(m => {
    const correct = entries.filter(e => {
      const p = e.predictions.find(p => p.method === m);
      return p && isCorrect(p.verdict, e.groundTruth);
    }).length;
    return { method: m, correct, total: entries.length };
  });

  // Majority vote accuracy
  const majorityCorrect = entries.filter(e => {
    const counts: Record<Verdict, number> = { 'unlit': 0, 'lit-weak': 0, 'lit-normal': 0, 'lit-strong': 0 };
    e.predictions.forEach(p => counts[p.verdict]++);
    const mv = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as Verdict;
    return isCorrect(mv, e.groundTruth);
  }).length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4 gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">検証レポート</h2>
        <button onClick={onBack} className="text-xs text-slate-400 underline">戻る</button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">総検証数: <span className="text-white font-bold">{entries.length}件</span></p>
        <button
          onClick={() => exportCSV(entries)}
          className="bg-green-700 hover:bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors"
        >
          📥 CSVエクスポート
        </button>
      </div>

      {/* Accuracy per method */}
      <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">手法別 正解率</p>
        {methodStats.map(({ method, correct, total }) => {
          const rate = total > 0 ? correct / total : 0;
          return (
            <div key={method}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-300 font-medium">{method}法</span>
                <span className="text-white font-bold">{pct(correct, total)} ({correct}/{total})</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${rate >= 0.8 ? 'bg-green-500' : rate >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${rate * 100}%` }}
                />
              </div>
            </div>
          );
        })}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-blue-300 font-bold">多数決</span>
            <span className="text-white font-bold">{pct(majorityCorrect, entries.length)} ({majorityCorrect}/{entries.length})</span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${entries.length > 0 ? (majorityCorrect / entries.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Entry list */}
      <div className="bg-slate-800 rounded-2xl p-4 space-y-2">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">検証履歴</p>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {[...entries].reverse().map(e => {
            const counts: Record<Verdict, number> = { 'unlit': 0, 'lit-weak': 0, 'lit-normal': 0, 'lit-strong': 0 };
            e.predictions.forEach(p => counts[p.verdict]++);
            const mv = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as Verdict;
            const correct = isCorrect(mv, e.groundTruth);
            return (
              <div key={e.id} className="flex items-center gap-2 text-xs py-1 border-b border-slate-700 last:border-0">
                <img src={e.imageDataUrl} className="w-12 h-8 rounded object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-slate-300 truncate">{e.lampLabel}</p>
                  <p className="text-slate-500 font-mono">
                    H={e.stats.hsv.h}° S={e.stats.hsv.s}% V={e.stats.hsv.v}%
                  </p>
                </div>
                <div className="text-right shrink-0 mr-1">
                  <p className={e.groundTruth === 'lit' ? 'text-green-400' : 'text-slate-400'}>
                    {e.groundTruth === 'lit' ? '点灯' : '消灯'}
                  </p>
                  <p className={correct ? 'text-green-400' : 'text-red-400'}>{correct ? '✅ 正' : '❌ 誤'}</p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => exportPhoto(e)}
                    className="text-blue-400 hover:text-blue-300 text-xs px-1.5 py-0.5 rounded border border-blue-700/50 hover:border-blue-500"
                    title="写真をダウンロード"
                  >
                    📷
                  </button>
                  <button
                    onClick={() => onDelete(e.id)}
                    className="text-red-400 hover:text-red-300 text-xs px-1.5 py-0.5 rounded border border-red-700/50 hover:border-red-500"
                    title="削除"
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={onClear}
        className="bg-red-900/50 border border-red-700/50 text-red-300 font-semibold py-3 rounded-2xl text-sm"
      >
        データをすべてクリア
      </button>
    </div>
  );
}
