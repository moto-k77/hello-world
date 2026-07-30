import { useRef, useState } from 'react';

interface Props {
  onSelect: (file: File) => void;
  onCancel: () => void;
}

export function VideoUpload({ onSelect, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('動画ファイルを選択してください');
      return;
    }
    setError(null);
    onSelect(file);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white p-4">
      <div className="flex items-center justify-between mb-6 mt-2">
        <h2 className="text-lg font-bold">🎥 動画検査（検証）</h2>
        <button onClick={onCancel} className="text-xs text-slate-400 underline">戻る</button>
      </div>

      <p className="text-slate-400 text-sm mb-6 leading-relaxed">
        コンビネーションランプ全体が映った動画を選択してください。
        点灯している位置ごとに、色と強さの時間変化を自動検出します。
      </p>

      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full max-w-xs border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-2xl p-8 flex flex-col items-center gap-3 text-center transition-colors"
        >
          <span className="text-4xl">🎬</span>
          <p className="text-slate-300 text-sm font-semibold">動画ファイルを選択</p>
          <p className="text-slate-500 text-xs">タップしてカメラロールまたは撮影から選択</p>
        </button>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />

      <button
        onClick={onCancel}
        className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-2xl transition-colors mt-4"
      >
        キャンセル
      </button>
    </div>
  );
}
