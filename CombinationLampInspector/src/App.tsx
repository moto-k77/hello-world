import { useState } from 'react';
import type { InspectionResult } from './types';
import { LAMPS } from './lamps';
import { InspectionStep } from './components/InspectionStep';
import { ResultsSummary } from './components/ResultsSummary';

type AppPhase = 'vehicle-entry' | 'inspection' | 'results';

export default function App() {
  const [vehicleInput, setVehicleInput] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [phase, setPhase] = useState<AppPhase>('vehicle-entry');
  const [stepIndex, setStepIndex] = useState(0);
  const [results, setResults] = useState<InspectionResult[]>([]);

  const handleStartInspection = () => {
    const id = vehicleInput.trim() || `VH-${Date.now()}`;
    setVehicleId(id);
    setResults([]);
    setStepIndex(0);
    setPhase('inspection');
  };

  const handleStepComplete = (result: InspectionResult) => {
    const newResults = [...results, result];
    setResults(newResults);
    if (stepIndex + 1 >= LAMPS.length) {
      setPhase('results');
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const handleSkip = () => {
    const newResults = [
      ...results,
      { lampId: LAMPS[stepIndex].id, status: 'skipped' as const, timestamp: Date.now() },
    ];
    setResults(newResults);
    if (stepIndex + 1 >= LAMPS.length) {
      setPhase('results');
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const handleRestart = () => {
    setVehicleInput('');
    setPhase('vehicle-entry');
  };

  if (phase === 'vehicle-entry') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-900">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">🚗</div>
            <h1 className="text-2xl font-bold text-white">車両情報入力</h1>
            <p className="text-slate-400 text-sm mt-1">検査する車両を識別する情報を入力</p>
          </div>
          <div className="bg-slate-800 rounded-2xl p-6 shadow-xl">
            <label className="text-slate-400 text-xs block mb-2">車両ID / ナンバー（任意）</label>
            <input
              type="text"
              placeholder="例: 品川 500 あ 1234"
              value={vehicleInput}
              onChange={(e) => setVehicleInput(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
            />
            <button
              onClick={handleStartInspection}
              className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              検査開始
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'inspection') {
    return (
      <InspectionStep
        key={stepIndex}
        lamp={LAMPS[stepIndex]}
        stepIndex={stepIndex}
        totalSteps={LAMPS.length}
        onComplete={handleStepComplete}
        onSkip={handleSkip}
      />
    );
  }

  return (
    <ResultsSummary vehicleId={vehicleId} results={results} onRestart={handleRestart} />
  );
}
