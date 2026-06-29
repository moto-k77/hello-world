import type { LampDefinition } from './types';

export const LAMPS: LampDefinition[] = [
  {
    id: 'tail',
    label: 'テールランプ',
    instruction: 'ライトスイッチをON（スモール点灯）にしてください',
    icon: '🔴',
  },
  {
    id: 'brake',
    label: 'ブレーキランプ',
    instruction: 'ブレーキペダルを踏んだ状態でシャッターを押してください',
    icon: '🟥',
  },
  {
    id: 'winker_left',
    label: 'ウインカー（左）',
    instruction: 'ウインカーレバーを左に操作してください（ハザードでも可）',
    icon: '🟡',
  },
  {
    id: 'winker_right',
    label: 'ウインカー（右）',
    instruction: 'ウインカーレバーを右に操作してください',
    icon: '🟡',
  },
  {
    id: 'reverse',
    label: 'バックランプ',
    instruction: 'セレクターをR（リバース）に入れてください',
    icon: '⬜',
  },
];
