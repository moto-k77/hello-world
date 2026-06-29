import { useRef, useEffect, useState, useCallback } from 'react';

interface Props {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}

export function CameraCapture({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      })
      .catch((e) => setError(e.message));

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    stream?.getTracks().forEach((t) => t.stop());
    onCapture(dataUrl);
  }, [stream, onCapture]);

  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50">
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
          <p className="text-red-400 text-center">{error}</p>
          <button onClick={onCancel} className="bg-slate-700 text-white px-6 py-3 rounded-xl">
            戻る
          </button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="flex-1 object-cover w-full"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Overlay guide */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="border-2 border-white/40 rounded-2xl w-5/6 h-1/2" />
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-8 flex items-center justify-center gap-6 bg-gradient-to-t from-black/70 to-transparent">
            <button
              onClick={onCancel}
              className="w-14 h-14 rounded-full bg-slate-700/80 flex items-center justify-center text-white text-xl"
            >
              ✕
            </button>
            <button
              onClick={capture}
              disabled={!ready}
              className="w-20 h-20 rounded-full bg-white disabled:bg-gray-500 flex items-center justify-center shadow-xl active:scale-95 transition-transform"
            >
              <div className="w-16 h-16 rounded-full bg-white border-4 border-slate-900" />
            </button>
            <div className="w-14 h-14" />
          </div>
        </>
      )}
    </div>
  );
}
