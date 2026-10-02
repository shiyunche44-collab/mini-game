// 配色、字体和尺寸常量。换皮肤、换主题时只改这里。

/** 中文和 emoji 的字体栈：各平台带的字体不一样，按顺序找第一个有的 */
export const FONT = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export const theme = {
  /** 背景从上到下的渐变：像一张浅色的旅行桌面 */
  backgroundTop: '#fff6e5',
  backgroundBottom: '#f6dcb4',

  ink: '#4a3728',
  inkSoft: '#8a7461',

  // 行李牌
  tagFill: '#ffffff',
  tagAccent: '#e8604c',
  tagHole: '#f0d9b5',
  tagHoleRing: '#dcc08f',

  // 箱子
  suitcase: '#3f6f9e',
  suitcaseDark: '#2f557a',
  suitcaseHandle: '#2a4a6b',
  slot: '#e9f1f8',
  slotLine: '#c5d6e6',
  /** 拉杆槽：箱子里放不了东西的格子 */
  blocked: '#66727f',
  blockedDark: '#3f4954',

  // 托盘
  trayFill: 'rgba(255, 255, 255, 0.55)',
  trayLine: '#e3c99b',

  // 按钮
  buttonFree: '#ffffff',
  buttonHint: '#ffc94d',
  buttonSkip: '#5ed3c3',
  adBadge: '#e8604c',
} as const;
