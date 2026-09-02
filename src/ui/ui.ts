import { ARENAS, ArenaId, CustomRules, DEFAULT_SAVE, Difficulty, HAIRSTYLES, OutfitSpec, OUTFITS, SaveData, TEAM_COLORS, TEAM_ORDER, Team, WEAPONS, WeaponId } from '../game/config';
import { GameStats } from '../game/game';
import { LiveCommandProcessor, LiveProfile, LiveRoomState, createDemoMessage } from '../live/live';

export type Screen = 'loading' | 'home' | 'loadout' | 'settings' | 'game' | 'result' | 'live';

export interface UIActions {
  startGame: () => void;
  spectateGame: () => void;
  restartGame: () => void;
  quitGame: () => void;
  pauseGame: (paused: boolean) => void;
  liveStart: (profiles: LiveProfile[], room: LiveRoomState, live: LiveCommandProcessor) => void;
  saveChanged: (save: SaveData) => void;
}

export class GameUI {
  save: SaveData;
  screen: Screen = 'loading';
  private toastTimer?: number;
  private stats?: GameStats;
  private previousHealth = 100;
  private liveMode = false;
  private liveProcessor?: LiveCommandProcessor;
  private liveEventUnsubscribe?: () => boolean;
  private endingReveal = false;
  private endingRevealTimer?: number;
  private hitmarkerTimer?: number;
  private spectating = false;
  private readonly live = new LiveCommandProcessor();
  private unsubscribeLive?: () => void;

  constructor(private root: HTMLElement, private actions: UIActions) {
    this.save = this.loadSave();
    this.renderLoading();
    setTimeout(() => this.showHome(), 900);
  }

  private loadSave(): SaveData {
    try {
      const parsed = JSON.parse(localStorage.getItem('neon-turf-save') || '{}');
      return { ...DEFAULT_SAVE, ...parsed, customMode: { ...DEFAULT_SAVE.customMode, ...(parsed.customMode || {}), rules: { ...DEFAULT_SAVE.customMode.rules, ...(parsed.customMode?.rules || {}) }, blocks: Array.isArray(parsed.customMode?.blocks) ? parsed.customMode.blocks : [] } };
    } catch { return { ...DEFAULT_SAVE, customMode: { ...DEFAULT_SAVE.customMode, blocks: [...DEFAULT_SAVE.customMode.blocks], rules: { ...DEFAULT_SAVE.customMode.rules } } }; }
  }

  persist() {
    localStorage.setItem('neon-turf-save', JSON.stringify(this.save));
    this.actions.saveChanged(this.save);
  }

  showHome() {
    this.screen = 'home';
    const weapon = WEAPONS.find(w => w.id === this.save.weapon)!;
    const outfit = OUTFITS.find(o => o.id === this.save.outfit)!;
    const hair = HAIRSTYLES.find(h => h.id === this.save.hairstyle) ?? HAIRSTYLES[0];
    const arena = ARENAS.find(item => item.id === this.save.arena) ?? ARENAS[0];
    const modeLabel = `${arena.teamSize}v${arena.teamSize}`;
    this.root.innerHTML = `
      <div class="screen home-screen">
        <div class="ambient ambient-a"></div><div class="ambient ambient-b"></div>
        <header class="topbar glass">
          <div class="brand-mini"><span class="brand-mark">N</span><span>NEON TURF</span></div>
          <div class="top-stats"><span class="rank-chip">LEVEL 07</span><span class="coin-chip"><b>✦</b> ${this.save.coins.toLocaleString()}</span></div>
          <button class="icon-btn" data-action="settings" aria-label="设置">⚙</button>
        </header>
        <main class="home-main">
          <section class="hero-copy">
            <div class="eyebrow"><span></span> SEASON 01 · NIGHT SHIFT</div>
            <h1><span>霓虹</span><br/>涂界</h1>
            <p class="hero-en">NEON <i>TURF</i></p>
            <p class="tagline">用色彩占领街区。<br/>每一枪，都改写战场。</p>
            <div class="home-actions">
              <div class="arena-picker" aria-label="地图选择">
                ${ARENAS.map(item => `<button class="arena-option ${item.id === this.save.arena ? 'selected' : ''}" data-arena="${item.id}"><b>${item.name}</b><small>${item.id === 'custom' ? `${item.subtitle} · ${this.save.customMode.teamCount}队` : item.subtitle}</small></button>`).join('')}
              </div>
              <button class="primary-btn huge" data-action="start"><span>开始对战</span><small>AI TURF BATTLE</small><b>→</b></button>
              <button class="secondary-btn" data-action="spectate"><span>上帝视角观战</span><small>AI VS AI</small></button>
              <button class="secondary-btn" data-action="loadout"><span>装备工坊</span><small>LOADOUT</small></button>
              <button class="secondary-btn live-entry" data-action="live"><span>直播中心</span><small>DANMAKU LIVE</small></button>
            </div>
            <div class="control-tip desktop-only"><kbd>WASD</kbd> 移动　<kbd>空格</kbd> 跳跃　<kbd>鼠标</kbd> 瞄准　<kbd>左键</kbd> 喷涂　<kbd>Q</kbd> 水气球　<kbd>Shift</kbd> 潜入己方墨水</div>
          </section>
          <section class="hero-stage">
            <div class="character-card">
              ${this.characterPreview(outfit.primary, outfit.accent, this.save.hairstyle)}
              <div class="sticker sticker-new">NEW<br/>DROP!</div>
              <div class="sticker sticker-squad">${modeLabel}<br/>AI SQUAD</div>
              <div class="loadout-strip glass">
                <span class="weapon-glyph">${weapon.icon}</span>
                <div><small>当前自由搭配</small><strong>${outfit.name} · ${hair.name}</strong><em>${outfit.desc} / ${weapon.name}</em></div>
                <button data-action="loadout">穿搭</button>
              </div>
            </div>
          </section>
        </main>
        <footer class="home-footer">
          <div class="mode-pill"><span class="live-dot"></span><div><small>当前地图</small><b>${arena.name} · 占地战</b></div></div>
          <div class="news-ticker"><b>NEON NEWS</b><span>酸性波普套装已加入装备工坊</span><span>·</span><span>训练赛开放中</span></div>
        </footer>
      </div>`;
    this.root.querySelectorAll<HTMLElement>('[data-arena]').forEach(el => el.onclick = () => {
      this.save.arena = el.dataset.arena as ArenaId;
      this.persist();
      if (this.save.arena === 'custom') this.showCustomMode();
      else this.showHome();
    });
    this.bindCommon();
  }

