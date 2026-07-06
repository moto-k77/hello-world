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

// Share or download a blob — uses Web Share API on iOS/Android, falls back to <a download> on desktop
async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  if (typeof navigator.canShare === 'function') {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Export entries as CSV (without images)
export async function exportCSV(entries: VerificationEntry[]): Promise<void> {
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
  await shareOrDownload(blob, `lamp-verification-${new Date().toISOString().slice(0, 10)}.csv`);
}

// Export single entry's photo
export async function exportPhoto(entry: VerificationEntry): Promise<void> {
  const ext = entry.imageDataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const filename = `lamp-${entry.lampLabel}-${new Date(entry.timestamp).toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`;
  const res = await fetch(entry.imageDataUrl);
  const blob = await res.blob();
  await shareOrDownload(new Blob([blob], { type: mime }), filename);
}

// Export full HTML report with embedded photos
export async function exportHTMLReport(entries: VerificationEntry[]): Promise<void> {
  const verdictJa = (v?: string) => {
    if (!v) return '—';
    if (v === 'unlit') return '消灯';
    if (v === 'lit-weak') return '弱点灯';
    if (v === 'lit-normal') return '点灯';
    if (v === 'lit-strong') return '強点灯';
    return v;
  };
  const verdictColor = (v?: string) => {
    if (!v || v === 'unlit') return '#6b7280';
    if (v === 'lit-strong') return '#f59e0b';
    if (v === 'lit-normal') return '#22c55e';
    return '#86efac';
  };
  const isCorrect = (v: string, gt: string) => (v !== 'unlit') === (gt === 'lit');

  const methodOrder = ['RGB', 'HSV', 'YCbCr', 'Claude AI'] as const;

  // Accuracy summary
  const accuracyRows = methodOrder.map(m => {
    const relevant = entries.filter(e => e.predictions.find(p => p.method === m));
    if (relevant.length === 0) return null;
    const correct = relevant.filter(e => {
      const p = e.predictions.find(p => p.method === m)!;
      return isCorrect(p.verdict, e.groundTruth);
    }).length;
    const rate = Math.round((correct / relevant.length) * 100);
    const color = rate >= 80 ? '#22c55e' : rate >= 60 ? '#eab308' : '#ef4444';
    return `<tr>
      <td style="padding:6px 12px;font-weight:600">${m}</td>
      <td style="padding:6px 12px;color:${color};font-weight:700">${rate}%</td>
      <td style="padding:6px 12px;color:#9ca3af">${correct}/${relevant.length}</td>
    </tr>`;
  }).filter(Boolean).join('');

  // Entry cards
  const entryCards = [...entries].reverse().map((e, idx) => {
    const pred = (m: string) => e.predictions.find(p => p.method === m);
    const s = e.stats;
    const methodRows = methodOrder.map(m => {
      const p = pred(m);
      if (!p) return '';
      const ok = isCorrect(p.verdict, e.groundTruth);
      return `<tr>
        <td style="padding:5px 10px;font-weight:600;color:#d1d5db">${m}</td>
        <td style="padding:5px 10px;color:${verdictColor(p.verdict)};font-weight:700">${verdictJa(p.verdict)}</td>
        <td style="padding:5px 10px;color:#e5e7eb">${p.color ?? '—'}</td>
        <td style="padding:5px 10px;color:#9ca3af;font-size:11px">${p.reasoning}</td>
        <td style="padding:5px 10px;text-align:center">${ok ? '✅' : '❌'}</td>
      </tr>`;
    }).join('');

    return `<div style="background:#1e293b;border-radius:12px;padding:16px;margin-bottom:16px;page-break-inside:avoid">
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex-shrink:0">
          <img src="${e.imageDataUrl}" style="width:180px;height:120px;object-fit:cover;border-radius:8px;display:block">
          <p style="color:#6b7280;font-size:11px;margin:4px 0 0;text-align:center">#${entries.length - idx}</p>
        </div>
        <div style="flex:1;min-width:200px">
          <div style="display:flex;gap:12px;align-items:baseline;margin-bottom:8px;flex-wrap:wrap">
            <span style="color:#f1f5f9;font-size:16px;font-weight:700">${e.lampLabel}</span>
            <span style="color:${e.groundTruth === 'lit' ? '#22c55e' : '#6b7280'};font-size:13px;font-weight:600">
              正解: ${e.groundTruth === 'lit' ? '点灯' : '消灯'}
            </span>
            <span style="color:#6b7280;font-size:12px">${new Date(e.timestamp).toLocaleString('ja-JP')}</span>
          </div>
          <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">
            <div style="background:#0f172a;border-radius:6px;padding:6px 10px;font-size:11px;color:#9ca3af">
              <span style="color:#64748b">RGB </span>
              <span style="color:#f87171">R=${s.rgb.r.toFixed(0)}</span>
              <span style="color:#4ade80"> G=${s.rgb.g.toFixed(0)}</span>
              <span style="color:#60a5fa"> B=${s.rgb.b.toFixed(0)}</span>
              <span style="color:#94a3b8"> 輝度=${s.peakLum.toFixed(0)}</span>
            </div>
            <div style="background:#0f172a;border-radius:6px;padding:6px 10px;font-size:11px;color:#9ca3af">
              <span style="color:#64748b">HSV </span>
              H=${s.hsv.h}° S=${s.hsv.s}% V=${s.hsv.v}%
            </div>
            <div style="background:#0f172a;border-radius:6px;padding:6px 10px;font-size:11px;color:#9ca3af">
              <span style="color:#64748b">YCbCr </span>
              Y=${s.ycbcr.y} Cb=${s.ycbcr.cb} Cr=${s.ycbcr.cr}
            </div>
          </div>
          <table style="border-collapse:collapse;width:100%;font-size:12px">
            <thead>
              <tr style="color:#64748b;font-size:11px">
                <th style="padding:4px 10px;text-align:left">手法</th>
                <th style="padding:4px 10px;text-align:left">判定</th>
                <th style="padding:4px 10px;text-align:left">色</th>
                <th style="padding:4px 10px;text-align:left">根拠</th>
                <th style="padding:4px 10px;text-align:center">正誤</th>
              </tr>
            </thead>
            <tbody>${methodRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');

  const date = new Date().toLocaleString('ja-JP');
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ランプ検証レポート ${new Date().toISOString().slice(0, 10)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; }
  @media print { body { background: white; color: #111; } }
</style>
</head>
<body>
<div style="max-width:960px;margin:0 auto">
  <h1 style="font-size:22px;margin-bottom:4px">🔦 ランプ検証レポート</h1>
  <p style="color:#64748b;font-size:13px;margin-bottom:24px">出力日時: ${date} ／ 総検証数: ${entries.length}件</p>

  <div style="background:#1e293b;border-radius:12px;padding:16px;margin-bottom:24px">
    <p style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">手法別 正解率</p>
    <table style="border-collapse:collapse;font-size:13px">
      <thead><tr style="color:#64748b;font-size:11px">
        <th style="padding:4px 12px;text-align:left">手法</th>
        <th style="padding:4px 12px;text-align:left">正解率</th>
        <th style="padding:4px 12px;text-align:left">件数</th>
      </tr></thead>
      <tbody>${accuracyRows}</tbody>
    </table>
  </div>

  <p style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">検証履歴</p>
  ${entryCards}
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  await shareOrDownload(blob, `lamp-report-${new Date().toISOString().slice(0, 10)}.html`);
}
