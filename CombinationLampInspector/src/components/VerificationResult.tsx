import { useState, useEffect } from 'react';
import type { RawColorStats, MethodResult, Verdict, LampColor } from '../api/colorAnalysis';
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

// ── helpers ──────────────────────────────────────────────

function verdictText(v: Verdict) {
  if (v === 'unlit')      return { label: '消灯',   style: 'bg-slate-700 text-slate-300' };
  if (v === 'lit-weak')   return { label: '弱点灯', style: 'bg-yellow-700/60 text-yellow-200' };
  if (v === 'lit-normal') return { label: '点灯',   style: 'bg-green-700/60 text-green-100' };
  return                         { label: '強点灯', style: 'bg-green-500/80 text-white font-extrabold' };
}

function intensityText(v: Verdict) {
  if (v === 'unlit')      return { label: '—',  style: 'bg-slate-700 text-slate-500' };
  if (v === 'lit-weak')   return { label: '弱',  style: 'bg-yellow-700/60 text-yellow-200' };
  if (v === 'lit-normal') return { label: '普通', style: 'bg-blue-700/60 text-blue-200' };
  return                         { label: '強',  style: 'bg-orange-500/80 text-white font-extrabold' };
}

const COLOR_STYLE: Record<string, string> = {
  '赤': 'bg-red-600/70 text-red-100',
  '橙': 'bg-orange-500/70 text-orange-100',
  '白': 'bg-slate-200/80 text-slate-900',
  '黄': 'bg-yellow-400/80 text-yellow-900',
  '不明': 'bg-slate-600 text-slate-300',
};

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

// Majority for each dimension
function majorityVerdict(preds: MethodResult[]): Verdict {
  const c: Record<Verdict, number> = { 'unlit': 0, 'lit-weak': 0, 'lit-normal': 0, 'lit-strong': 0 };
  preds.forEach(p => c[p.verdict]++);
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as Verdict;
}

