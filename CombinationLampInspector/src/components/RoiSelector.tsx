import { useRef, useState } from 'react';
import type { ROI } from '../api/canvasAnalysis';

interface Props {
  imageDataUrl: string;
  lampLabel: string;
  onConfirm: (roi: ROI) => void;
  onRetake: () => void;
}

export function RoiSelector({ imageDataUrl, lampLabel, onConfirm, onRetake }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [tapDisplay, setTapDisplay] = useState<{ x: number; y: number } | null>(null);
  const [roi, setRoi] = useState<ROI | null>(null);

  const handleTap = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const img = imgRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const displayX = clientX - rect.left;
    const displayY = clientY - rect.top;

    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const imgX = displayX * scaleX;
    const imgY = displayY * scaleY;

    // ROI = 22% of the shorter image dimension, centered on tap
    const roiSize = Math.min(img.naturalWidth, img.naturalHeight) * 0.22;

    setTapDisplay({ x: displayX, y: displayY });
    setRoi({
      x: imgX - roiSize / 2,
      y: imgY - roiSize / 2,
      width: roiSize,
      height: roiSize,
    });
  };

  // Visual circle size in display pixels
  const circleSize = 72;

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 p-4">
      <h2 className="text-white font-bold text-xl mb-1">ランプ位置をタップ</h2>
      <p className="text-slate-400 text-sm mb-4">
        画像内の <span className="text-yellow-300 font-semibold">{lampLabel}</span>{' '}
        のレンズ部分をタップしてください
      </p>

      <div
        className="relative w-full flex-1 min-h-0"
        onClick={handleTap}
        onTouchEnd={handleTap}
      >
        <img
          ref={imgRef}
          src={imageDataUrl}
          className="w-full rounded-2xl select-none"
          draggable={false}
          style={{ touchAction: 'none' }}
        />
        {tapDisplay && (
          <div
            className="absolute pointer-events-none border-4 border-yellow-400 rounded-full"
            style={{
              width: circleSize,
              height: circleSize,
              left: tapDisplay.x - circleSize / 2,
              top: tapDisplay.y - circleSize / 2,
            }}
          />
        )}
        {!tapDisplay && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/60 rounded-xl px-4 py-2">
              <p className="text-white text-sm text-center">👆 ランプをタップ</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 mt-4">
        {roi && (
          <button
            onClick={() => onConfirm(roi)}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
          >
            この位置で解析 →
          </button>
        )}
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