  showLive() {
    this.screen = 'live';
    const state = this.live.state;
    this.unsubscribeLive?.();
    this.root.innerHTML = `<div class="screen panel-screen live-screen">
      <div class="panel-bg"></div>
      <header class="panel-header"><button class="back-btn" data-action="back">←</button><div><small>DANMAKU LIVE CONTROL</small><h2>直播中心</h2></div><div class="live-room-chip"><span class="live-dot"></span><b>房间 ${state.roomCode}</b></div></header>
      <main class="live-layout">
        <section class="live-console glass">
          <div class="live-console-head"><div><small>ROOM CONTROL</small><h3>弹幕控制台</h3></div><span class="live-status" data-live-status>${state.connected ? '已连接' : '本地模拟'}</span></div>
          <div class="live-room-settings"><div><small>队伍</small><b>${state.teamCount} 队</b></div><div><small>人数</small><b>${state.teamSize} / 队</b></div><div><small>在线</small><b data-live-viewers>${state.viewers}</b></div></div>
          <div class="live-command-form"><label>模拟弹幕<input data-live-command value="加入青队" autocomplete="off"/></label><button class="primary-btn" data-live-send><span>发送弹幕</span><b>→</b></button></div>
          <div class="live-quick"><button data-live-quick="加入青队">加入青队</button><button data-live-quick="商店">商店</button><button data-live-quick="买滚筒">买滚筒</button><button data-live-quick="余额">余额</button><button data-live-quick="准备">准备</button><button data-live-quick="开始直播">开始直播</button></div>
          <div class="live-connect"><label>真实弹幕 WebSocket 地址<input data-live-url placeholder="ws://127.0.0.1:9000"/></label><button class="secondary-btn" data-live-connect>连接</button><button class="secondary-btn" data-live-disconnect>断开</button></div>
          <button class="primary-btn live-start" data-live-start><span>开始直播对战</span><small>观众阵容将进入 AI 战场</small><b>↗</b></button>
        </section>
        <aside class="live-side glass"><div class="live-console-head"><div><small>VIEWERS</small><h3>观众阵容</h3></div><b data-live-viewers>${state.viewers}</b></div><div class="live-roster" data-live-roster></div></aside>
        <section class="live-feed glass"><div class="live-console-head"><div><small>COMMAND FEED</small><h3>弹幕记录</h3></div><span>中文短指令</span></div><div class="live-feed-list" data-live-feed></div></section>
      </main>
    </div>`;
    const render = () => {
      const current = this.live.state;
      const status = this.root.querySelector<HTMLElement>('[data-live-status]');
      if (status) status.textContent = current.connected ? '已连接' : '本地模拟';
      this.root.querySelectorAll<HTMLElement>('[data-live-viewers]').forEach(el => el.textContent = String(current.viewers));
      const roster = this.root.querySelector<HTMLElement>('[data-live-roster]');
      if (roster) roster.innerHTML = current.profiles.map(profile => `<div class="live-profile"><span class="profile-dot" style="background:${profile.team ? TEAM_COLORS[profile.team].css : '#718694'}"></span><div><b>${profile.userName}</b><small>${profile.team ? `${TEAM_COLORS[profile.team].name}队` : '未分队'} · ${profile.rank}</small></div><em>${profile.coins}币</em></div>`).join('');
      const feed = this.root.querySelector<HTMLElement>('[data-live-feed]');
      if (feed) feed.innerHTML = current.feed.map(item => `<div class="feed-line ${item.tone}"><b>${item.userName}</b><span>${item.content}</span><em>${item.result}</em></div>`).join('') || '<div class="feed-empty">等待弹幕指令…</div>';
    };
    this.unsubscribeLive = this.live.subscribe(render);
    const send = (content: string) => { if (content.trim()) this.live.receive(createDemoMessage(content)); };
    const input = this.root.querySelector<HTMLInputElement>('[data-live-command]')!;
    this.root.querySelector<HTMLElement>('[data-live-send]')!.onclick = () => { send(input.value); input.select(); };
    input.onkeydown = event => { if (event.key === 'Enter') { send(input.value); input.select(); } };
    this.root.querySelectorAll<HTMLElement>('[data-live-quick]').forEach(button => button.onclick = () => send(button.dataset.liveQuick!));
    this.root.querySelector<HTMLElement>('[data-live-connect]')!.onclick = () => { const url = this.root.querySelector<HTMLInputElement>('[data-live-url]')!.value.trim(); if (url) this.live.connectWebSocket(url); };
    this.root.querySelector<HTMLElement>('[data-live-disconnect]')!.onclick = () => this.live.disconnect();
    this.root.querySelector<HTMLElement>('[data-live-start]')!.onclick = () => { send('开始直播'); this.actions.liveStart(this.live.state.profiles.map(profile => ({ ...profile, ownedWeapons: [...profile.ownedWeapons], ownedOutfits: [...profile.ownedOutfits], ownedHairstyles: [...profile.ownedHairstyles] })), this.live.state, this.live); };
    this.bindCommon();
  }

