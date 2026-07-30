import { useState, useEffect } from 'react';
import { LAMPS } from './lamps';
import { CameraCapture } from './components/CameraCapture';
import { RoiSelector } from './components/RoiSelector';
import { DiffCapture } from './components/DiffCapture';
import { DiffCandidates } from './components/DiffCandidates';
import { VerificationResult } from './components/VerificationResult';
import { AccuracyReport } from './components/AccuracyReport';
import { VideoUpload } from './components/VideoUpload';
import { VideoResult } from './components/VideoResult';
import { analyzeROI } from './api/colorAnalysis';
import type { ROI, FullAnalysis } from './api/colorAnalysis';
import { detectDiffRegions } from './api/diffDetection';
import type { DiffCandidate } from './api/diffDetection';
import { analyzeVideoFile } from './api/videoAnalysis';
import type { VideoAnalysisResult } from './api/videoAnalysis';
import type { VerificationEntry, GroundTruth } from './types';
import type { MethodResult } from './api/colorAnalysis';
import { saveEntry, loadAllEntries, deleteEntry, clearAllEntries } from './storage/db';

type Phase =
  | 'select'
  | 'camera'
  | 'roi'
  | 'diffCapture'
  | 'diffCandidates'
  | 'result'
  | 'report'
  | 'videoUpload'
  | 'videoProcessing'
  | 'videoResult';

