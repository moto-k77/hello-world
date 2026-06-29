import { useState } from 'react';

interface Props {
  onSave: (key: string) => void;
}

export function ApiKeySetup({ onSave }: Props) {
  const [value, setValue] = useState('');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-900">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🔦</div>
          <h1 className="text-2xl font-bold text-white">コンビネーションランプ検査</h1>
          <p className="text-slate-400 text-sm mt-2">Combination Lamp Inspector</p>
        </div>

        <div className="bg-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-white font-semibold mb-2">APIキー設定</h2>
          <p className="text-slate-400 text-xs mb-4">
            Claude APIキーを入力してください。キーはデバイス上にのみ保存されます。
          </p>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full bg-slate-700 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
          <button
            onClick={() => value.trim() && onSave(value.trim())}
            disabled={!value.trim()}
            className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
          >
            開始する
          </button>
        </div>
      </div>
    </div>
  );
}
