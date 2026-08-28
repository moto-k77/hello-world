import { useRef, useState, useEffect, useCallback } from 'react';
import type { ROI, Verdict, LampColor } from '../api/colorAnalysis';
import { provisionalRoiState, classifyRoisAsResult, WORK_WIDTH } from '../api/videoAnalysis';
import type { VideoAnalysisResult } from '../api/videoAnalysis';
import { defaultCenteredRoi, clampRoi } from './VideoRoiEditor';

interface Props {
  onComplete: (result: VideoAnalysisResult, capNotice?: string) => void;
  onCancel: () => void;
}

// ~60s at 5fps. Caps the in-memory canvas buffer so a forgotten recording can't exhaust memory —
// recording stops itself and analysis runs on whatever was captured instead of growing forever.
const MAX_SAMPLED_FRAMES = 300;
const SAMPLE_FPS = 5;

type SubPhase = 'aim' | 'recording' | 'finishing';
type DragMode = 'move' | 'resize';

interface DragState {
  mode: DragMode;
  index: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startRoi: ROI;
}

interface BufferedFrame {
  canvas: HTMLCanvasElement;
  timestamp: number;
}

type ProvisionalLabel = { verdict: Verdict; color: LampColor | null } | null;

function verdictLabel(v: Verdict): string {
  if (v === 'unlit') return '消灯';
  if (v === 'lit-weak') return '弱';
  if (v === 'lit-normal') return '中';
  return '強';
}

function labelText(label: ProvisionalLabel): string {
  if (!label || label.verdict === 'unlit') return '消灯';
  return `${label.color ?? '不明'} ${verdictLabel(label.verdict)}`;
}

