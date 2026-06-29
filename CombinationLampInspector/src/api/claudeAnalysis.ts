import type { LampDefinition } from '../types';

export interface AnalysisResult {
  isLit: boolean;
  confidence: 'high' | 'medium' | 'low';
  comment: string;
}

export async function analyzeLampImage(
  imageDataUrl: string,
  lamp: LampDefinition,
  apiKey: string
): Promise<AnalysisResult> {
  const base64 = imageDataUrl.split(',')[1];
  const mediaType = imageDataUrl.split(';')[0].split(':')[1] as
    | 'image/jpeg'
    | 'image/png'
    | 'image/webp';

  const prompt = `あなたは自動車コンビネーションランプの点灯検査システムです。
この画像を確認し、「${lamp.label}」が点灯しているかどうかを判定してください。

判定基準:
- テールランプ: 赤色の尾灯が点灯しているか
- ブレーキランプ: 制動灯（テールより明るい赤）が点灯しているか
- ウインカー: オレンジ/アンバー色の方向指示灯が点灯または点滅しているか
- バックランプ: 白色の後退灯が点灯しているか

以下のJSON形式で回答してください（マークダウンなし）:
{
  "isLit": true または false,
  "confidence": "high" または "medium" または "low",
  "comment": "判定理由を1〜2文で説明"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API Error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  try {
    return JSON.parse(text) as AnalysisResult;
  } catch {
    throw new Error(`JSON parse failed: ${text}`);
  }
}
