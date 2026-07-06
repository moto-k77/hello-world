import type { MethodResult, Verdict, LampColor } from './colorAnalysis';

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

  const prompt = `あなたは自動車コンビネーションランプの点灯検査AIです。
画像を見て「${lampLabel}」について以下の3点を判定してください。

1. 点灯しているか（isLit: true/false）
2. ランプの色（color: "赤"/"橙"/"白"/"黄"/"不明"）
3. 点灯の強さ（intensity: "強"/"普通"/"弱"）※消灯時はnull

以下のJSON形式のみで回答（マークダウン・コードブロック不要）:
{"isLit":true,"color":"赤","intensity":"強","comment":"判定理由を1文で"}`;

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

  let parsed: { isLit: boolean; color?: string; intensity?: string; comment?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`JSON parse failed: ${text.slice(0, 80)}`);
  }

  let verdict: Verdict = 'unlit';
  if (parsed.isLit) {
    if (parsed.intensity === '強') verdict = 'lit-strong';
    else if (parsed.intensity === '弱') verdict = 'lit-weak';
    else verdict = 'lit-normal';
  }

  const colorMap: Record<string, LampColor> = { '赤': '赤', '橙': '橙', '白': '白', '黄': '黄' };
  const color: LampColor | null = parsed.isLit
    ? (colorMap[parsed.color ?? ''] ?? '不明')
    : null;

  return {
    method: 'Claude AI',
    verdict,
    color,
    reasoning: parsed.comment ?? (parsed.isLit ? '点灯と判定' : '消灯と判定'),
  };
}