export function LiveCapture({ onComplete, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameBufferRef = useRef<BufferedFrame[]>([]);
  const intervalRef = useRef<number | null>(null);
  const recordStartRef = useRef(0);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subPhase, setSubPhase] = useState<SubPhase>('aim');
  const [workSize, setWorkSize] = useState<{ width: number; height: number } | null>(null);
  const [rois, setRois] = useState<ROI[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(0);
  const [elapsed, setElapsed] = useState(0);
  const [provisional, setProvisional] = useState<Record<number, ProvisionalLabel>>({});
  const [capped, setCapped] = useState(false);

  // ── camera setup / teardown (same pattern as CameraCapture.tsx) ──
  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((s) => {
        if (!active) { s.getTracks().forEach((t) => t.stop()); return; }
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.onloadedmetadata = () => {
            const video = videoRef.current;
            if (!video) return;
            const srcW = video.videoWidth || WORK_WIDTH;
            const srcH = video.videoHeight || WORK_WIDTH;
            const width = Math.min(WORK_WIDTH, srcW);
            const height = Math.max(1, Math.round((width * srcH) / srcW));
            setWorkSize({ width, height });
            setRois([defaultCenteredRoi(width, height)]);
          };
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      active = false;
    };
  }, []);

  // Stop every track whenever the stream reference changes (unmount included) — a left-running
  // camera on mobile is a real bug, not a cosmetic one.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, []);

  // ── aim-phase box editor (same interaction as VideoRoiEditor.tsx, background is a live <video>
  // instead of a static reference-frame <img>) ──
  const scaleFactors = () => {
    const video = videoRef.current;
    if (!video || !workSize) return { scaleX: 1, scaleY: 1 };
    const rect = video.getBoundingClientRect();
    return {
      scaleX: rect.width > 0 ? workSize.width / rect.width : 1,
      scaleY: rect.height > 0 ? workSize.height / rect.height : 1,
    };
  };

  const beginDrag = (e: React.PointerEvent, index: number, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIndex(index);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      index,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRoi: rois[index],
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId || !workSize) return;
    const { scaleX, scaleY } = scaleFactors();
    const dx = (e.clientX - drag.startClientX) * scaleX;
    const dy = (e.clientY - drag.startClientY) * scaleY;

    setRois(prev => {
      const next = prev.slice();
      const base = drag.startRoi;
      const updated: ROI =
        drag.mode === 'move'
          ? { ...base, x: base.x + dx, y: base.y + dy }
          : { ...base, width: base.width + dx, height: base.height + dy };
      next[drag.index] = clampRoi(updated, workSize.width, workSize.height);
      return next;
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag && e.pointerId === drag.pointerId) {
      dragRef.current = null;
    }
  };

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.target === e.currentTarget) setSelectedIndex(null);
  };

  const handleAdd = () => {
    if (!workSize) return;
    setRois(prev => {
      const next = [...prev, defaultCenteredRoi(workSize.width, workSize.height)];
      setSelectedIndex(next.length - 1);
      return next;
    });
  };

  const handleDelete = () => {
    if (selectedIndex === null) return;
    const toDelete = selectedIndex;
    setRois(prev => prev.filter((_, i) => i !== toDelete));
    setSelectedIndex(null);
  };

  // ── recording ──
  const finishRecording = useCallback((capNotice?: string) => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Stop the camera the moment recording ends — classification runs on the already-sampled
    // canvases, the live sensor is no longer needed.
    setStream(prev => {
      prev?.getTracks().forEach(t => t.stop());
      return null;
    });

    const buffer = frameBufferRef.current;
    if (!workSize || buffer.length === 0) {
      setError('フレームを取得できませんでした。撮り直してください。');
      return;
    }
    try {
      const sampled = {
        frames: buffer.map(f => f.canvas),
        timestamps: buffer.map(f => f.timestamp),
        width: workSize.width,
        height: workSize.height,
        duration: buffer[buffer.length - 1].timestamp,
      };
      const result = classifyRoisAsResult(sampled, rois);
      onComplete(result, capNotice);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workSize, rois, onComplete]);

  const startRecording = () => {
    if (!workSize || rois.length === 0) return;
    const ww = workSize.width;
    const wh = workSize.height;
    const capturedRois = rois;
    frameBufferRef.current = [];
    recordStartRef.current = performance.now();
    setElapsed(0);
    setProvisional({});
    setCapped(false);
    setSubPhase('recording');

    intervalRef.current = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const canvas = document.createElement('canvas');
      canvas.width = ww;
      canvas.height = wh;
      canvas.getContext('2d')!.drawImage(video, 0, 0, ww, wh);
      const t = (performance.now() - recordStartRef.current) / 1000;
      frameBufferRef.current.push({ canvas, timestamp: t });
      setElapsed(t);

      // Live provisional readout: a deliberately lighter classifier (see provisionalRoiState in
      // videoAnalysis.ts) run against everything sampled so far — NOT the authoritative buildSeries,
      // which assumes a full clip's worth of off-frames to find its baseline/weak-strong split and
      // gets stuck misreading a lamp that's been on since early in the recording. The "暫定" badge
      // in the UI still makes clear this coarse lit/unlit + current-hue reading isn't the final,
      // full-clip verdict.
      const frames = frameBufferRef.current.map(f => f.canvas);
      const labels: Record<number, ProvisionalLabel> = {};
      capturedRois.forEach((roi, i) => {
        labels[i] = provisionalRoiState(frames, roi);
      });
      setProvisional(labels);

      if (frameBufferRef.current.length >= MAX_SAMPLED_FRAMES) {
        // Stop sampling immediately, but hold on screen for a beat so the "上限に達しました" notice
        // is actually visible before the result screen replaces this component.
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setCapped(true);
        setSubPhase('finishing');
        window.setTimeout(() => finishRecording('録画時間の上限（約60秒）に達したため、自動的に解析を開始しました。'), 1200);
      }
    }, 1000 / SAMPLE_FPS);
  };

  const handleCancel = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    stream?.getTracks().forEach(t => t.stop());
    onCancel();
  };

  // ── render ──
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-8 gap-4">
        <p className="text-red-400 text-center">{error}</p>
        <button onClick={handleCancel} className="bg-slate-700 text-white px-6 py-3 rounded-xl">
          戻る
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4 gap-4 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">📹 カメラ撮影で検査（試験）</h2>
        <button onClick={handleCancel} className="text-xs text-slate-400 underline">キャンセル</button>
      </div>

      {subPhase === 'aim' && (
        <p className="text-slate-400 text-xs leading-relaxed">
          ランプ全体が映るようカメラを構え、枠をドラッグして移動、選択中の枠の右下ハンドルをドラッグしてサイズ変更してください。
          1つのランプに対して1つの枠になるよう、隣接するランプは枠を分けてください。位置が決まったら「録画開始」を押します。
        </p>
      )}
      {subPhase !== 'aim' && (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-red-400 text-sm font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            録画中
          </span>
          <span className="font-mono text-slate-300 text-sm">{elapsed.toFixed(1)}s</span>
          <span className="text-xs text-slate-500 ml-auto">枠の判定は「暫定」（解析中の速報値）です</span>
        </div>
      )}
      {capped && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-200 text-xs rounded-xl p-3">
          録画時間の上限（約60秒）に達しました。自動的に解析を開始します...
        </div>
      )}

      <div
        className="relative w-full rounded-2xl overflow-hidden bg-black"
        style={{ touchAction: 'none' }}
        onPointerMove={subPhase === 'aim' ? handlePointerMove : undefined}
        onPointerUp={subPhase === 'aim' ? endDrag : undefined}
        onPointerCancel={subPhase === 'aim' ? endDrag : undefined}
        onPointerDown={subPhase === 'aim' ? handleBackgroundPointerDown : undefined}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto block select-none"
        />
        {workSize && rois.map((roi, i) => {
          const left = (roi.x / workSize.width) * 100;
          const top = (roi.y / workSize.height) * 100;
          const w = (roi.width / workSize.width) * 100;
          const h = (roi.height / workSize.height) * 100;
          const selected = i === selectedIndex;
          const label = provisional[i] ?? null;
          const isLit = subPhase !== 'aim' && !!label && label.verdict !== 'unlit';
          return (
            <div
              key={i}
              onPointerDown={subPhase === 'aim' ? (e => beginDrag(e, i, 'move')) : undefined}
              className={`absolute rounded-lg border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.85)] ${
                subPhase === 'aim'
                  ? (selected ? 'border-blue-400' : 'border-slate-400')
                  : (isLit ? 'border-yellow-400' : 'border-slate-500')
              }`}
              style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%`, touchAction: 'none' }}
              data-roi-index={i}
            >
              <span className="absolute -top-5 left-0 text-xs font-bold text-white bg-black/60 px-1.5 py-0.5 rounded whitespace-nowrap">
                位置{i + 1}
                {subPhase !== 'aim' && (
                  <>
                    : {labelText(label)}{' '}
                    <span className="text-slate-400 font-normal">(暫定)</span>
                  </>
                )}
              </span>
              {subPhase === 'aim' && selected && (
                <div
                  onPointerDown={e => beginDrag(e, i, 'resize')}
                  className="absolute -bottom-3.5 -right-3.5 w-7 h-7 rounded-full bg-blue-500 border-2 border-white cursor-nwse-resize"
                  style={{ touchAction: 'none' }}
                  data-resize-handle
                />
              )}
            </div>
          );
        })}
      </div>

      {subPhase === 'aim' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleAdd}
              disabled={!workSize}
              className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              ＋ 枠を追加
            </button>
            <button
              onClick={handleDelete}
              disabled={selectedIndex === null}
              className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              削除
            </button>
          </div>
          <button
            onClick={startRecording}
            disabled={!workSize || rois.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
          >
            ● 録画開始
          </button>
        </>
      )}

      {subPhase !== 'aim' && (
        <button
          onClick={() => finishRecording()}
          disabled={subPhase === 'finishing'}
          className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
        >
          ■ 停止して解析
        </button>
      )}
    </div>
  );
}
