import { useState, useEffect } from 'react';
import type { RawColorStats, MethodResult, Verdict } from '../api/colorAnalysis';
import { analyzeWithClaude } from '../api/claudeAnalysis';
import type { GroundTruth } from '../types';

const API_KEY_STORAGE = 'claude_api_key';

interface Props {
  lampLabel: string;
  imageDataUrl: string;
  stats: RawColorStats;
  predictions: MethodResult[];
  onRecord: (gt: GroundTruth, claudeResult: MethodResult | null) => void;
  onRetake: () => void;
}

function verdictLabel(v: Verdict) {
  if (v === 'unlit')       return { text: '消灯',   color: 'text-slate-400', bg: 'bg-slate-700/50' };
  if (v === 'lit-weak')    return { text: '弱点灯', color: 'text-yellow-300', bg: 'bg-yellow-900/40' };
  if (v === 'lit-normal')  return { text: '点灯',   color: 'text-green-300',  bg: 'bg-green-900/40' };
  return                          { text: '強点灯', color: 'text-white',      bg: 'bg-green-700/60' };
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

function majorityVerdict(predictions: MethodResult[]): Verdict {
  const counts: Record<Verdict, number> = { 'unlit': 0, 'lit-weak': 0, 'lit-normal': 0, 'lit-strong': 0 };
  predictions.forEach(p => counts[p.verdict]++);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as Verdict;
}

export function VerificationResult({ lampLabel, imageDataUrl, stats, predictions, onRecord, onRetake }: Props) {
  const { rgb, hsv, ycbcr, peakLum } = stats;

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [claudeResult, setClaudeResult] = useState<MethodResult | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [claudeError, setClaudeError] = useState('');

  // Auto-run Claude if API key is already set
  useEffect(() => {
    if (apiKey) runClaude(apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runClaude(key: string) {
    setClaudeStatus('loading');
    setClaudeError('');
    try {
      const result = await analyzeWithClaude(imageDataUrl, lampLabel, key);
      setClaudeResult(result);
      setClaudeStatus('done');
    } catch (e) {
      setClaudeError(e instanceof Error ? e.message : String(e));
      setClaudeStatus('error');
    }
  }

  function saveKey() {
    const k = keyDraft.trim();
    if (!k) return;
    localStorage.setItem(API_KEY_STORAGE, k);
    setApiKey(k);
    setShowKeyInput(false);
    setKeyDraft('');
    runClaude(k);
  }

  const allPredictions = claudeResult ? [...predictions, claudeResult] : predictions;
  const mv = majorityVerdict(allPredictions);
  const { text: mvText, color: mvColor, bg: mvBg } = verdictLabel(mv);

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4 gap-4 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{lampLabel} — 解析結果</h2>
        <button onClick={onRetake} className="text-xs text-slate-400 underline">撮り直す</button>
      </div>

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
          <ColorBar label="Y"  value={ycbcr.y}  color="bg-slate-300" />
          <ColorBar label="Cb" value={ycbcr.cb} color="bg-blue-400" />
          <ColorBar label="Cr" value={ycbcr.cr} color="bg-red-400" />
        </div>
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

        {/* Pixel-based methods */}
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

        {/* Claude AI row */}
        <div className={`rounded-xl p-3 border border-purple-700/40 ${
          claudeStatus === 'done' ? verdictLabel(claudeResult!.verdict).bg : 'bg-purple-900/20'
        } flex items-start justify-between gap-2`}>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-bold text-purple-300">Claude AI</span>
            {claudeStatus === 'idle' && (
              <p className="text-xs text-slate-500 mt-0.5">APIキーを設定すると利用できます</p>
            )}
            {claudeStatus === 'loading' && (
              <div className="flex items-center gap-2 mt-1">
                <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-purple-300">解析中…</span>
              </div>
            )}
            {claudeStatus === 'done' && claudeResult && (
              <p className="text-xs text-slate-300 mt-0.5">{claudeResult.reasoning}</p>
            )}
            {claudeStatus === 'error' && (
              <p className="text-xs text-red-400 mt-0.5 break-all">{claudeError}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {claudeStatus === 'done' && claudeResult && (
              <span className={`text-sm font-bold ${verdictLabel(claudeResult.verdict).color}`}>
                {verdictLabel(claudeResult.verdict).text}
              </span>
            )}
            {(claudeStatus === 'idle' || claudeStatus === 'error') && (
              <button
                onClick={() => { setShowKeyInput(true); setKeyDraft(apiKey); }}
                className="text-xs bg-purple-700 hover:bg-purple-600 text-white px-2 py-1 rounded-lg transition-colors"
              >
                {apiKey ? '再設定' : 'APIキー設定'}
              </button>
            )}
            {claudeStatus === 'error' && apiKey && (
              <button
                onClick={() => runClaude(apiKey)}
                className="text-xs bg-slate-600 hover:bg-slate-500 text-white px-2 py-1 rounded-lg"
              >
                再実行
              </button>
            )}
          </div>
        </div>

        {/* Majority vote */}
        <div className={`rounded-xl p-3 ${mvBg} border border-white/10 flex items-center justify-between`}>
          <span className="text-xs font-bold text-slate-300">
            多数決（{allPredictions.length}手法）
          </span>
          <span className={`text-base font-bold ${mvColor}`}>{mvText}</span>
        </div>
      </div>

      {/* API key input modal */}
      {showKeyInput && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50" onClick={() => setShowKeyInput(false)}>
          <div className="w-full bg-slate-800 rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold">Anthropic APIキー</h3>
            <p className="text-xs text-slate-400">
              Claude Vision APIを使用するためのAPIキーを入力してください。
              キーはブラウザのlocalStorageに保存されます。
            </p>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-purple-500 font-mono"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowKeyInput(false)}
                className="bg-slate-700 text-white py-3 rounded-xl font-semibold text-sm"
              >
                キャンセル
              </button>
              <button
                onClick={saveKey}
                disabled={!keyDraft.trim()}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white py-3 rounded-xl font-semibold text-sm"
              >
                保存して実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ground truth input */}
      <div className="bg-slate-800 rounded-2xl p-4">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">実際の状態を記録</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onRecord('lit', claudeResult)}
            className="bg-green-700 hover:bg-green-600 text-white font-bold py-4 rounded-2xl text-sm transition-colors"
          >
            ✅ 点灯していた
          </button>
          <button
            onClick={() => onRecord('unlit', claudeResult)}
            className="bg-slate-600 hover:bg-slate-500 text-white font-bold py-4 rounded-2xl text-sm transition-colors"
          >
            ⬛ 消灯していた
          </button>
        </div>
      </div>
    </div>
  );
}
