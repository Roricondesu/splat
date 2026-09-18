import './style.css';
import { NeonGame } from './game/game';
import { SaveData, WEAPONS } from './game/config';
import { LiveCommandProcessor, LiveRoomState } from './live/live';
import type { LiveProfile } from './live/live';
import { GameUI } from './ui/ui';

const app = document.querySelector<HTMLElement>('#app')!;
let game: NeonGame | null = null;
let latestSave: SaveData;

const ui = new GameUI(app, {
  startGame: () => beginGame(false),
  spectateGame: () => beginGame(true),
  restartGame: () => beginGame(false),
  quitGame: () => {
    game?.dispose(); game = null; ui.showHome();
  },
  pauseGame: paused => game?.setPaused(paused),
  liveStart: (profiles, room, live) => beginGame(true, profiles, { ...room, started: true }, live),
  setViewMode: mode => { game?.setViewMode(mode); },
  startBattleRoyale: options => beginGame(false, [], undefined, undefined, options),
  saveChanged: save => { latestSave = save; }
});
latestSave = ui.save;

function beginGame(spectating = false, liveProfiles: LiveProfile[] = [], liveRoom?: LiveRoomState, live?: LiveCommandProcessor, brOptions?: { players: number; teams: number }) {
  game?.dispose();
  const canvas = ui.showGameShell(spectating, Boolean(live), live, Boolean(brOptions), brOptions?.teams ?? 0);
  game = new NeonGame(canvas, { ...latestSave }, {
    onStats: stats => ui.updateStats(stats),
    onHit: (damage, eliminated) => ui.showHitmarker(damage, eliminated),
    onEnd: stats => { game?.dispose(); game = null; ui.showResult(stats); }
  }, liveProfiles, liveRoom, live, brOptions);
  game.bindMobileControls(app);
  game.setSpectatorMode(spectating);
  if (spectating) ui.toast('观战：WASD 平移 · 滚轮/双指缩放 · 拖动转视角 · 空格或 F 回到全景');
  if (location.hostname === 'localhost') {
    Object.assign(window, {
      __neonDebug: {
        state: () => game?.getDebugState(),
        respawnPlayer: () => game?.debugRespawnPlayer(),
        setPlayerAmmo: (ammo: number) => game?.debugSetPlayerAmmo(ammo),
        setPlayerHealth: (health: number) => game?.debugSetPlayerHealth(health),
        setPlayerLastDamaged: (secondsAgo: number) => game?.debugSetPlayerLastDamaged(secondsAgo),
        paintUnderPlayer: (team: 'cyan' | 'orange') => game?.debugPaintUnderPlayer(team),
        finishMatch: () => game?.debugFinishMatch(),
        firePlayer: () => game?.debugFirePlayer(),
        throwWaterBomb: () => game?.debugThrowWaterBomb(),
        prepareWallClimb: () => game?.debugPrepareWallClimb(),
        eliminateNearestAi: () => game?.debugEliminateNearestAi(),
        fighterAnimation: () => game?.debugFighterAnimation(),
        setPlayerWeapon: (id: string) => game?.debugSetPlayerWeapon(id),
        setupPiercingProbe: () => game?.debugSetupPiercingProbe(),
        shieldProbe: (baseDamage?: number) => game?.debugShieldProbe(baseDamage),
        viewState: () => game?.debugViewState(),
        setViewMode: (mode: 'first' | 'third') => game?.setViewMode(mode),
        battleRoyale: () => game?.debugBattleRoyale(),
        spectatorCamera: () => game?.debugSpectatorCamera(),
        recenterSpectator: () => game?.recenterSpectatorCamera(),
        collapseZone: () => game?.debugCollapseZone(),
        placePlayerOutsideZone: () => game?.debugPlacePlayerOutsideZone(),
        eliminateAllButOneTeam: () => game?.debugEliminateAllButOneTeam(),
        weaponSpecs: () => WEAPONS.map(weapon => ({ ...weapon }))
      }
    });
  }
  game.start();
}

window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && game?.isRunning && !game.isPaused) {
    game.setPaused(true);
    ui.toast('游戏已暂停，点击右上角继续或退出');
    return;
  }
  // V toggles the battle camera; spectators always stay in third person.
  if (e.code === 'KeyV' && game?.isRunning && !game.isPaused && !game.isSpectating) {
    const next = game.viewMode === 'first' ? 'third' : 'first';
    game.setViewMode(next);
    ui.save.viewMode = next;
    ui.persist();
    ui.toast(next === 'first' ? '已切换：第一人称' : '已切换：第三人称');
    return;
  }
  // F returns the spectator camera to the automatic whole-battle framing.
  if (e.code === 'KeyF' && game?.isRunning && !game.isPaused && game.isSpectating) {
    game.recenterSpectatorCamera();
    ui.toast('已回到全景跟随');
  }
});

window.addEventListener('orientationchange', () => {
  if (matchMedia('(pointer: coarse)').matches && innerHeight > innerWidth) ui.toast('请横屏游玩，战斗视野更完整');
});
