import { useRef, useState } from 'react';
import type { DiffCandidate } from '../api/diffDetection';
import type { ROI } from '../api/colorAnalysis';

interface Props {
  imageDataUrl: string;
  candidates: DiffCandidate[];
  onSelect: (roi: ROI) => void;
  onRetake: () => void;
}

export function DiffCandidates({ imageDataUrl, candidates, onSelect, onRetake }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  if (candidates.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 gap-6">
        <p className="text-slate-300 text-center">
          明るさの変化を検出できませんでした。
          <br />
          ランプがしっかり点灯しているか確認して撮り直してください。
        </p>
        <button onClick={onRetake} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold">
          撮り直す
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 p-4">
      <h2 className="text-white font-bold text-xl mb-1">検出されたランプ候補</h2>
      <p className="text-slate-400 text-sm mb-4">
        明るくなった箇所を自動検出しました（{candidates.length}件）。解析したい箇所をタップしてください
      </p>

      <div className="relative w-full flex-1 min-h-0">
        <img
          ref={imgRef}
          src={imageDataUrl}
          className="w-full rounded-2xl select-none"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
        {naturalSize &&
          candidates.map((c, i) => {
            const left = (c.roi.x / naturalSize.w) * 100;
            const top = (c.roi.y / naturalSize.h) * 100;
            const width = (c.roi.width / naturalSize.w) * 100;
            const height = (c.roi.height / naturalSize.h) * 100;
            const isSelected = selected === i;
            return (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className="absolute"
                style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
              >
                <div
                  className={`w-full h-full rounded-lg border-4 ${
                    isSelected ? 'border-blue-400 bg-blue-400/20' : 'border-yellow-400'
                  }`}
                />
                <span className="absolute -top-5 left-0 text-xs font-bold text-white bg-black/60 px-1.5 py-0.5 rounded">
                  候補{i + 1}
                </span>
              </button>
            );
          })}
      </div>

      <div className="flex flex-col gap-3 mt-4">
        <button
          onClick={() => selected !== null && onSelect(candidates[selected].roi)}
          disabled={selected === null}
          className="w-full bg-blue-600 disabled:bg-slate-700 disabled:text-slate-500 hover:bg-blue-500 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
        >
          この位置で解析 →
        </button>
        <button
          onClick={onRetake}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-2xl transition-colors"
        >
          撮り直す
        </button>
      </div>
    </div>
  );
}