export default function App() {
  const [phase, setPhase] = useState<Phase>('select');
  const [lampLabel, setLampLabel] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FullAnalysis | null>(null);
  const [entries, setEntries] = useState<VerificationEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoDetect, setAutoDetect] = useState(false);
  const [diffCandidatesList, setDiffCandidatesList] = useState<DiffCandidate[]>([]);
  const [diffProcessing, setDiffProcessing] = useState(false);
  const [videoResult, setVideoResult] = useState<VideoAnalysisResult | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    loadAllEntries().then(setEntries).catch(console.error);
  }, []);

  // Revoke the previous object URL whenever it changes (new video selected / cleared) and on
  // unmount, so we don't leak blob: URLs as the user tries multiple clips.
  useEffect(() => {
    return () => {
      if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    };
  }, [videoObjectUrl]);

  const handleSelectLamp = (label: string) => {
    setLampLabel(label);
    setCapturedImage(null);
    setAnalysis(null);
    setError(null);
    setPhase(autoDetect ? 'diffCapture' : 'camera');
  };

  const handleCapture = (dataUrl: string) => {
    setCapturedImage(dataUrl);
    setPhase('roi');
  };

  const handleDiffComplete = async (baseDataUrl: string, litDataUrl: string) => {
    setCapturedImage(litDataUrl);
    setDiffProcessing(true);
    setPhase('diffCandidates');
    try {
      const candidates = await detectDiffRegions(baseDataUrl, litDataUrl);
      setDiffCandidatesList(candidates);
    } catch {
      setDiffCandidatesList([]);
    } finally {
      setDiffProcessing(false);
    }
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

  const handleRecord = async (gt: GroundTruth, claudeResult: MethodResult | null) => {
    if (!analysis || !capturedImage) return;
    const predictions = claudeResult
      ? [...analysis.predictions, claudeResult]
      : analysis.predictions;
    const entry: VerificationEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      lampLabel,
      imageDataUrl: capturedImage,
      stats: analysis.stats,
      predictions,
      groundTruth: gt,
    };
    await saveEntry(entry).catch(console.error);
    setEntries(prev => [...prev, entry]);
    setPhase('select');
  };

  const handleDelete = async (id: string) => {
    await deleteEntry(id).catch(console.error);
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleClear = async () => {
    await clearAllEntries().catch(console.error);
    setEntries([]);
  };

  const handleVideoSelected = async (file: File) => {
    setVideoError(null);
    setVideoResult(null);
    setVideoObjectUrl(URL.createObjectURL(file));
    setPhase('videoProcessing');
    try {
      const result = await analyzeVideoFile(file);
      setVideoResult(result);
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase('videoResult');
    }
  };

  const handleVideoRetake = () => {
    setVideoObjectUrl(null);
    setVideoResult(null);
    setVideoError(null);
    setPhase('videoUpload');
  };

  // Without this, dropping a video file ANYWHERE on the page (the user did this on the top
  // screen, not just the dedicated upload dropzone) hits the browser's default behavior: it
  // navigates the tab to the file and plays it, silently abandoning the app. VideoUpload's own
  // onDrop already preventDefault/stopPropagation()s for drops on its dropzone specifically, but
  // a drop on any other element (e.g. the 'select' phase, which has no dropzone at all) would
  // still bubble up to the window and trigger the browser default without this. Listening at the
  // window level (no capture) catches every drop after any element-level handler has already run,
  // and calling preventDefault() here only suppresses the browser's default action — it does not
  // stop the element-level handlers that already ran, so the two layers don't conflict.
  useEffect(() => {
    const preventDefault = (e: DragEvent) => e.preventDefault();
    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      if (phase !== 'select') return;
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('video/')) {
        handleVideoSelected(file);
      }
    };
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [phase]);

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

  if (phase === 'diffCapture') {
    return <DiffCapture onComplete={handleDiffComplete} onCancel={() => setPhase('select')} />;
  }

  if (phase === 'diffCandidates' && capturedImage) {
    if (diffProcessing) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-3">
          <div className="w-8 h-8 border-4 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">差分を解析中...</p>
        </div>
      );
    }
    return (
      <DiffCandidates
        imageDataUrl={capturedImage}
        candidates={diffCandidatesList}
        onSelect={handleRoiConfirm}
        onRetake={() => setPhase('diffCapture')}
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
        onRecord={(gt, cr) => handleRecord(gt, cr)}
        onRetake={() => setPhase('camera')}
      />
    );
  }

  if (phase === 'report') {
    return (
      <AccuracyReport
        entries={entries}
        onClear={handleClear}
        onDelete={handleDelete}
        onBack={() => setPhase('select')}
      />
    );
  }

  if (phase === 'videoUpload') {
    return <VideoUpload onSelect={handleVideoSelected} onCancel={() => setPhase('select')} />;
  }

  if (phase === 'videoProcessing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-3">
        <div className="w-8 h-8 border-4 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">動画を解析中...（フレーム抽出・位置検出）</p>
      </div>
    );
  }

  if (phase === 'videoResult') {
    if (videoError || !videoResult) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 gap-4">
          <p className="text-red-400 text-center">エラー: {videoError}</p>
          <button onClick={handleVideoRetake} className="bg-blue-600 text-white px-6 py-3 rounded-2xl">
            やり直す
          </button>
        </div>
      );
    }
    return <VideoResult result={videoResult} videoUrl={videoObjectUrl} onRetake={handleVideoRetake} />;
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

      <button
        onClick={() => setAutoDetect(v => !v)}
        className={`mb-4 flex items-center justify-between rounded-2xl p-3 border transition-colors ${
          autoDetect ? 'bg-blue-900/40 border-blue-600' : 'bg-slate-800 border-slate-700'
        }`}
      >
        <div className="text-left">
          <p className="text-white text-sm font-semibold">🫨 手ブレ補正 自動検出モード（検証）</p>
          <p className="text-slate-400 text-xs mt-0.5">消灯/点灯の2枚を撮影し、明るくなった位置を自動検出します</p>
        </div>
        <div className={`w-11 h-6 rounded-full shrink-0 ml-3 relative transition-colors ${autoDetect ? 'bg-blue-500' : 'bg-slate-600'}`}>
          <div
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              autoDetect ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </div>
      </button>

      <button
        onClick={() => setPhase('videoUpload')}
        className="mb-4 flex items-center justify-between rounded-2xl p-3 border bg-slate-800 border-slate-700 hover:border-purple-600 transition-colors text-left"
      >
        <div>
          <p className="text-white text-sm font-semibold">🎥 動画検査モード（検証）</p>
          <p className="text-slate-400 text-xs mt-0.5">動画をアップロードし、複数の点灯位置と強弱の時間変化を自動検出します</p>
        </div>
      </button>

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
