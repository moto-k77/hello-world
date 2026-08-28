import { useRef, useState } from 'react';
import type { ROI } from '../api/colorAnalysis';

interface Props {
  referenceFrameDataUrl: string;
  width: number; // natural (working-frame) width, matches ROI coordinate space
  height: number; // natural (working-frame) height
  initialRois: ROI[];
  onConfirm: (rois: ROI[]) => void;
  onCancel: () => void;
}

type DragMode = 'move' | 'resize';

interface DragState {
  mode: DragMode;
  index: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startRoi: ROI;
}

// Exported so LiveCapture.tsx's aim-phase box editor (manual ROI placement before recording) uses
// the exact same default-box and clamping geometry as this editor, rather than a second copy that
// could silently drift out of sync.
export function defaultCenteredRoi(width: number, height: number): ROI {
  const size = Math.min(width, height) * 0.2;
  return {
    x: (width - size) / 2,
    y: (height - size) / 2,
    width: size,
    height: size,
  };
}

// Clamp a ROI to the frame bounds, enforcing a minimum size so a drag-to-resize can't collapse a
// box to nothing (and so it stays a usable ROI for classification).
export function clampRoi(roi: ROI, width: number, height: number): ROI {
  const minSize = Math.min(width, height) * 0.04;
  let w = Math.max(minSize, Math.min(roi.width, width));
  let h = Math.max(minSize, Math.min(roi.height, height));
  let x = Math.max(0, Math.min(roi.x, width - w));
  let y = Math.max(0, Math.min(roi.y, height - h));
  return { x, y, width: w, height: h };
}

export function VideoRoiEditor({ referenceFrameDataUrl, width, height, initialRois, onConfirm, onCancel }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [rois, setRois] = useState<ROI[]>(() =>
    initialRois.length > 0 ? initialRois : [defaultCenteredRoi(width, height)],
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(initialRois.length > 0 ? null : 0);

  // Display px → working-frame px scale factor, derived from the rendered <img>'s actual box
  // (same convention as RoiSelector.tsx's tap-to-ROI conversion).
  const scaleFactors = () => {
    const img = imgRef.current;
    if (!img) return { scaleX: 1, scaleY: 1 };
    const rect = img.getBoundingClientRect();
    return {
      scaleX: rect.width > 0 ? width / rect.width : 1,
      scaleY: rect.height > 0 ? height / rect.height : 1,
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
    if (!drag || e.pointerId !== drag.pointerId) return;
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
      next[drag.index] = clampRoi(updated, width, height);
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
    setRois(prev => {
      const next = [...prev, defaultCenteredRoi(width, height)];
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

  const handleConfirm = () => {
    if (rois.length === 0) return;
    onConfirm(rois);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4 gap-4 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">✏️ 判定枠を編集</h2>
        <button onClick={onCancel} className="text-xs text-slate-400 underline">キャンセル</button>
      </div>

      <p className="text-slate-400 text-xs leading-relaxed">
        枠をドラッグして移動、選択中の枠の右下ハンドルをドラッグしてサイズ変更できます。タップで枠を選択します。
        1つのランプに対して1つの枠になるよう、隣接するランプは枠を分けてください。
      </p>

      <div
        className="relative w-full rounded-2xl overflow-hidden bg-black"
        style={{ touchAction: 'none' }}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={handleBackgroundPointerDown}
      >
        <img
          ref={imgRef}
          src={referenceFrameDataUrl}
          className="w-full rounded-2xl select-none pointer-events-none block"
          draggable={false}
        />
        {rois.map((roi, i) => {
          const left = (roi.x / width) * 100;
          const top = (roi.y / height) * 100;
          const w = (roi.width / width) * 100;
          const h = (roi.height / height) * 100;
          const selected = i === selectedIndex;
          return (
            <div
              key={i}
              onPointerDown={e => beginDrag(e, i, 'move')}
              className={`absolute rounded-lg border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.85)] ${
                selected ? 'border-blue-400' : 'border-slate-400'
              }`}
              style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%`, touchAction: 'none' }}
              data-roi-index={i}
            >
              <span className="absolute -top-5 left-0 text-xs font-bold text-white bg-black/60 px-1.5 py-0.5 rounded whitespace-nowrap">
                位置{i + 1}
              </span>
              {selected && (
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

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleAdd}
          className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-2xl transition-colors"
        >
          ＋ 枠を追加
        </button>
        <button
          onClick={handleDelete}
          disabled={selectedIndex === null}
          className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-2xl transition-colors"
        >
          選択した枠を削除
        </button>
      </div>

      <button
        onClick={handleConfirm}
        disabled={rois.length === 0}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
      >
        この枠で再解析 →
      </button>
      <button
        onClick={onCancel}
        className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-2xl transition-colors"
      >
        キャンセル
      </button>
    </div>
  );
}
