import './style.css';
import { NeonGame } from './game/game';
import { SaveData, WEAPONS } from './game/config';
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
  saveChanged: save => { latestSave = save; }
});
latestSave = ui.save;

function beginGame(spectating = false) {
  game?.dispose();
  const canvas = ui.showGameShell(spectating);
  game = new NeonGame(canvas, { ...latestSave }, {
    onStats: stats => ui.updateStats(stats),
    onHit: (damage, eliminated) => ui.showHitmarker(damage, eliminated),
    onEnd: stats => { game?.dispose(); game = null; ui.showResult(stats); }
  });
  game.bindMobileControls(app);
  game.setSpectatorMode(spectating);
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
  }
});

window.addEventListener('orientationchange', () => {
  if (matchMedia('(pointer: coarse)').matches && innerHeight > innerWidth) ui.toast('请横屏游玩，战斗视野更完整');
});
