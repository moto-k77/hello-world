import type { MethodResult, Verdict } from './colorAnalysis';

export async function analyzeWithClaude(
  imageDataUrl: string,
  lampLabel: string,
  apiKey: string,
): Promise<MethodResult> {
  const base64 = imageDataUrl.split(',')[1];
  const mediaType = imageDataUrl.split(';')[0].split(':')[1] as
    | 'image/jpeg'
    | 'image/png'
    | 'image/webp';

  const prompt = `あなたは自動車コンビネーションランプの点灯検査システムです。
この画像を確認し、「${lampLabel}」が点灯しているかどうかを判定してください。

判定基準:
- テールランプ: 赤色の尾灯が点灯しているか
- ブレーキランプ: 制動灯（テールより明るい赤）が点灯しているか
- ウインカー: オレンジ/アンバー色の方向指示灯が点灯または点滅しているか
- バックランプ: 白色の後退灯が点灯しているか

強度の判定:
- strong: 明るくはっきり点灯している
- normal: 通常の点灯
- weak: 薄暗い・かすかに点灯している

以下のJSON形式のみで回答してください（マークダウン・コードブロック不要）:
{"isLit":true,"intensity":"strong","confidence":"high","comment":"判定理由を1文で"}`;

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
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 120)}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  let parsed: { isLit: boolean; intensity?: string; confidence?: string; comment?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`JSON parse failed: ${text.slice(0, 80)}`);
  }

  let verdict: Verdict = 'unlit';
  if (parsed.isLit) {
    const intensity = parsed.intensity ?? parsed.confidence;
    if (intensity === 'strong' || intensity === 'high') verdict = 'lit-strong';
    else if (intensity === 'weak' || intensity === 'low') verdict = 'lit-weak';
    else verdict = 'lit-normal';
  }

  return {
    method: 'Claude AI',
    verdict,
    reasoning: parsed.comment ?? (parsed.isLit ? '点灯と判定' : '消灯と判定'),
  };
}
