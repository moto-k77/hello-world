import { useState } from 'react';
import type { LampDefinition, InspectionResult } from '../types';
import { CameraCapture } from './CameraCapture';
import { RoiSelector } from './RoiSelector';
import { analyzeLampImage } from '../api/canvasAnalysis';
import type { ROI } from '../api/canvasAnalysis';

interface Props {
  lamp: LampDefinition;
  stepIndex: number;
  totalSteps: number;
  onComplete: (result: InspectionResult) => void;
  onSkip: () => void;
}

type Phase = 'instruction' | 'camera' | 'roi-select' | 'analyzing' | 'result';

export function InspectionStep({ lamp, stepIndex, totalSteps, onComplete, onSkip }: Props) {
  const [phase, setPhase] = useState<Phase>('instruction');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{
    isLit: boolean;
    confidence: string;
    intensity: 'strong' | 'normal' | 'weak' | null;
    comment: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = (dataUrl: string) => {
    setCapturedImage(dataUrl);
    setPhase('roi-select');
  };

  const handleRoiConfirm = async (roi: ROI) => {
    if (!capturedImage) return;
    setPhase('analyzing');
    setError(null);
    try {
      const result = await analyzeLampImage(capturedImage, lamp.id, roi);
      setAnalysisResult(result);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('result');
    }
  };

  const handleAccept = () => {
    onComplete({
      lampId: lamp.id,
      status: analysisResult?.isLit ? 'ok' : 'ng',
      intensity: analysisResult?.intensity,
      imageDataUrl: capturedImage ?? undefined,
      aiComment: analysisResult?.comment,
      timestamp: Date.now(),
    });
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setAnalysisResult(null);
    setError(null);
    setPhase('camera');
  };

  if (phase === 'camera') {
    return <CameraCapture onCapture={handleCapture} onCancel={() => setPhase('instruction')} />;
  }

  if (phase === 'roi-select' && capturedImage) {
    return (
      <RoiSelector
        imageDataUrl={capturedImage}
        lampLabel={lamp.label}
        onConfirm={handleRoiConfirm}
        onRetake={handleRetake}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 p-4">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-6">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? 'bg-blue-500' : 'bg-slate-700'}`}
          />
        ))}
      </div>

      <div className="text-slate-400 text-sm mb-1">
        {stepIndex + 1} / {totalSteps}
      </div>

      {phase === 'instruction' && (
        <>
          <div className="flex-1 flex flex-col justify-center">
            <div className="text-6xl text-center mb-4">{lamp.icon}</div>
            <h2 className="text-2xl font-bold text-white text-center mb-2">{lamp.label}</h2>
            <div className="bg-amber-900/40 border border-amber-700/50 rounded-2xl p-4 mt-6">
              <p className="text-amber-200 text-sm font-medium text-center leading-relaxed">
                {lamp.instruction}
              </p>
            </div>
            <p className="text-slate-400 text-xs text-center mt-4">
              上記の操作を行ってから、カメラを起動してください
            </p>
          </div>
          <div className="flex flex-col gap-3 mt-4">
            <button
              onClick={() => setPhase('camera')}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
            >
              📷　カメラ起動
            </button>
            <button onClick={onSkip} className="w-full text-slate-500 py-2 text-sm">
              スキップ
            </button>
          </div>
        </>
      )}

      {phase === 'analyzing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          {capturedImage && (
            <img src={capturedImage} className="w-full max-w-xs rounded-2xl object-cover" />
          )}
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-300 text-sm">ピクセル解析中...</p>
          </div>
        </div>
      )}

      {phase === 'result' && (
        <div className="flex-1 flex flex-col">
          <h2 className="text-xl font-bold text-white mb-4">{lamp.label} — 判定結果</h2>

          {capturedImage && (
            <img src={capturedImage} className="w-full rounded-2xl object-cover mb-4 max-h-52" />
          )}

          {error ? (
            <div className="bg-red-900/40 border border-red-700/50 rounded-2xl p-4 mb-4">
              <p className="text-red-300 text-sm">⚠️ エラー: {error}</p>
            </div>
          ) : analysisResult ? (
            <div
              className={`rounded-2xl p-4 mb-4 border ${
                analysisResult.isLit
                  ? 'bg-green-900/40 border-green-700/50'
                  : 'bg-red-900/40 border-red-700/50'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl">{analysisResult.isLit ? '✅' : '❌'}</span>
                <div className="flex-1">
                  <p
                    className={`font-bold text-lg ${
                      analysisResult.isLit ? 'text-green-300' : 'text-red-300'
                    }`}
                  >
                    {analysisResult.isLit ? '点灯 OK' : '点灯 NG'}
                  </p>
                  <p className="text-slate-400 text-xs">信頼度: {analysisResult.confidence}</p>
                </div>
                {analysisResult.isLit && analysisResult.intensity && (
                  <span
                    className={`text-sm font-bold px-3 py-1 rounded-full ${
                      analysisResult.intensity === 'strong'
                        ? 'bg-yellow-500/30 text-yellow-300 border border-yellow-500/50'
                        : analysisResult.intensity === 'normal'
                          ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50'
                          : 'bg-slate-500/30 text-slate-300 border border-slate-500/50'
                    }`}
                  >
                    {analysisResult.intensity === 'strong' ? '🔆 強' : analysisResult.intensity === 'normal' ? '💡 普通' : '🔅 弱'}
                  </span>
                )}
              </div>
              <p className="text-slate-300 text-sm">{analysisResult.comment}</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 mt-auto">
            {(analysisResult || error) && (
              <button
                onClick={error ? handleRetake : handleAccept}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
              >
                {error ? '撮り直す' : '次へ →'}
              </button>
            )}
            {!error && (
              <button
                onClick={handleRetake}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-2xl transition-colors"
              >
                撮り直す
              </button>
            )}
            <button onClick={onSkip} className="w-full text-slate-500 py-2 text-sm">
              スキップ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