  showCustomMode() {
    this.screen = 'settings';
    const mode = this.save.customMode;
    const sizeOptions = [48, 60, 72, 84, 96];
    this.root.innerHTML = `<div class="screen panel-screen custom-mode-screen">
      <div class="panel-bg"></div>
      <header class="panel-header"><button class="back-btn" data-action="back">←</button><div><small>BATTLE BUILDER</small><h2>自定义战场</h2></div><button class="secondary-btn custom-clear" data-custom-clear>清空方块</button></header>
      <main class="custom-layout">
        <section class="custom-editor glass">
          <div class="section-heading"><div><small>PLACE WHITE BLOCKS</small><h3>方块布局</h3></div><span>点击格子摆放 / 删除</span></div>
          <div class="custom-grid" data-custom-grid style="--grid-size:${mode.gridSize}"></div>
          <div class="custom-block-tools"><button class="block-tool selected" data-block-kind="low">低台</button><button class="block-tool" data-block-kind="high">高台</button><button class="block-tool" data-block-kind="tower">塔块</button></div>
        </section>
        <aside class="custom-options glass">
          <div class="section-heading"><div><small>RULE SET</small><h3>战场规则</h3></div></div>
          <label><span>地图尺寸<em>可选大范围编辑空间</em></span><select data-custom="worldSize">${sizeOptions.map(size => `<option value="${size}" ${size === mode.worldSize ? 'selected' : ''}>${size} × ${size}</option>`).join('')}</select></label>
          <label><span>每队人数<em>2v2 至 20v20</em></span><select data-custom="teamSize">${Array.from({ length: 19 }, (_, i) => i + 2).map(size => `<option value="${size}" ${size === mode.teamSize ? 'selected' : ''}>${size} 人</option>`).join('')}</select></label>
          <label><span>队伍数量<em>不同颜色同时对决</em></span><select data-custom="teamCount">${[2,3,4,5,6].map(count => `<option value="${count}" ${count === mode.teamCount ? 'selected' : ''}>${count} 队</option>`).join('')}</select></label>
          <label><span>比赛时长<em>自定义倒计时</em></span><select data-custom-rule="matchSeconds">${[60,90,120,150,180,300].map(sec => `<option value="${sec}" ${sec === mode.rules.matchSeconds ? 'selected' : ''}>${sec} 秒</option>`).join('')}</select></label>
          <div class="custom-toggles">
            ${([['allowJump','允许跳跃'],['allowSubmerge','允许潜墨'],['allowSpecialWeapons','特殊武器'],['allowRespawn','允许复活'],['allowDamage','允许伤害'],['turfWin','占地胜负']] as Array<[keyof CustomRules, string]>).map(([key, label]) => `<label class="toggle-line"><span>${label}</span><input type="checkbox" data-custom-rule="${key}" ${mode.rules[key] ? 'checked' : ''}/></label>`).join('')}
          </div>
          <button class="primary-btn custom-start" data-custom-start><span>进入自定义对战</span><small>${mode.teamCount} 队 · ${mode.teamSize} 人 / 队</small><b>→</b></button>
        </aside>
      </main>
    </div>`;
    const grid = this.root.querySelector<HTMLElement>('[data-custom-grid]')!;
    const renderGrid = () => {
      const cols = 12;
      grid.innerHTML = '';
      for (let z = -6; z < 6; z++) for (let x = -6; x < 6; x++) {
        const worldX = Math.round(x * mode.worldSize / cols);
        const worldZ = Math.round(z * mode.worldSize / cols);
        const block = mode.blocks.find(item => item.x === worldX && item.z === worldZ);
        const cell = document.createElement('button');
        cell.className = `grid-cell ${block ? `filled ${block.kind}` : ''}`;
        cell.dataset.x = String(worldX); cell.dataset.z = String(worldZ);
        cell.title = `${worldX}, ${worldZ}`;
        cell.onclick = () => {
          const index = mode.blocks.findIndex(item => item.x === worldX && item.z === worldZ);
          if (index >= 0) mode.blocks.splice(index, 1);
          else mode.blocks.push({ x: worldX, z: worldZ, kind: (grid.dataset.kind as 'low' | 'high' | 'tower') ?? 'low' });
          this.persist(); renderGrid();
        };
        grid.appendChild(cell);
      }
    };
    grid.dataset.kind = 'low'; renderGrid();
    this.root.querySelectorAll<HTMLElement>('[data-block-kind]').forEach(button => button.onclick = () => {
      this.root.querySelectorAll('[data-block-kind]').forEach(item => item.classList.remove('selected'));
      button.classList.add('selected'); grid.dataset.kind = button.dataset.blockKind!;
    });
    this.root.querySelector<HTMLElement>('[data-custom-clear]')!.onclick = () => { mode.blocks.length = 0; this.persist(); renderGrid(); };
    this.root.querySelectorAll<HTMLSelectElement>('[data-custom]').forEach(control => control.onchange = () => { (mode as any)[control.dataset.custom!] = Number(control.value); this.persist(); });
    this.root.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-custom-rule]').forEach(control => control.onchange = () => { const key = control.dataset.customRule!; (mode.rules as any)[key] = control instanceof HTMLInputElement ? control.checked : Number(control.value); this.persist(); });
    this.root.querySelector<HTMLElement>('[data-custom-start]')!.onclick = () => { this.save.arena = 'custom'; this.persist(); this.actions.startGame(); };
    this.bindCommon();
  }

  showLoadout() {
    this.screen = 'loadout';
    const selectedWeapon = WEAPONS.find(w => w.id === this.save.weapon)!;
    const selectedOutfit = OUTFITS.find(o => o.id === this.save.outfit)!;
    const selectedHair = HAIRSTYLES.find(h => h.id === this.save.hairstyle) ?? HAIRSTYLES[0];
    this.root.innerHTML = `
      <div class="screen panel-screen">
        <div class="panel-bg"></div>
        <header class="panel-header"><button class="back-btn" data-action="back">←</button><div><small>NEON WORKSHOP</small><h2>装备工坊</h2></div><span class="coin-chip"><b>✦</b> ${this.save.coins.toLocaleString()}</span></header>
        <div class="loadout-layout">
          <aside class="workshop-preview glass">
            <div class="preview-label">PLAYER 01</div>
            ${this.characterPreview(selectedOutfit.primary, selectedOutfit.accent, this.save.hairstyle, true)}
            <div class="equipped-tag">已装备 · ${selectedOutfit.name} / ${selectedHair.name}</div>
          </aside>
          <main class="catalog">
            <div class="catalog-section">
              <div class="section-heading"><div><small>CHOOSE YOUR STYLE</small><h3>武器</h3></div><span>${WEAPONS.length} ITEMS</span></div>
              <div class="weapon-grid">${WEAPONS.map(w => `
                <button class="weapon-card ${w.id === this.save.weapon ? 'selected' : ''}" data-weapon="${w.id}" style="--item-color:${w.color}">
                  <span class="weapon-icon">${w.icon}</span><div><strong>${w.name}</strong><small>${w.subtitle}</small></div>
                  <div class="weapon-bars"><i style="--v:${Math.round(w.damage)}%"></i><i style="--v:${Math.min(100, Math.round(w.range * 4))}%"></i><i style="--v:${Math.round(w.paintRadius * 25)}%"></i></div>
                  <span class="check">✓</span>
                </button>`).join('')}</div>
            </div>
            <div class="catalog-section">
              <div class="section-heading"><div><small>MIX CLOTHING FREELY</small><h3>独立选择服装</h3></div><span>${OUTFITS.length} OUTFITS</span></div>
              <div class="outfit-grid">${OUTFITS.map(o => `
                <button class="outfit-card ${o.id === this.save.outfit ? 'selected' : ''}" data-outfit="${o.id}">
                  <span class="fabric" style="--p:${o.primary};--a:${o.accent}" data-style="${o.style}"></span><strong>${o.name}</strong><small>${o.desc}</small><em>${this.outfitMeta(o)}</em><span class="check">✓</span>
                </button>`).join('')}</div>
            </div>
            <div class="catalog-section hair-section">
              <div class="section-heading"><div><small>MIX ANY HAIR WITH ANY OUTFIT</small><h3>自由选择发型</h3></div><span>${HAIRSTYLES.length} STYLES</span></div>
              <div class="hair-grid">${HAIRSTYLES.map(h => `
                <button class="hair-card ${h.id === this.save.hairstyle ? 'selected' : ''}" data-hairstyle="${h.id}">
                  <span class="hair-preview hair-${h.id}"><i></i><b></b></span><strong>${h.name}</strong><small>${h.desc}</small><span class="check">✓</span>
                </button>`).join('')}</div>
            </div>
          </main>
          <aside class="weapon-detail glass">
            <span class="detail-icon" style="color:${selectedWeapon.color}">${selectedWeapon.icon}</span><small>SELECTED WEAPON</small><h3>${selectedWeapon.name}</h3><p>${selectedWeapon.subtitle}</p>
            <div class="stat-row"><span>威力</span><i><b style="width:${selectedWeapon.damage}%"></b></i></div>
            <div class="stat-row"><span>射程</span><i><b style="width:${Math.min(100, selectedWeapon.range * 4)}%"></b></i></div>
            <div class="stat-row"><span>涂色</span><i><b style="width:${Math.min(100, selectedWeapon.paintRadius * 25)}%"></b></i></div>
            <button class="primary-btn compact" data-action="start"><span>带上它出战</span><b>→</b></button>
          </aside>
        </div>
      </div>`;
    this.root.querySelectorAll<HTMLElement>('[data-weapon]').forEach(el => el.onclick = () => { this.save.weapon = el.dataset.weapon as WeaponId; this.persist(); this.showLoadout(); });
    this.root.querySelectorAll<HTMLElement>('[data-outfit]').forEach(el => el.onclick = () => { this.save.outfit = el.dataset.outfit!; this.persist(); this.showLoadout(); });
    this.root.querySelectorAll<HTMLElement>('[data-hairstyle]').forEach(el => el.onclick = () => { this.save.hairstyle = el.dataset.hairstyle as SaveData['hairstyle']; this.persist(); this.showLoadout(); });
    this.bindCommon();
  }

  showSettings(overGame = false) {
    const previous = this.screen;
    if (!overGame) this.screen = 'settings';
    const modal = document.createElement('div');
    modal.className = 'modal-layer';
    modal.innerHTML = `<div class="settings-modal glass">
      <button class="modal-close">×</button><small>SYSTEM & ACCESSIBILITY</small><h2>游戏设置</h2>
      <div class="settings-grid">
        <label><span>AI 难度<em>选择对手的战术强度</em></span><select data-setting="difficulty"><option value="casual">休闲</option><option value="standard">标准</option><option value="expert">高手</option></select></label>
        <label><span>镜头灵敏度<em>键鼠与触控同步调整</em></span><input data-setting="sensitivity" type="range" min="0.5" max="1.8" step="0.1" value="${this.save.sensitivity}"></label>
        <label><span>音效音量<em>武器与战斗反馈</em></span><input data-setting="sfx" type="range" min="0" max="1" step="0.05" value="${this.save.sfx}"></label>
        <label><span>画面质量<em>移动端建议使用中等</em></span><select data-setting="quality"><option value="low">流畅</option><option value="medium">均衡</option><option value="high">精美</option></select></label>
        <label><span>移动摇杆<em>固定位置或触点浮动生成</em></span><select data-setting="joystickMode"><option value="fixed">固定</option><option value="floating">浮动</option></select></label>
        <label><span>无限墨水<em>武器和水气球不消耗墨水</em></span><select data-setting="infiniteInk"><option value="false">关闭</option><option value="true">开启</option></select></label>
        <label><span>无限血量<em>玩家不会受到伤害或被淘汰</em></span><select data-setting="infiniteHealth"><option value="false">关闭</option><option value="true">开启</option></select></label>
      </div>
      <div class="settings-note"><b>跨端提示</b><p>手机请横屏游玩；桌面端点击战场后使用鼠标控制镜头。</p></div>
      ${overGame ? '<button class="danger-btn" data-quit>退出本局</button>' : ''}
    </div>`;
    this.root.appendChild(modal);
    (modal.querySelector('[data-setting="difficulty"]') as HTMLSelectElement).value = this.save.difficulty;
    (modal.querySelector('[data-setting="quality"]') as HTMLSelectElement).value = this.save.quality;
    (modal.querySelector('[data-setting="joystickMode"]') as HTMLSelectElement).value = this.save.joystickMode;
    (modal.querySelector('[data-setting="infiniteInk"]') as HTMLSelectElement).value = String(this.save.infiniteInk);
    (modal.querySelector('[data-setting="infiniteHealth"]') as HTMLSelectElement).value = String(this.save.infiniteHealth);
    const close = () => { modal.remove(); if (!overGame) this.screen = previous; };
    modal.querySelector<HTMLElement>('.modal-close')!.onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach(el => el.onchange = () => {
      const key = el.dataset.setting as keyof SaveData;
      const booleanSetting = key === 'infiniteInk' || key === 'infiniteHealth';
      (this.save as any)[key] = booleanSetting ? el.value === 'true' : el instanceof HTMLInputElement ? Number(el.value) : el.value;
      this.persist();
    });
    modal.querySelector<HTMLElement>('[data-quit]')?.addEventListener('click', () => { close(); this.actions.quitGame(); });
  }

  showGameShell(spectating = false, liveMode = false, liveProcessor?: LiveCommandProcessor) {
    this.screen = 'game';
    this.liveMode = liveMode;
    this.liveProcessor = liveProcessor;
    this.spectating = spectating;
    const weapon = WEAPONS.find(w => w.id === this.save.weapon)!;
    const activeTeams = liveMode ? TEAM_ORDER.slice(0, 4) : this.currentTeams();
    const teamHud = activeTeams.map(team => `<div class="team-score team-${team}" aria-label="${TEAM_COLORS[team].name}队">${this.teamMark(TEAM_COLORS[team].css)}</div>`).join('');
    const teamMeters = activeTeams.map(team => `<i data-team-meter="${team}" style="background:${TEAM_COLORS[team].css};width:${100 / activeTeams.length}%"></i>`).join('');
    this.root.innerHTML = `
      <div class="screen game-screen ${liveMode ? 'live-game-screen' : ''}">
        <canvas id="game-canvas"></canvas>
        <div class="game-vignette"></div>
        <header class="hud-top" aria-label="对战状态">
          ${teamHud}
          <div class="timer" aria-label="剩余时间">${liveMode ? `<span class="live-hud-room">LIVE · ${liveProcessor?.state.roomCode ?? 'ROOM'}</span>` : ''}${this.timerGlyph()}${this.svgDigits(liveMode ? '2:00' : '2:30', { fill: '#ffffff', className: 'hud-digits time-digits', dataAttr: 'data-time' })}</div>
        </header>
        <div class="turf-meter multi-team-meter">${teamMeters}</div>
        <div class="crosshair"><i></i><i></i><i></i><i></i><b data-hitmarker></b></div>
        <div class="damage-vignette" data-damage-vignette></div>
        ${liveMode ? `<aside class="live-hud-panel"><div class="live-hud-line"><span class="live-dot"></span><b>LIVE</b><em data-live-hud-viewers>${liveProcessor?.state.viewers ?? 1}人</em></div><div class="live-hud-feed" data-live-hud-feed></div><div class="live-hud-gifts">礼物强化 <b data-live-hud-power>0</b></div><div class="live-hud-compose"><input data-live-hud-command placeholder="发送弹幕"/><button data-live-hud-send>发送</button></div><div class="live-hud-connect"><input data-live-hud-url placeholder="弹幕 WebSocket"/><button data-live-hud-connect>接入</button></div></aside>` : ''}
        <div class="hud-bottom-left">
          <div class="weapon-hud" aria-label="当前武器"><span class="weapon-glyph">${this.blasterIcon(weapon.color)}</span></div>
          <div class="ammo-ring" aria-label="颜料余量"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42"></circle><circle data-ammo-ring cx="50" cy="50" r="42"></circle></svg>${this.svgIcon('#b8ff3d', 31)}${this.svgDigits('100', { fill: '#b8ff3d', className: 'hud-digits ammo-digits', dataAttr: 'data-ammo-text' })}</div>
        </div>
        <div class="health-ring" aria-label="生命值"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42"></circle><circle data-health-ring cx="50" cy="50" r="42"></circle></svg>${this.healthIcon()}${this.svgDigits('100', { fill: '#ffffff', className: 'hud-digits health-digits', dataAttr: 'data-health' })}</div>
        ${spectating ? '' : `<div class="score-chip" aria-label="占地贡献">${this.turfIcon()}${this.svgDigits('0000', { fill: '#b8ff3d', className: 'hud-digits score-digits', dataAttr: 'data-score' })}</div>`}
        <button class="pause-btn" data-pause aria-label="暂停">${this.pauseIcon()}</button>
        <div class="respawn-overlay" data-respawn aria-label="重新入场">${this.respawnIcon()}${this.svgDigits('3.0', { fill: '#ff6b2c', className: 'hud-digits respawn-digits', dataAttr: 'data-respawn-time' })}</div>
        ${spectating ? '' : `<div class="mobile-controls">
          <div class="joystick" data-stick aria-label="移动摇杆"><i data-stick-knob></i></div>
          <button class="bomb-btn" data-water-bomb aria-label="投掷水气球">${this.waterBombIcon()}</button>
          <button class="jump-btn" data-jump aria-label="跳跃">${this.jumpIcon()}</button>
          <button class="dash-btn" data-submerge aria-label="潜入己方墨水">${this.submergeIcon()}</button>
          <button class="fire-btn" data-fire aria-label="喷涂">${this.fireIcon()}</button>
        </div>`}
      </div>`;
    this.root.querySelector<HTMLElement>('[data-pause]')!.onclick = () => this.showPause();
    if (liveMode && liveProcessor) {
      this.liveEventUnsubscribe = liveProcessor.subscribeEvents(event => {
        const viewer = this.root.querySelector<HTMLElement>('[data-live-hud-viewers]');
        if (viewer) viewer.textContent = `${liveProcessor.state.viewers}人`;
        const power = this.root.querySelector<HTMLElement>('[data-live-hud-power]');
        if (power && event.type === 'gift') power.textContent = String(event.profile.giftPower);
        const feed = this.root.querySelector<HTMLElement>('[data-live-hud-feed]');
        if (feed) {
          const label = event.type === 'gift' ? `礼物强化 +${event.power}` : event.type === 'join' ? `加入${TEAM_COLORS[event.profile.team ?? 'cyan'].name}队` : event.type === 'tactic' ? event.tactic : '装备同步';
          const line = document.createElement('div'); line.className = 'live-hud-feed-line'; line.textContent = `${event.profile.userName} · ${label}`; feed.prepend(line); while (feed.children.length > 4) feed.lastElementChild?.remove();
        }
      });
      const commandInput = this.root.querySelector<HTMLInputElement>('[data-live-hud-command]');
      const submitCommand = () => { if (commandInput?.value.trim()) { liveProcessor.receive(createDemoMessage(commandInput.value)); commandInput.value = ''; } };
      commandInput?.addEventListener('keydown', event => { if (event.key === 'Enter') submitCommand(); });
      this.root.querySelector<HTMLElement>('[data-live-hud-send]')?.addEventListener('click', submitCommand);
      this.root.querySelector<HTMLElement>('[data-live-hud-connect]')?.addEventListener('click', () => {
        const url = this.root.querySelector<HTMLInputElement>('[data-live-hud-url]')?.value.trim();
        if (url) liveProcessor.connectWebSocket(url);
      });
    }
    return this.root.querySelector<HTMLCanvasElement>('#game-canvas')!;
  }

  private showPause() {
    this.actions.pauseGame(true);
    const modal = document.createElement('div');
    modal.className = 'modal-layer pause-layer';
    modal.innerHTML = `<div class="pause-modal glass"><small>MATCH PAUSED</small><h2>暂停</h2><button class="primary-btn" data-resume><span>继续对战</span><b>→</b></button><button class="secondary-btn" data-settings>游戏设置</button><button class="danger-btn" data-quit>退出本局</button></div>`;
    this.root.appendChild(modal);
    const close = () => { modal.remove(); this.actions.pauseGame(false); };
    modal.querySelector<HTMLElement>('[data-resume]')!.onclick = close;
    modal.querySelector<HTMLElement>('[data-settings]')!.onclick = () => this.showSettings(true);
    modal.querySelector<HTMLElement>('[data-quit]')!.onclick = () => { modal.remove(); this.actions.quitGame(); };
  }

  updateStats(stats: GameStats) {
    this.stats = stats;
    if (this.liveMode && this.liveProcessor) {
      const current = this.liveProcessor.state;
      const viewer = this.root.querySelector<HTMLElement>('[data-live-hud-viewers]');
      if (viewer) viewer.textContent = `${current.viewers}人`;
    }
    if (stats.time <= 0 && !this.endingReveal) {
      this.endingReveal = true;
      this.root.querySelector('.game-screen')?.classList.add('ending-reveal');
      this.root.querySelector('.hud-top')?.classList.add('reveal-count');
    }
    const q = <T extends Element = HTMLElement>(s: string) => this.root.querySelector<T>(s);
    this.updateDigits(q<SVGSVGElement>('[data-time]'), this.endingReveal ? '0:00' : `${Math.floor(stats.time / 60)}:${Math.floor(stats.time % 60).toString().padStart(2, '0')}`);
    q<HTMLElement>('[data-meter-cyan]')?.style.setProperty('width', `${stats.cyan}%`);
    Object.entries(stats.teams ?? {}).forEach(([team, percent]) => q<HTMLElement>(`[data-team-meter="${team}"]`)?.style.setProperty('width', `${percent}%`));
    this.updateDigits(q<SVGSVGElement>('[data-ammo-text]'), `${Math.round(stats.ammo)}`);
    const ammoRatio = Math.max(0, Math.min(100, stats.ammo)) / 100;
    q<SVGCircleElement>('[data-ammo-ring]')!.style.strokeDashoffset = `${264 - 264 * ammoRatio}`;
    this.updateDigits(q<SVGSVGElement>('[data-health]'), `${Math.max(0, Math.round(stats.health))}`);
    q<SVGCircleElement>('[data-health-ring]')!.style.strokeDashoffset = `${264 - 264 * Math.max(0, stats.health) / 100}`;
    if (!this.spectating) this.updateDigits(q<SVGSVGElement>('[data-score]'), Math.round(stats.score).toString().padStart(4, '0'));
    const damageVignette = q<HTMLElement>('[data-damage-vignette]');
    if (damageVignette && stats.health < this.previousHealth) {
      damageVignette.classList.remove('flash');
      void damageVignette.offsetWidth;
      damageVignette.classList.add('flash');
    }
    this.previousHealth = stats.health;
    const respawn = q<HTMLElement>('[data-respawn]')!;
    respawn.classList.toggle('show', !stats.alive);
    this.updateDigits(q<SVGSVGElement>('[data-respawn-time]'), stats.respawn.toFixed(1));
  }

  showHitmarker(_damage: number, eliminated: boolean) {
    const hitmarker = this.root.querySelector<HTMLElement>('[data-hitmarker]');
    if (!hitmarker) return;
    hitmarker.innerHTML = eliminated ? this.splatIcon() : this.hitIcon();
    hitmarker.className = eliminated ? 'eliminated' : 'hit';
    clearTimeout(this.hitmarkerTimer);
    this.hitmarkerTimer = window.setTimeout(() => {
      hitmarker.className = '';
      hitmarker.innerHTML = '';
    }, eliminated ? 650 : 320);
  }

  showResult(stats: GameStats & { won: boolean; kills: number; ranking?: Team[] }) {
    this.screen = 'result';
    this.save.matches++; if (stats.won) this.save.wins++; const reward = 180 + Math.round(stats.score * 0.2); this.save.coins += reward; this.persist();
    const teams = this.currentTeams();
    const rankOrder = stats.ranking?.length ? stats.ranking : [...teams].sort((a, b) => (stats.teams?.[b] ?? 0) - (stats.teams?.[a] ?? 0));
    const resultRows = rankOrder.map((team, index) => `<div class="result-team team-${team}" style="--team-color:${TEAM_COLORS[team].css}"><strong class="rank-number">${index + 1}</strong><span>${TEAM_COLORS[team].name}队</span><b>${(stats.teams?.[team] ?? (team === 'cyan' ? stats.cyan : stats.orange)).toFixed(1)}<small>%</small></b><i style="width:${stats.teams?.[team] ?? (team === 'cyan' ? stats.cyan : stats.orange)}%"></i></div>`).join('');
    this.root.innerHTML = `<div class="screen result-screen ${stats.won ? 'won' : 'lost'}">
      <div class="result-rays"></div><div class="result-stamp">${stats.won ? 'TURF SECURED' : 'NEXT ROUND'}</div>
      <header><small>MATCH COMPLETE</small><h1>${stats.won ? '漂亮拿下！' : '差一点点！'}</h1><p>全场上帝视角回放完成，最终排名已公布。</p></header>
      <div class="result-board glass ${teams.length > 2 ? 'multi-result' : ''}">${resultRows}</div>
      <div class="performance-grid"><div><small>占地贡献</small><b>${Math.round(stats.score)}</b><em>PAINT PTS</em></div><div><small>击退数</small><b>${stats.kills}</b><em>SPLATS</em></div><div><small>本局奖励</small><b>+${reward}</b><em>NEON COINS</em></div></div>
      <div class="result-actions"><button class="primary-btn huge" data-action="restart"><span>再来一局</span><small>REMATCH</small><b>↻</b></button><button class="secondary-btn" data-action="home">返回大厅</button></div>
    </div>`;
    this.bindCommon();
  }

  toast(message: string) {
    this.root.querySelector('.global-toast')?.remove();
    const el = document.createElement('div'); el.className = 'global-toast'; el.textContent = message; this.root.appendChild(el);
    clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => el.remove(), 2200);
  }

  private renderLoading() {
    this.root.innerHTML = `<div class="screen loading-screen"><div class="loading-logo"><span>N</span><h1>NEON TURF</h1><p>霓虹涂界</p></div><div class="loading-bar"><i></i></div><small>正在调制颜料…</small></div>`;
  }

  private readonly digitSegments: Record<string, string> = {
    '0': 'ab cdef'.replace(/ /g, ''), '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
    '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg'
  };

  private digitShapes(value: string, fill: string, stroke: string): { body: string; width: number } {
    const segments: Record<string, string> = {
      a: '<path d="M4 2 L15 2 L17 4 L15 6 L4 6 L2 4 Z"/>',
      b: '<path d="M16 5 L18 7 L18 14 L16 16 L14 14 L14 7 Z"/>',
      c: '<path d="M16 17 L18 19 L18 26 L16 28 L14 26 L14 19 Z"/>',
      d: '<path d="M4 27 L15 27 L17 29 L15 31 L4 31 L2 29 Z"/>',
      e: '<path d="M2 17 L4 19 L4 26 L2 28 L0 26 L0 19 Z"/>',
      f: '<path d="M2 5 L4 7 L4 14 L2 16 L0 14 L0 7 Z"/>',
      g: '<path d="M4 14.5 L15 14.5 L17 16.5 L15 18.5 L4 18.5 L2 16.5 Z"/>'
    };
    let x = 0;
    let body = '';
    for (const char of value) {
      if (/\d/.test(char)) {
        const active = this.digitSegments[char];
        body += `<g transform="translate(${x} 0)" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round">${[...active].map(s => segments[s]).join('')}</g>`;
        x += 22;
      } else if (char === ':') {
        body += `<g transform="translate(${x} 0)" fill="${fill}" stroke="${stroke}" stroke-width="1.2"><circle cx="3" cy="11" r="2.2"/><circle cx="3" cy="23" r="2.2"/></g>`;
        x += 10;
      } else if (char === '.') {
        body += `<circle cx="${x + 2.5}" cy="29" r="2.5" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
        x += 8;
      } else if (char === '%') {
        body += `<g transform="translate(${x} 0)" fill="none" stroke="${fill}" stroke-width="3" stroke-linecap="round"><circle cx="5" cy="8" r="3"/><circle cx="14" cy="24" r="3"/><path d="M3 27 L16 5"/></g>`;
        x += 21;
      } else {
        x += 8;
      }
    }
    return { body, width: Math.max(1, x) };
  }

  private svgDigits(value: string, o: { fill?: string; stroke?: string; className?: string; dataAttr?: string } = {}): string {
    const fill = o.fill ?? '#f4fbff';
    const stroke = o.stroke ?? '#07131f';
    const rendered = this.digitShapes(value, fill, stroke);
    return `<svg class="${o.className ?? 'hud-digits'}" viewBox="-2 -2 ${rendered.width + 4} 35" preserveAspectRatio="xMidYMid meet" data-value="${value}" data-fill="${fill}" data-stroke="${stroke}"${o.dataAttr ? ` ${o.dataAttr}` : ''} aria-hidden="true">${rendered.body}</svg>`;
  }

  private updateDigits(svg: SVGSVGElement | null, value: string) {
    if (!svg) return;
    const rendered = this.digitShapes(value, svg.dataset.fill || '#f4fbff', svg.dataset.stroke || '#07131f');
    svg.dataset.value = value;
    svg.setAttribute('viewBox', `-2 -2 ${rendered.width + 4} 35`);
    svg.innerHTML = rendered.body;
  }

  private svgIcon(color: string, size = 30): string {
    return `<svg class="svg-icon" viewBox="0 0 48 48" style="width:${size}px;height:${size}px" aria-hidden="true"><path d="M24 4 C30 12 37 19 37 28 A13 13 0 1 1 11 28 C11 19 18 12 24 4 Z" fill="${color}" stroke="#07131f" stroke-width="3.5" stroke-linejoin="round"/><ellipse cx="18.5" cy="25" rx="4" ry="6.5" fill="#fff" opacity=".5" transform="rotate(-18 18.5 25)"/><circle cx="38.5" cy="12" r="2.6" fill="${color}" stroke="#07131f" stroke-width="1.6"/><circle cx="9" cy="15" r="1.8" fill="${color}" stroke="#07131f" stroke-width="1.4"/></svg>`;
  }

  private teamMark(color: string): string {
    return `<svg class="team-mark" viewBox="0 0 42 42" aria-hidden="true"><path d="M6 28 C2 21 8 13 15 14 C16 7 24 4 29 10 C37 9 41 17 37 23 C41 31 32 38 25 34 C19 40 9 36 10 30 Z" fill="${color}" stroke="#07131f" stroke-width="3"/><path d="M14 24 Q21 16 29 23" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".72"/></svg>`;
  }

  private timerGlyph(): string {
    return '';
  }

  private blasterIcon(color: string): string {
    return `<svg class="blaster-icon" viewBox="0 0 72 58" aria-hidden="true"><path d="M11 22 L38 12 Q49 9 56 16 L63 23 L57 30 L42 26 L34 34 L22 34 Z" fill="${color}" stroke="#07131f" stroke-width="4" stroke-linejoin="round"/><path d="M29 31 L43 32 L39 49 L29 50 L24 35 Z" fill="#f4fbff" stroke="#07131f" stroke-width="4"/><path d="M56 18 L68 14" stroke="#07131f" stroke-width="6" stroke-linecap="round"/><circle cx="17" cy="20" r="5" fill="#fff" opacity=".55"/></svg>`;
  }

  private healthIcon(): string {
    return `<svg class="health-icon" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 34 C14 28 6 23 6 14 C6 7 15 5 20 11 C25 5 34 7 34 14 C34 23 26 28 20 34 Z" fill="#ff4167" stroke="#07131f" stroke-width="3"/><path d="M20 14 V25 M14.5 19.5 H25.5" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>`;
  }

  private turfIcon(): string {
    return `<svg class="status-icon" viewBox="0 0 58 42" aria-hidden="true"><path d="M7 31 C2 21 11 8 22 13 C27 3 43 7 42 18 C54 18 57 32 47 37 H15 Z" fill="#16e0d0" stroke="#07131f" stroke-width="3"/><path d="M30 9 C38 15 43 22 43 28 A13 13 0 0 1 20 35 C24 27 25 18 30 9 Z" fill="#ff6b2c" stroke="#07131f" stroke-width="3"/></svg>`;
  }

  private spectatorIcon(): string {
    return `<svg class="status-icon" viewBox="0 0 58 42" aria-hidden="true"><path d="M4 21 Q29 -1 54 21 Q29 43 4 21 Z" fill="#b8ff3d" stroke="#07131f" stroke-width="3"/><circle cx="29" cy="21" r="9" fill="#07131f"/><circle cx="26" cy="18" r="3" fill="#fff"/></svg>`;
  }

  private botDuelIcon(): string {
    return `<svg class="bot-duel-icon" viewBox="0 0 88 44" aria-hidden="true"><g fill="#16e0d0" stroke="#07131f" stroke-width="3"><rect x="4" y="10" width="30" height="26" rx="8"/><path d="M19 10 V4 M14 4 H24"/></g><g fill="#ff6b2c" stroke="#07131f" stroke-width="3"><rect x="54" y="10" width="30" height="26" rx="8"/><path d="M69 10 V4 M64 4 H74"/></g><g fill="#07131f"><circle cx="14" cy="22" r="3"/><circle cx="24" cy="22" r="3"/><circle cx="64" cy="22" r="3"/><circle cx="74" cy="22" r="3"/></g><path d="M39 14 L48 22 L39 30 M49 14 L40 22 L49 30" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`;
  }

  private pauseIcon(): string {
    return `<svg class="pause-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="4.6" height="16" rx="2.3" fill="#f4fbff" stroke="#07131f" stroke-width="1.6"/><rect x="14.4" y="4" width="4.6" height="16" rx="2.3" fill="#f4fbff" stroke="#07131f" stroke-width="1.6"/></svg>`;
  }

  private respawnIcon(): string {
    return `<svg class="respawn-icon" viewBox="0 0 92 92" aria-hidden="true"><path d="M75 30 A33 33 0 1 0 77 58" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/><path d="M71 12 L82 33 L59 35 Z" fill="#ff6b2c" stroke="#07131f" stroke-width="4"/><path d="M46 24 C55 36 63 44 63 56 A17 17 0 1 1 29 56 C29 44 37 36 46 24 Z" fill="#16e0d0" stroke="#07131f" stroke-width="4"/></svg>`;
  }

  private waterBombIcon(): string {
    return `<svg class="control-icon bomb-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M21 17 C23 10 31 7 37 10 L43 16" fill="none" stroke="#e6fffc" stroke-width="5" stroke-linecap="round"/><path d="M42 8 L51 6 L49 15" fill="#b8ff3d" stroke="#062126" stroke-width="3" stroke-linejoin="round"/><path d="M32 16 C44 16 53 26 52 39 C51 51 42 57 31 57 C18 57 10 49 11 37 C12 25 20 17 32 16 Z" fill="#16e0d0" stroke="#062126" stroke-width="4"/><path d="M21 31 Q32 21 44 31 Q34 39 21 31 Z" fill="#e6fffc" opacity=".72"/><circle cx="24" cy="42" r="5" fill="#b8ff3d" stroke="#062126" stroke-width="2"/></svg>`;
  }

  private jumpIcon(): string {
    return `<svg class="control-icon jump-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M12 49 Q31 56 52 47" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/><path d="M32 48 V14 M18 29 L32 14 L46 29" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="39" r="3" fill="#b8ff3d"/><circle cx="52" cy="36" r="4" fill="#16e0d0"/></svg>`;
  }

  private submergeIcon(): string {
    return `<svg class="control-icon dash-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M6 39 C14 33 22 44 31 37 C39 31 47 42 58 34 V54 H6 Z" fill="#08d3c8" stroke="#062126" stroke-width="4" stroke-linejoin="round"/><path d="M32 8 C39 18 45 24 45 32 A13 13 0 1 1 19 32 C19 24 25 18 32 8 Z" fill="#e6fffc" stroke="#062126" stroke-width="4"/><path d="M32 18 V38 M24 31 L32 40 L40 31" fill="none" stroke="#062126" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  private fireIcon(): string {
    return `<svg class="control-icon fire-icon" viewBox="0 0 82 82" aria-hidden="true"><path d="M12 51 C4 34 21 14 37 23 C45 6 70 17 66 37 C83 46 68 72 48 65 C34 80 10 70 12 51 Z" fill="#fff" stroke="#5e2000" stroke-width="5"/><path d="M38 49 L57 39 M35 43 L44 28" stroke="#ff6b2c" stroke-width="8" stroke-linecap="round"/><circle cx="28" cy="54" r="6" fill="#ff6b2c"/></svg>`;
  }

  private hitIcon(): string {
    return `<svg viewBox="0 0 52 52" aria-hidden="true"><path d="M6 26 H18 M34 26 H46 M26 6 V18 M26 34 V46" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="26" cy="26" r="7" fill="#b8ff3d" stroke="#07131f" stroke-width="3"/></svg>`;
  }

  private splatIcon(): string {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M9 35 C0 21 17 9 28 17 C37 1 55 13 51 28 C68 38 49 60 34 51 C22 64 4 51 9 35 Z" fill="#b8ff3d" stroke="#07131f" stroke-width="4"/><path d="M22 24 L42 44 M42 24 L22 44" stroke="#07131f" stroke-width="7" stroke-linecap="round"/></svg>`;
  }

  private outfitMeta(outfit: OutfitSpec) {
    const style = { hoodie: '卫衣', jacket: '夹克', jersey: '球衣', coat: '风衣' }[outfit.style];
    const bottoms = { shorts: '短裤', skirt: '裙装', pants: '长裤' }[outfit.bottoms];
    return `${style} · ${bottoms}`;
  }

  private bindCommon() {
    this.root.querySelector<HTMLElement>('[data-action="start"]')?.addEventListener('click', this.actions.startGame);
    this.root.querySelector<HTMLElement>('[data-action="spectate"]')?.addEventListener('click', this.actions.spectateGame);
    this.root.querySelector<HTMLElement>('[data-action="restart"]')?.addEventListener('click', this.actions.restartGame);
    this.root.querySelector<HTMLElement>('[data-action="home"]')?.addEventListener('click', this.showHome.bind(this));
    this.root.querySelector<HTMLElement>('[data-action="back"]')?.addEventListener('click', this.showHome.bind(this));
    this.root.querySelector<HTMLElement>('[data-action="loadout"]')?.addEventListener('click', this.showLoadout.bind(this));
    this.root.querySelector<HTMLElement>('[data-action="live"]')?.addEventListener('click', () => this.startLiveDirect());
    this.root.querySelector<HTMLElement>('[data-action="settings"]')?.addEventListener('click', () => this.showSettings());
  }

  private startLiveDirect() {
    this.live.launch();
    this.actions.liveStart([], this.live.state, this.live);
  }

  private currentTeams
() {
    if (this.save.arena === 'custom') return TEAM_ORDER.slice(0, this.save.customMode.teamCount);
    return ['cyan', 'orange'] as const;
  }

  private characterPreview(primary: string, accent: string, hairstyle: SaveData['hairstyle'], large = false) {
    return `<div class="avatar-preview ${large ? 'large' : ''}" style="--avatar-primary:${primary};--avatar-accent:${accent}">
      <div class="avatar-shadow"></div><div class="avatar-leg l"></div><div class="avatar-leg r"></div><div class="avatar-body"></div><div class="avatar-arm l"></div><div class="avatar-arm r"></div><div class="avatar-head"><span class="avatar-hair-style hair-${hairstyle}"><i></i><b></b></span><b class="visor"></b></div><div class="avatar-gun"><i></i></div>
    </div>`;
  }
}
