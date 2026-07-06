import { useState } from 'react';
import { LAMPS } from './lamps';
import { CameraCapture } from './components/CameraCapture';
import { RoiSelector } from './components/RoiSelector';
import { VerificationResult } from './components/VerificationResult';
import { AccuracyReport } from './components/AccuracyReport';
import { analyzeROI } from './api/colorAnalysis';
import type { ROI, FullAnalysis } from './api/colorAnalysis';
import type { VerificationEntry, GroundTruth } from './types';

type Phase = 'select' | 'camera' | 'roi' | 'result' | 'report';

export default function App() {
  const [phase, setPhase] = useState<Phase>('select');
  const [lampLabel, setLampLabel] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FullAnalysis | null>(null);
  const [entries, setEntries] = useState<VerificationEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSelectLamp = (label: string) => {
    setLampLabel(label);
    setCapturedImage(null);
    setAnalysis(null);
    setError(null);
    setPhase('camera');
  };

  const handleCapture = (dataUrl: string) => {
    setCapturedImage(dataUrl);
    setPhase('roi');
  };

  const handleRoiConfirm = async (r: ROI) => {
    if (!capturedImage) return;
    setError(null);
    try {
      const result = await analyzeROI(capturedImage, r);
      setAnalysis(result);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('result');
    }
  };

  const handleRecord = (gt: GroundTruth) => {
    if (!analysis || !capturedImage) return;
    const entry: VerificationEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      lampLabel,
      imageDataUrl: capturedImage,
      stats: analysis.stats,
      predictions: analysis.predictions,
      groundTruth: gt,
    };
    setEntries(prev => [...prev, entry]);
    setPhase('select');
  };

  if (phase === 'camera') {
    return <CameraCapture onCapture={handleCapture} onCancel={() => setPhase('select')} />;
  }

  if (phase === 'roi' && capturedImage) {
    return (
      <RoiSelector
        imageDataUrl={capturedImage}
        lampLabel={lampLabel}
        onConfirm={handleRoiConfirm}
        onRetake={() => setPhase('camera')}
      />
    );
  }

  if (phase === 'result' && capturedImage) {
    if (error || !analysis) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 gap-4">
          <p className="text-red-400">エラー: {error}</p>
          <button onClick={() => setPhase('camera')} className="bg-blue-600 text-white px-6 py-3 rounded-2xl">撮り直す</button>
        </div>
      );
    }
    return (
      <VerificationResult
        lampLabel={lampLabel}
        imageDataUrl={capturedImage}
        stats={analysis.stats}
        predictions={analysis.predictions}
        onRecord={handleRecord}
        onRetake={() => setPhase('camera')}
      />
    );
  }

  if (phase === 'report') {
    return (
      <AccuracyReport
        entries={entries}
        onClear={() => setEntries([])}
        onBack={() => setPhase('select')}
      />
    );
  }

  // Select phase
  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4">
      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h1 className="text-xl font-bold">ランプ検証モード</h1>
          <p className="text-slate-400 text-xs mt-0.5">RGB / HSV / YCbCr 精度検証</p>
        </div>
        <button
          onClick={() => setPhase('report')}
          className="relative bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          📊 レポート
          {entries.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
              {entries.length}
            </span>
          )}
        </button>
      </div>

      <p className="text-slate-400 text-sm mb-4">検証するランプを選択してください</p>

      <div className="flex flex-col gap-3">
        {LAMPS.map(lamp => (
          <button
            key={lamp.id}
            onClick={() => handleSelectLamp(lamp.label)}
            className="bg-slate-800 hover:bg-slate-700 rounded-2xl p-4 flex items-center gap-4 text-left transition-colors border border-slate-700"
          >
            <span className="text-3xl">{lamp.icon}</span>
            <div>
              <p className="text-white font-semibold">{lamp.label}</p>
              <p className="text-slate-400 text-xs mt-0.5">{lamp.instruction}</p>
            </div>
          </button>
        ))}
        <button
          onClick={() => handleSelectLamp('カスタム')}
          className="bg-slate-800 hover:bg-slate-700 rounded-2xl p-4 flex items-center gap-4 text-left transition-colors border border-slate-700 border-dashed"
        >
          <span className="text-3xl">🔦</span>
          <div>
            <p className="text-white font-semibold">カスタム</p>
            <p className="text-slate-400 text-xs mt-0.5">ランプ種別を問わず撮影・分析</p>
          </div>
        </button>
      </div>

      {entries.length > 0 && (
        <div className="mt-6 bg-slate-800 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-3">直近の検証</p>
          {[...entries].slice(-3).reverse().map(e => (
            <div key={e.id} className="flex items-center gap-3 text-xs py-2 border-b border-slate-700 last:border-0">
              <img src={e.imageDataUrl} className="w-10 h-7 rounded object-cover shrink-0" />
              <span className="text-slate-300 flex-1 truncate">{e.lampLabel}</span>
              <span className="font-mono text-slate-500">H={e.stats.hsv.h}° V={e.stats.hsv.v}%</span>
              <span className={e.groundTruth === 'lit' ? 'text-green-400' : 'text-slate-400'}>
                {e.groundTruth === 'lit' ? '点灯' : '消灯'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