function majorityColor(preds: MethodResult[]): LampColor | null {
  const litPreds = preds.filter(p => p.verdict !== 'unlit' && p.color);
  if (!litPreds.length) return null;
  const c: Record<string, number> = {};
  litPreds.forEach(p => { if (p.color) c[p.color] = (c[p.color] ?? 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as LampColor;
}

// ── component ────────────────────────────────────────────

export function VerificationResult({ lampLabel, imageDataUrl, stats, predictions, onRecord, onRetake }: Props) {
  const { rgb, hsv, ycbcr, peakLum } = stats;

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [claudeResult, setClaudeResult] = useState<MethodResult | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [claudeError, setClaudeError] = useState('');

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

  const allPreds = claudeResult ? [...predictions, claudeResult] : predictions;
  const mv = majorityVerdict(allPreds);
  const mc = majorityColor(allPreds);
  const { label: mvLabel, style: mvStyle } = verdictText(mv);
  const { label: miLabel, style: miStyle } = intensityText(mv);

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4 gap-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{lampLabel} — 解析結果</h2>
        <button onClick={onRetake} className="text-xs text-slate-400 underline">撮り直す</button>
      </div>

      <img src={imageDataUrl} className="w-full rounded-2xl object-cover max-h-44" />

      {/* ── 3-item verdict summary ── */}
      <div className="grid grid-cols-3 gap-3">
        {/* 点灯/消灯 */}
        <div className="bg-slate-800 rounded-2xl p-3 flex flex-col items-center gap-1">
          <p className="text-xs text-slate-500">点灯状態</p>
          <span className={`text-sm font-bold px-3 py-1.5 rounded-xl text-center w-full text-center ${mvStyle}`}>
            {mvLabel}
          </span>
        </div>
        {/* 色 */}
        <div className="bg-slate-800 rounded-2xl p-3 flex flex-col items-center gap-1">
          <p className="text-xs text-slate-500">ランプ色</p>
          <span className={`text-sm font-bold px-3 py-1.5 rounded-xl text-center w-full text-center ${mc ? COLOR_STYLE[mc] : 'bg-slate-700 text-slate-500'}`}>
            {mc ?? '—'}
          </span>
        </div>
        {/* 強さ */}
        <div className="bg-slate-800 rounded-2xl p-3 flex flex-col items-center gap-1">
          <p className="text-xs text-slate-500">点灯強度</p>
          <span className={`text-sm font-bold px-3 py-1.5 rounded-xl text-center w-full text-center ${miStyle}`}>
            {miLabel}
          </span>
        </div>
      </div>

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
          <div><p className="text-slate-500">RGB</p><p className="text-slate-300 font-mono">{Math.round(rgb.r)}/{Math.round(rgb.g)}/{Math.round(rgb.b)}</p></div>
          <div><p className="text-slate-500">HSV</p><p className="text-slate-300 font-mono">{hsv.h}°/{hsv.s}%/{hsv.v}%</p></div>
          <div><p className="text-slate-500">YCbCr</p><p className="text-slate-300 font-mono">{ycbcr.y}/{ycbcr.cb}/{ycbcr.cr}</p></div>
        </div>
      </div>

      {/* Method breakdown table */}
      <div className="bg-slate-800 rounded-2xl p-4 space-y-2">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">手法別詳細</p>

        {/* Header row */}
        <div className="grid grid-cols-4 text-xs text-slate-500 px-1">
          <span>手法</span><span className="text-center">点灯</span><span className="text-center">色</span><span className="text-center">強さ</span>
        </div>

        {predictions.map(p => (
          <div key={p.method} className="grid grid-cols-4 items-center gap-1 bg-slate-700/40 rounded-xl px-3 py-2">
            <span className="text-xs font-bold text-slate-300">{p.method}</span>
            <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${verdictText(p.verdict).style}`}>
              {p.verdict === 'unlit' ? '消灯' : '点灯'}
            </span>
            <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${p.color ? COLOR_STYLE[p.color] : 'bg-slate-600 text-slate-400'}`}>
              {p.color ?? '—'}
            </span>
            <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${intensityText(p.verdict).style}`}>
              {intensityText(p.verdict).label}
            </span>
          </div>
        ))}

        {/* Claude AI row */}
        {claudeStatus === 'done' && claudeResult ? (
          <div className="grid grid-cols-5 items-center gap-1 bg-purple-900/30 border border-purple-700/40 rounded-xl px-3 py-2">
            <span className="text-xs font-bold text-purple-300">Claude</span>
            <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${verdictText(claudeResult.verdict).style}`}>
              {claudeResult.verdict === 'unlit' ? '消灯' : '点灯'}
            </span>
            <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${claudeResult.color ? COLOR_STYLE[claudeResult.color] : 'bg-slate-600 text-slate-400'}`}>
              {claudeResult.color ?? '—'}
            </span>
            <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${intensityText(claudeResult.verdict).style}`}>
              {intensityText(claudeResult.verdict).label}
            </span>
            <button
              onClick={() => { setShowKeyInput(true); setKeyDraft(apiKey); }}
              className="text-xs text-purple-300 hover:text-purple-100 justify-self-end"
              title="APIキーを再設定"
            >
              ⚙
            </button>
          </div>
        ) : (
          <div className="bg-purple-900/20 border border-purple-700/30 rounded-xl px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-bold text-purple-300">Claude AI</span>
            <div className="flex items-center gap-2">
              {claudeStatus === 'loading' && (
                <>
                  <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-purple-300">解析中…</span>
                </>
              )}
              {claudeStatus === 'error' && (
                <>
                  <span className="text-xs text-red-400 truncate max-w-32">{claudeError}</span>
                  <button onClick={() => apiKey ? runClaude(apiKey) : setShowKeyInput(true)} className="text-xs bg-slate-600 px-2 py-0.5 rounded text-white shrink-0">再試行</button>
                </>
              )}
              {claudeStatus !== 'loading' && (
                <button onClick={() => { setShowKeyInput(true); setKeyDraft(apiKey); }} className="text-xs bg-purple-700 hover:bg-purple-600 text-white px-2 py-1 rounded-lg shrink-0">
                  {apiKey ? 'キー変更' : 'APIキー設定'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Majority row */}
        <div className="grid grid-cols-4 items-center gap-1 border border-white/20 rounded-xl px-3 py-2">
          <span className="text-xs font-bold text-slate-300">多数決</span>
          <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${mvStyle}`}>
            {mv === 'unlit' ? '消灯' : '点灯'}
          </span>
          <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${mc ? COLOR_STYLE[mc] : 'bg-slate-700 text-slate-500'}`}>
            {mc ?? '—'}
          </span>
          <span className={`text-xs font-bold text-center px-1 py-0.5 rounded-lg ${miStyle}`}>
            {miLabel}
          </span>
        </div>

        {/* Claude comment */}
        {claudeStatus === 'done' && claudeResult && (
          <p className="text-xs text-slate-400 italic px-1">💬 {claudeResult.reasoning}</p>
        )}
      </div>

      {/* API key modal */}
      {showKeyInput && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50" onClick={() => setShowKeyInput(false)}>
          <div className="w-full bg-slate-800 rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold">Anthropic APIキー</h3>
            <p className="text-xs text-slate-400">キーはブラウザのlocalStorageに保存されます。</p>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-purple-500 font-mono"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowKeyInput(false)} className="bg-slate-700 text-white py-3 rounded-xl font-semibold text-sm">キャンセル</button>
              <button onClick={saveKey} disabled={!keyDraft.trim()} className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white py-3 rounded-xl font-semibold text-sm">保存して実行</button>
            </div>
          </div>
        </div>
      )}

      {/* Ground truth */}
      <div className="bg-slate-800 rounded-2xl p-4">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">実際の状態を記録</p>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => onRecord('lit', claudeResult)} className="bg-green-700 hover:bg-green-600 text-white font-bold py-4 rounded-2xl text-sm transition-colors">
            ✅ 点灯していた
          </button>
          <button onClick={() => onRecord('unlit', claudeResult)} className="bg-slate-600 hover:bg-slate-500 text-white font-bold py-4 rounded-2xl text-sm transition-colors">
            ⬛ 消灯していた
          </button>
        </div>
      </div>
    </div>
  );
}
