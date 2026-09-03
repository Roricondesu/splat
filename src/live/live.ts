import { ArenaId, HAIRSTYLES, OUTFITS, TEAM_COLORS, TEAM_ORDER, Team, WEAPONS } from '../game/config';

export interface LiveMessage {
  userId: string;
  userName: string;
  content: string;
  platform: string;
  timestamp: number;
  isModerator?: boolean;
  isStreamer?: boolean;
}

export interface LiveProfile {
  userId: string;
  userName: string;
  coins: number;
  giftPower: number;
  gifts: number;
  rank: string;
  rating: number;
  team?: Team;
  weapon: string;
  outfit: string;
  hairstyle: string;
  ownedWeapons: string[];
  ownedOutfits: string[];
  ownedHairstyles: string[];
  ready: boolean;
}

export type LiveEvent =
  | { type: 'join'; profile: LiveProfile }
  | { type: 'profile'; profile: LiveProfile }
  | { type: 'gift'; profile: LiveProfile; power: number }
  | { type: 'tactic'; profile: LiveProfile; tactic: string };

export interface LiveRoomState {
  roomCode: string;
  connected: boolean;
  accepting: boolean;
  started: boolean;
  teamCount: number;
  teamSize: number;
  /** Configured team count for live matches (2-6). */
  liveTeams: number;
  /** Configured initial AI fighters per team (1-10). */
  liveAiPerTeam: number;
  /** Maximum viewers allowed into the visible roster. */
  liveTeamSize: number;
  /** Live map used for the next match. */
  liveArena: ArenaId;
  /** Match duration in seconds; null means unlimited. */
  liveMatchSeconds: number | null;
  viewers: number;
  profiles: LiveProfile[];
  feed: Array<{ userName: string; content: string; result: string; tone: 'ok' | 'warn' | 'info' }>;
}

const PROFILE_KEY = 'neon-turf-live-profiles';
const ROOM_KEY = 'neon-turf-live-room';
const DEFAULT_USER: LiveProfile = {
  userId: 'demo-viewer',
  userName: '直播观众',
  coins: 1250,
  giftPower: 0,
  gifts: 0,
  rank: '新手',
  rating: 1000,
  weapon: 'pulse',
  outfit: 'night-runner',
  hairstyle: 'short',
  ownedWeapons: ['pulse'],
  ownedOutfits: ['night-runner'],
  ownedHairstyles: ['short'],
  ready: false
};

export type LiveUpdate = (state: LiveRoomState) => void;

export class LiveCommandProcessor {
  readonly state: LiveRoomState;
  private profiles: Record<string, LiveProfile>;
  private readonly listeners = new Set<LiveUpdate>();
  private readonly eventListeners = new Set<(event: LiveEvent) => void>();
  private socket?: WebSocket;

  constructor() {
    this.profiles = this.loadProfiles();
    const saved = this.loadRoom();
    this.state = saved ?? {
      roomCode: this.makeRoomCode(), connected: false, accepting: true, started: false,
      teamCount: 4, teamSize: 20, liveTeams: 4, liveAiPerTeam: 1, liveTeamSize: 20, liveArena: 'blank-expanse', liveMatchSeconds: 120, viewers: 1, profiles: [], feed: []
    };
    this.state.liveTeams ??= 4;
    this.state.liveAiPerTeam ??= 1;
    this.state.liveTeamSize ??= 20;
    this.state.liveArena ??= 'blank-expanse';
    this.state.liveMatchSeconds ??= 120;
    this.ensureDemoProfile();
    this.refreshProfiles();
  }

  launch() {
    this.state.accepting = true;
    this.state.started = false;
    this.state.teamCount = this.state.liveTeams;
    this.state.teamSize = 20;
    const demo = this.getProfile({ ...DEFAULT_USER, content: '', platform: 'system', timestamp: Date.now() });
    demo.team ??= 'cyan';
    this.emit();
  }

  /** Update pre-match live roster settings; the caller restarts the battle to apply them. */
  configLive(teams: number, aiPerTeam: number, matchSeconds: number | null = this.state.liveMatchSeconds, arena: ArenaId = this.state.liveArena) {
    this.state.liveTeams = Math.max(2, Math.min(6, Math.round(teams)));
    this.state.liveAiPerTeam = Math.max(1, Math.min(10, Math.round(aiPerTeam)));
    this.state.liveMatchSeconds = matchSeconds === null ? null : Math.max(30, Math.min(600, Math.round(matchSeconds)));
    this.state.liveArena = arena;
    this.state.teamCount = this.state.liveTeams;
    this.state.profiles.forEach(profile => {
      if (profile.team) {
        const index = TEAM_ORDER.indexOf(profile.team);
        if (index >= this.state.liveTeams) profile.team = undefined;
      }
    });
    this.emit();
  }

