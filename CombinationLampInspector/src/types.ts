export type LampId =
  | 'tail'
  | 'brake'
  | 'winker_left'
  | 'winker_right'
  | 'reverse';

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

export interface InspectionSession {
  id: string;
  vehicleId: string;
  startedAt: number;
  results: InspectionResult[];
}
