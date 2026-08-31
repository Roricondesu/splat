export type Team = 'cyan' | 'orange';
export type WeaponId = 'pulse' | 'roller' | 'bucket' | 'burst';
export type Difficulty = 'casual' | 'standard' | 'expert';
export type ArenaId = 'skyline-market' | 'canal-foundry';

export const ARENAS: Array<{ id: ArenaId; name: string; subtitle: string }> = [
  { id: 'skyline-market', name: '云顶集市', subtitle: '屋顶露台与空中连廊' },
  { id: 'canal-foundry', name: '潮汐铸造厂', subtitle: '运河、厂房与双层管线' }
];

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  subtitle: string;
  icon: string;
  fireRate: number;
  damage: number;
  range: number;
  spread: number;
  paintRadius: number;
  projectileSpeed: number;
  ammoCost: number;
  automatic: boolean;
  color: string;
}

export const WEAPONS: WeaponSpec[] = [
  { id: 'pulse', name: '脉冲喷笔', subtitle: '均衡连射', icon: '◈', fireRate: 0.11, damage: 17, range: 24, spread: 0.055, paintRadius: 1.35, projectileSpeed: 34, ammoCost: 4.2, automatic: true, color: '#16e0d0' },
  { id: 'roller', name: '霓虹滚筒', subtitle: '近战铺色', icon: '▰', fireRate: 0.55, damage: 48, range: 5.8, spread: 0.32, paintRadius: 2.5, projectileSpeed: 22, ammoCost: 14, automatic: false, color: '#b8ff3d' },
  { id: 'bucket', name: '涂浪桶', subtitle: '抛射范围', icon: '◒', fireRate: 0.68, damage: 38, range: 17, spread: 0.12, paintRadius: 2.25, projectileSpeed: 22, ammoCost: 12, automatic: false, color: '#8c7dff' },
  { id: 'burst', name: '色爆胶囊', subtitle: '区域爆裂', icon: '✦', fireRate: 0.9, damage: 52, range: 20, spread: 0.045, paintRadius: 3.1, projectileSpeed: 19, ammoCost: 18, automatic: false, color: '#ff6b2c' }
];

export const TEAM_COLORS = {
  cyan: { main: 0x10d9d0, light: 0x8cfff5, dark: 0x007e85, css: '#16e0d0' },
  orange: { main: 0xff6828, light: 0xffbd70, dark: 0xb82d09, css: '#ff6b2c' }
};

export const OUTFITS = [
  { id: 'night-runner', name: '夜行速递', desc: '反光运动夹克', primary: '#101e31', accent: '#16e0d0' },
  { id: 'acid-pop', name: '酸性波普', desc: '荧光机能套装', primary: '#b8ff3d', accent: '#17212b' },
  { id: 'sunset-club', name: '落日俱乐部', desc: '橙紫街头外套', primary: '#ff6b2c', accent: '#8c7dff' },
  { id: 'mono-tag', name: '黑白标签', desc: '极简贴纸风', primary: '#edf5f7', accent: '#17212b' }
];

export interface SaveData {
  weapon: WeaponId;
  outfit: string;
  difficulty: Difficulty;
  music: number;
  sfx: number;
  sensitivity: number;
  quality: 'low' | 'medium' | 'high';
  arena: ArenaId;
  matches: number;
  wins: number;
  coins: number;
}

export const DEFAULT_SAVE: SaveData = {
  weapon: 'pulse',
  outfit: 'night-runner',
  difficulty: 'standard',
  music: 0.65,
  sfx: 0.8,
  sensitivity: 1,
  quality: 'high',
  arena: 'skyline-market',
  matches: 0,
  wins: 0,
  coins: 1250
};
