import type { VerificationEntry } from '../types';

const DB_NAME = 'lamp-inspector';
const STORE = 'verifications';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveEntry(entry: VerificationEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllEntries(): Promise<VerificationEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('timestamp').getAll();
    req.onsuccess = () => resolve(req.result as VerificationEntry[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllEntries(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Export entries as CSV (without images)
export function exportCSV(entries: VerificationEntry[]): void {
  const header = [
    '日時', 'ランプ', '正解',
    'RGB_R', 'RGB_G', 'RGB_B', '輝度',
    'HSV_H', 'HSV_S', 'HSV_V',
    'YCbCr_Y', 'YCbCr_Cb', 'YCbCr_Cr',
    'RGB判定', 'RGB色', 'HSV判定', 'HSV色', 'YCbCr判定', 'YCbCr色',
    'ClaudeAI判定', 'ClaudeAI色', 'ClaudeAIコメント',
  ].join(',');

  const rows = entries.map(e => {
    const d = new Date(e.timestamp).toLocaleString('ja-JP');
    const s = e.stats;
    const pred = (m: string) => e.predictions.find(p => p.method === m);
    const verdictJa = (v?: string) => {
      if (!v) return '';
      if (v === 'unlit') return '消灯';
      if (v === 'lit-weak') return '弱点灯';
      if (v === 'lit-normal') return '点灯';
      if (v === 'lit-strong') return '強点灯';
      return v;
    };
    const rgb = pred('RGB'), hsv = pred('HSV'), ycbcr = pred('YCbCr'), claude = pred('Claude AI');
    return [
      d, e.lampLabel, e.groundTruth === 'lit' ? '点灯' : '消灯',
      s.rgb.r.toFixed(1), s.rgb.g.toFixed(1), s.rgb.b.toFixed(1), s.peakLum.toFixed(1),
      s.hsv.h, s.hsv.s, s.hsv.v,
      s.ycbcr.y, s.ycbcr.cb, s.ycbcr.cr,
      verdictJa(rgb?.verdict), rgb?.color ?? '',
      verdictJa(hsv?.verdict), hsv?.color ?? '',
      verdictJa(ycbcr?.verdict), ycbcr?.color ?? '',
      verdictJa(claude?.verdict), claude?.color ?? '', claude?.reasoning ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const bom = '﻿'; // UTF-8 BOM for Excel
  const blob = new Blob([bom + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lamp-verification-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Export single entry's photo
export function exportPhoto(entry: VerificationEntry): void {
  const a = document.createElement('a');
  a.href = entry.imageDataUrl;
  const ext = entry.imageDataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
  a.download = `lamp-${entry.lampLabel}-${new Date(entry.timestamp).toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`;
  a.click();
}
