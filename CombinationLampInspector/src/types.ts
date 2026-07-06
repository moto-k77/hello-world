export type LampId = 'tail' | 'brake' | 'winker_left' | 'winker_right' | 'reverse';

export type LampStatus = 'pending' | 'ok' | 'ng' | 'skipped';

export interface LampDefinition {
  id: LampId;
  label: string;
  instruction: string;
  icon: string;
}

export interface InspectionResult {
  lampId: LampId;
  status: LampStatus;
  intensity?: 'strong' | 'normal' | 'weak' | null;
  imageDataUrl?: string;
  aiComment?: string;
  timestamp: number;
}

// Verification types
export type GroundTruth = 'lit' | 'unlit';

export interface VerificationEntry {
  id: string;
  timestamp: number;
  lampLabel: string;
  imageDataUrl: string;
  stats: import('./api/colorAnalysis').RawColorStats;
  predictions: import('./api/colorAnalysis').MethodResult[];
  groundTruth: GroundTruth;
}
