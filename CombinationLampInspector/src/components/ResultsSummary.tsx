import type { InspectionResult } from '../types';
import { LAMPS } from '../lamps';

interface Props {
  vehicleId: string;
  results: InspectionResult[];
  onRestart: () => void;
}

export function ResultsSummary({ vehicleId, results, onRestart }: Props) {
  const allOk = results.every((r) => r.status === 'ok' || r.status === 'skipped');
  const ngCount = results.filter((r) => r.status === 'ng').length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 p-4">
      <div className="text-center py-8">
        <div className="text-6xl mb-3">{ngCount === 0 ? '✅' : '❌'}</div>
        <h1 className="text-2xl font-bold text-white">
          {ngCount === 0 ? '全項目 合格' : `${ngCount}項目 不合格`}
        </h1>
        <p className="text-slate-400 text-sm mt-1">車両ID: {vehicleId}</p>
        <p className="text-slate-500 text-xs mt-1">
          {new Date().toLocaleString('ja-JP')}
        </p>
      </div>

      <div className="flex flex-col gap-3 mb-8">
        {LAMPS.map((lamp) => {
          const result = results.find((r) => r.lampId === lamp.id);
          const status = result?.status ?? 'pending';

          const statusConfig = {
            ok: { label: 'OK', bg: 'bg-green-900/40 border-green-700/50', text: 'text-green-300' },
            ng: { label: 'NG', bg: 'bg-red-900/40 border-red-700/50', text: 'text-red-300' },
            skipped: { label: 'スキップ', bg: 'bg-slate-700/40 border-slate-600/50', text: 'text-slate-400' },
            pending: { label: '未検査', bg: 'bg-slate-700/40 border-slate-600/50', text: 'text-slate-400' },
          }[status];

          return (
            <div key={lamp.id} className={`rounded-2xl p-4 border ${statusConfig.bg}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{lamp.icon}</span>
                  <div>
                    <p className="text-white font-medium text-sm">{lamp.label}</p>
                    {result?.aiComment && (
                      <p className="text-slate-400 text-xs mt-0.5">{result.aiComment}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {status === 'ok' && result?.intensity && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      result.intensity === 'strong'
                        ? 'bg-yellow-500/30 text-yellow-300'
                        : result.intensity === 'normal'
                          ? 'bg-blue-500/30 text-blue-300'
                          : 'bg-slate-500/30 text-slate-300'
                    }`}>
                      {result.intensity === 'strong' ? '🔆 強' : result.intensity === 'normal' ? '💡 普通' : '🔅 弱'}
                    </span>
                  )}
                  <span className={`font-bold text-sm ${statusConfig.text}`}>{statusConfig.label}</span>
                </div>
              </div>
              {result?.imageDataUrl && (
                <img
                  src={result.imageDataUrl}
                  className="w-full rounded-xl mt-3 max-h-32 object-cover"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto">
        <div
          className={`w-full rounded-2xl p-4 mb-4 text-center font-bold text-lg ${
            allOk
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {allOk ? '検査 合格 PASS' : '検査 不合格 FAIL'}
        </div>
        <button
          onClick={onRestart}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-2xl transition-colors"
        >
          新しい検査を開始
        </button>
      </div>
    </div>
  );
}