  subscribe(listener: LiveUpdate) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  subscribeEvents(listener: (event: LiveEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emitEvent(event: LiveEvent) {
    this.eventListeners.forEach(listener => listener(event));
  }

  private emit() {
    this.refreshProfiles();
    this.state.viewers = Math.max(1, this.state.profiles.length);
    this.persist();
    this.persistProfiles();
    this.listeners.forEach(listener => listener(this.state));
  }

  private pushFeed(message: LiveMessage, result: string, tone: 'ok' | 'warn' | 'info' = 'info') {
    this.state.feed.unshift({ userName: message.userName, content: message.content, result, tone });
    this.state.feed.splice(12);
  }

  receive(message: LiveMessage) {
    const profile = this.getProfile(message);
    const command = message.content.trim().replace(/[，。！!？?]/g, '');
    const compact = command.replace(/\s+/g, '');
    if (!compact) return;

    if (/^(商店|商城|商品)$/.test(compact)) return this.showStore(message);
    if (/^(我的|资料|个人信息)$/.test(compact)) return this.pushFeed(message, `${profile.rank} · ${profile.rating}分 · ${profile.coins}币`, 'info');
    if (/^(余额|金币|霓虹币)$/.test(compact)) return this.pushFeed(message, `余额 ${profile.coins} 霓虹币`, 'info');
    if (/^(段位|排位)$/.test(compact)) return this.pushFeed(message, `${profile.rank} · ${profile.rating} 分`, 'info');
    if (/^(排名|榜单)$/.test(compact)) return this.pushFeed(message, this.topRankText(), 'info');
    if (/^(准备|就绪)$/.test(compact)) {
      profile.ready = true;
      this.pushFeed(message, '已准备，等待主播锁定阵容', 'ok');
      return this.emit();
    }
    if (/^(退出|退队|取消报名)$/.test(compact)) {
      profile.team = undefined;
      profile.ready = false;
      this.pushFeed(message, '已退出当前队伍', 'ok');
      return this.emit();
    }
    const join = compact.match(/^(?:加入|报名|加)(青队?|橙队?|黄队?|紫队?|粉队?|金队?|[1-6]队?)$/);
    if (join) return this.joinTeam(message, this.parseTeam(join[1]));

    const buy = compact.match(/^(?:购买|买)(.+)$/);
    if (buy) return this.purchase(message, profile, buy[1]);
    const equip = compact.match(/^(?:装备|使用|用|穿|戴)(.+)$/);
    if (equip) return this.equip(message, profile, equip[1]);

    if (/^(开报名|开始报名)$/.test(compact) && this.canManage(message)) {
      this.state.accepting = true;
      this.pushFeed(message, '报名已开启', 'ok');
      return this.emit();
    }
    if (/^(关报名|停止报名)$/.test(compact) && this.canManage(message)) {
      this.state.accepting = false;
      this.pushFeed(message, '报名已关闭', 'ok');
      return this.emit();
    }
    if (/^(开始比赛|开战|开始直播)$/.test(compact) && this.canManage(message)) {
      this.state.accepting = false;
      this.state.started = true;
      this.state.profiles.forEach(item => { if (!item.team) item.team = this.pickTeam(); });
      this.pushFeed(message, '直播对战已开始，未选队观众已自动分队', 'ok');
      return this.emit();
    }
    if (/^(结束比赛|结束直播)$/.test(compact) && this.canManage(message)) {
      this.state.started = false;
      this.state.accepting = true;
      this.pushFeed(message, '本局已结束，报名重新开启', 'ok');
      return this.emit();
    }
    const gift = compact.match(/^(?:送|礼物)(爱心|火箭|能量|礼物)?(\d*)$/);
    if (gift) {
      const amount = Math.max(1, Number(gift[2] || 1));
      const power = gift[1] === '火箭' ? 30 : gift[1] === '能量' ? 10 : gift[1] === '爱心' ? 3 : 5;
      profile.gifts += amount;
      profile.giftPower += power * amount;
      this.pushFeed(message, `收到${amount}份礼物，强化值 +${power * amount}`, 'ok');
      this.emitEvent({ type: 'gift', profile: { ...profile }, power: power * amount });
      return this.emit();
    }
    if (/^(炸弹|水球|水气球)$/.test(compact)) {
      this.pushFeed(message, profile.coins >= 25 ? '已登记水气球行动' : '霓虹币不足，无法使用水气球', profile.coins >= 25 ? 'ok' : 'warn');
      if (profile.coins >= 25) profile.coins -= 25;
      return this.emit();
    }
    if (/^(涂地|进攻|冲锋|防守|潜墨)$/.test(compact)) {
      this.pushFeed(message, `已切换战术：${compact}`, 'ok');
      this.emitEvent({ type: 'tactic', profile: { ...profile }, tactic: compact });
      return this.emit();
    }
    this.pushFeed(message, '未识别指令，发送“商店”查看可用命令', 'warn');
    this.emit();
  }

  connectWebSocket(url: string) {
    this.socket?.close();
    try {
      this.socket = new WebSocket(url);
      this.socket.onopen = () => { this.state.connected = true; this.emit(); };
      this.socket.onclose = () => { this.state.connected = false; this.emit(); };
      this.socket.onerror = () => { this.state.connected = false; this.emit(); };
      this.socket.onmessage = event => {
        try {
          const value = JSON.parse(event.data) as Partial<LiveMessage>;
          if (typeof value.content !== 'string') return;
          this.receive({ userId: value.userId || `socket-${Date.now()}`, userName: value.userName || '观众', content: value.content, platform: value.platform || 'websocket', timestamp: Date.now(), isModerator: value.isModerator, isStreamer: value.isStreamer });
        } catch {
          this.pushFeed({ userId: 'system', userName: '连接', content: 'WebSocket', platform: 'system', timestamp: Date.now() }, '收到无法解析的弹幕数据', 'warn');
          this.emit();
        }
      };
    } catch {
      this.state.connected = false;
      this.pushFeed({ userId: 'system', userName: '连接', content: url, platform: 'system', timestamp: Date.now() }, 'WebSocket 地址不可用', 'warn');
      this.emit();
    }
  }

  disconnect() {
    this.socket?.close();
    this.socket = undefined;
    this.state.connected = false;
    this.emit();
  }

  getCurrentProfile() {
    return this.profiles[DEFAULT_USER.userId] ?? DEFAULT_USER;
  }

  private showStore(message: LiveMessage) {
    const list = [
      ...WEAPONS.slice(0, 5).map(item => `${item.name} ${item.id === 'pulse' ? '免费' : '120币'}`),
      ...HAIRSTYLES.slice(0, 5).map(item => `${item.name} 80币`),
      ...OUTFITS.slice(0, 4).map(item => `${item.name} 160币`)
    ];
    this.pushFeed(message, list.join(' · '), 'info');
    this.emit();
  }

  private joinTeam(message: LiveMessage, team: Team) {
    const profile = this.getProfile(message);
    if (!this.state.accepting && !this.state.started) {
      this.pushFeed(message, '报名已关闭，等待下一局', 'warn');
      return this.emit();
    }
    const count = this.state.profiles.filter(item => item.team === team).length;
    if (count >= this.state.teamSize) {
      this.pushFeed(message, `${TEAM_COLORS[team].name}队已满 ${this.state.teamSize} 人`, 'warn');
      return this.emit();
    }
    const previousTeam = profile.team;
    profile.team = team;
    profile.ready = false;
    this.pushFeed(message, `已加入${TEAM_COLORS[team].name}队 ${count + 1}/${this.state.teamSize}`, 'ok');
    this.emitEvent({ type: 'join', profile: { ...profile } });
    if (previousTeam && previousTeam !== team) this.pushFeed(message, `已从${TEAM_COLORS[previousTeam].name}队转入${TEAM_COLORS[team].name}队`, 'info');
    this.emit();
  }

  private purchase(message: LiveMessage, profile: LiveProfile, name: string) {
    const normalized = name.trim();
    const weapon = WEAPONS.find(item => normalized.includes(item.name) || normalized.includes(item.id) || normalized.includes(item.name.replace(/^霓虹|^涂浪|^色爆|^蓄能|^散彩|^疾风|^喷射/, '')));
    const hair = HAIRSTYLES.find(item => normalized.includes(item.name) || normalized.includes(item.id));
    const outfit = OUTFITS.find(item => normalized.includes(item.name) || normalized.includes(item.id));
    const item = weapon || hair || outfit;
    if (!item) {
      this.pushFeed(message, '没有找到这个商品，发送“商店”查看名称', 'warn');
      return this.emit();
    }
    const id = item.id;
    const ownedKey = weapon ? 'ownedWeapons' : hair ? 'ownedHairstyles' : 'ownedOutfits';
    const price = id === 'pulse' ? 0 : weapon ? 120 : hair ? 80 : 160;
    if (profile[ownedKey].includes(id)) {
      this.pushFeed(message, '已经拥有，不重复扣款', 'info');
    } else if (profile.coins < price) {
      this.pushFeed(message, `余额不足，需要 ${price} 币`, 'warn');
    } else {
      profile.coins -= price;
      profile[ownedKey].push(id);
      this.pushFeed(message, `购买成功，扣除 ${price} 币`, 'ok');
    }
    this.emit();
  }

  private equip(message: LiveMessage, profile: LiveProfile, name: string) {
    const weapon = WEAPONS.find(item => name.includes(item.name) || name.includes(item.id));
    const hair = HAIRSTYLES.find(item => name.includes(item.name) || name.includes(item.id));
    const outfit = OUTFITS.find(item => name.includes(item.name) || name.includes(item.id));
    if (weapon && profile.ownedWeapons.includes(weapon.id)) profile.weapon = weapon.id;
    else if (hair && profile.ownedHairstyles.includes(hair.id)) profile.hairstyle = hair.id;
    else if (outfit && profile.ownedOutfits.includes(outfit.id)) profile.outfit = outfit.id;
    else {
      this.pushFeed(message, '尚未拥有，请先购买', 'warn');
      return this.emit();
    }
    this.pushFeed(message, '装备已更新，立即同步到直播角色', 'ok');
    this.emitEvent({ type: 'profile', profile: { ...profile } });
    this.emit();
  }

  private parseTeam(value: string): Team {
    const byName: Record<string, Team> = { 青: 'cyan', 青队: 'cyan', 橙: 'orange', 橙队: 'orange', 黄: 'yellow', 黄队: 'yellow', 紫: 'purple', 紫队: 'purple', 粉: 'pink', 粉队: 'pink', 金: 'yellow', 金队: 'yellow' };
    if (byName[value]) return byName[value];
    const index = Math.max(0, Math.min(5, Number(value.replace('队', '')) - 1));
    return TEAM_ORDER[index];
  }

  private pickTeam() {
    const counts = TEAM_ORDER.slice(0, this.state.teamCount).map(team => ({ team, count: this.state.profiles.filter(item => item.team === team).length }));
    return counts.sort((a, b) => a.count - b.count)[0].team;
  }

  private getProfile(message: LiveMessage) {
    const existing = this.profiles[message.userId];
    if (existing) {
      existing.userName = message.userName || existing.userName;
      return existing;
    }
    const profile: LiveProfile = { ...DEFAULT_USER, userId: message.userId, userName: message.userName || '观众', ownedWeapons: [...DEFAULT_USER.ownedWeapons], ownedOutfits: [...DEFAULT_USER.ownedOutfits], ownedHairstyles: [...DEFAULT_USER.ownedHairstyles] };
    this.profiles[message.userId] = profile;
    return profile;
  }

  private ensureDemoProfile() {
    if (!this.profiles[DEFAULT_USER.userId]) this.profiles[DEFAULT_USER.userId] = { ...DEFAULT_USER, ownedWeapons: [...DEFAULT_USER.ownedWeapons], ownedOutfits: [...DEFAULT_USER.ownedOutfits], ownedHairstyles: [...DEFAULT_USER.ownedHairstyles] };
  }

  private refreshProfiles() { this.state.profiles = Object.values(this.profiles); }
  private canManage(message: LiveMessage) { return Boolean(message.isModerator || message.isStreamer || message.userId === 'demo-viewer'); }
  private topRankText() { return this.state.profiles.slice().sort((a, b) => b.rating - a.rating).slice(0, 3).map((item, index) => `${index + 1}.${item.userName} ${item.rating}`).join(' · ') || '榜单暂为空'; }
  private makeRoomCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
  private loadProfiles(): Record<string, LiveProfile> {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') as Record<string, Partial<LiveProfile>>;
      return Object.fromEntries(Object.entries(parsed).map(([id, profile]) => [id, { ...DEFAULT_USER, ...profile, userId: id, giftPower: profile.giftPower ?? 0, gifts: profile.gifts ?? 0, ownedWeapons: profile.ownedWeapons ?? ['pulse'], ownedOutfits: profile.ownedOutfits ?? ['night-runner'], ownedHairstyles: profile.ownedHairstyles ?? ['short'] }])) as Record<string, LiveProfile>;
    } catch { return {}; }
  }
  private persistProfiles() { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profiles)); }
  private loadRoom(): LiveRoomState | null { try { return JSON.parse(localStorage.getItem(ROOM_KEY) || 'null'); } catch { return null; } }
  private persist() { localStorage.setItem(ROOM_KEY, JSON.stringify(this.state)); }
}

export function createDemoMessage(content: string): LiveMessage {
  return { userId: 'demo-viewer', userName: '直播观众', content, platform: 'local-demo', timestamp: Date.now(), isStreamer: true };
}
