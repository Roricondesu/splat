import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { ArenaBuild, createArena } from './arena';
import { Difficulty, HAIRSTYLES, HairstyleId, OUTFITS, SaveData, TEAM_COLORS, TEAM_ORDER, Team, WEAPONS, WeaponSpec } from './config';
import { animateFighter, createFighter, Fighter, resetFighterPose } from './fighter';
import { InputController } from './input';
import { PaintField } from './paintField';
import type { LiveEvent, LiveProfile } from '../live/live';

export interface LiveEventSource {
  subscribeEvents(listener: (event: LiveEvent) => void): () => boolean;
}

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  owner: Fighter;
  life: number;
  weapon: WeaponSpec;
  previousPosition: THREE.Vector3;
  tail: THREE.Mesh[];
  intent: 'paint' | 'fight';
}

interface SurfaceInkSample {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  team: Team;
  radius: number;
}

interface WaterBomb {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  owner: Fighter;
  life: number;
  previousPosition: THREE.Vector3;
}

interface CombatEffect {
  group: THREE.Group;
  life: number;
  maxLife: number;
  velocity?: THREE.Vector3;
  update: (effect: CombatEffect, dt: number) => void;
}

/** Horizontal half-width of a fighter, used by height-aware collision. */
const BODY_RADIUS = 0.42;

export interface GameStats {
  time: number;
  cyan: number;
  orange: number;
  teams: Partial<Record<Team, number>>;
  health: number;
  ammo: number;
  score: number;
  weapon: WeaponSpec;
  alive: boolean;
  respawn: number;
}

export interface GameCallbacks {
  onStats: (stats: GameStats) => void;
  onHit: (damage: number, eliminated: boolean) => void;
  onEnd: (stats: GameStats & { won: boolean; kills: number }) => void;
}

export class NeonGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
  readonly renderer: THREE.WebGLRenderer;
  readonly input: InputController;
  readonly paint: PaintField;
  private fighters: Fighter[] = [];
  private projectiles: Projectile[] = [];
  private waterBombs: WaterBomb[] = [];
  private effects: CombatEffect[] = [];
  private arena: ArenaBuild;
  private obstacles: THREE.Object3D[];
  private paintables: THREE.Mesh[];
  private walkables: THREE.Object3D[];
  private obstacleBoxes: THREE.Box3[] = [];
  private surfaceDecals: THREE.Mesh[] = [];
  private surfaceInk: SurfaceInkSample[] = [];
  private readonly surfaceRaycaster = new THREE.Raycaster();
  private readonly decalOrientation = new THREE.Euler();
  private readonly decalSize = new THREE.Vector3();
  private readonly decalMaterials: Record<Team, THREE.MeshPhysicalMaterial>;
  private readonly surfaceSplatTexture: THREE.CanvasTexture;
  private player!: Fighter;
  private running = false;
  private paused = false;
  private ending = false;
  private readonly endingCoverage: Partial<Record<Team, number>> = {};
  private lastTime = 0;
  private readonly liveMode: boolean;
  private readonly liveInitialProfiles: LiveProfile[];
  private liveProfiles: LiveProfile[];
  private liveFeed: Array<{ userName: string; content: string; result: string; tone: 'ok' | 'warn' | 'info' }> = [];
  private liveGiftPower = 0;
  private elapsed = 0;
  private matchTime = this.getMatchDuration();
  private cameraYaw = Math.PI;
  private cameraPitch = 0.36;
  private lastStatsAt = 0;
  private kills = 0;
  private difficulty: Difficulty;
  private audioCtx?: AudioContext;
  private spectatorMode = false;
  private spectatorYaw = 0;
  private spectatorPitch = 1.08;
  private spectatorDistance = 32;
  private cameraShake = 0;
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly collisionPoint = new THREE.Vector3();
  private readonly spectatorFocus = new THREE.Vector3();
  private readonly spectatorTarget = new THREE.Vector3();
  private spectatorRadius = 18;
  private spectatorInitialized = false;
  private readonly projectileGeometries: Record<'small' | 'large' | 'tailSmall' | 'tailLarge', THREE.BufferGeometry>;
  private readonly projectileMaterials: Record<Team, THREE.MeshToonMaterial>;
  private readonly tailMaterials: Record<Team, THREE.MeshBasicMaterial>;
  private lastAISoundAt = -Infinity;
  private playerShotCount = 0;
  private playerLastShotPellets = 0;

  constructor(private canvas: HTMLCanvasElement, private save: SaveData, private callbacks: GameCallbacks, liveProfiles: LiveProfile[] = [], private liveRoom?: { roomCode: string; connected: boolean; viewers: number; profiles: LiveProfile[] }, private liveEvents?: LiveEventSource) {
    this.liveMode = Boolean(liveRoom);

    this.liveInitialProfiles = liveProfiles;
    this.liveProfiles = liveProfiles.map(profile => ({ ...profile }));
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: save.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, save.quality === 'high' ? 1.6 : save.quality === 'medium' ? 1.25 : 1));
    this.renderer.shadowMap.enabled = save.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.input = new InputController(canvas, save.joystickMode);
    this.arena = createArena(this.scene, this.liveMode ? 'custom' : save.arena, this.liveMode ? { ...save.customMode, worldSize: 72, teamSize: 1, teamCount: 4, blocks: [] } : save.customMode);
    this.obstacles = this.arena.obstacles;
    this.paintables = this.arena.paintables;
    this.walkables = this.arena.walkables;
    this.scene.updateMatrixWorld(true);
    this.obstacleBoxes = this.obstacles.map(object => new THREE.Box3().setFromObject(object));
    this.surfaceSplatTexture = this.createSurfaceSplatTexture();
    this.decalMaterials = Object.fromEntries(TEAM_ORDER.map(team => [team, new THREE.MeshPhysicalMaterial({ color: TEAM_COLORS[team].main, alphaMap: this.surfaceSplatTexture, transparent: true, alphaTest: 0.08, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false })])) as Record<Team, THREE.MeshPhysicalMaterial>;
    this.paint = new PaintField(this.scene, this.arena.worldSize);
    this.projectileGeometries = {
      small: new THREE.SphereGeometry(0.14, 7, 5),
      large: new THREE.SphereGeometry(0.25, 8, 6),
      tailSmall: new THREE.SphereGeometry(0.1, 5, 4),
      tailLarge: new THREE.SphereGeometry(0.18, 6, 4)
    };
    this.projectileMaterials = Object.fromEntries(TEAM_ORDER.map(team => [team, new THREE.MeshToonMaterial({ color: TEAM_COLORS[team].main, emissive: TEAM_COLORS[team].dark, emissiveIntensity: 0.4 })])) as Record<Team, THREE.MeshToonMaterial>;
    this.tailMaterials = Object.fromEntries(TEAM_ORDER.map(team => [team, new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team].main, transparent: true, opacity: 0.34, depthWrite: false })])) as Record<Team, THREE.MeshBasicMaterial>;
    this.difficulty = save.difficulty;
    this.createTeams();
    this.liveEvents?.subscribeEvents(event => this.handleLiveEvent(event));
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  bindMobileControls(root: HTMLElement) { this.input.bindMobileControls(root); }

  private handleLiveEvent(event: LiveEvent) {
    if (!this.liveMode) return;
    const profileIndex = this.liveProfiles.findIndex(profile => profile.userId === event.profile.userId);
    if (profileIndex >= 0) this.liveProfiles[profileIndex] = { ...event.profile };
    else if (event.type === 'join') {
      this.liveProfiles.push({ ...event.profile });
      this.addLiveViewer(event.profile);
    }
    if (event.type === 'gift') {
      this.liveGiftPower += event.power;
      const fighter = this.fighters.find(item => item.liveUserId === event.profile.userId);
      if (fighter) fighter.livePower += event.power;
      this.liveFeed.unshift({ userName: event.profile.userName, content: '礼物', result: `强化 +${event.power}`, tone: 'ok' });
      this.liveFeed.splice(10);
      return;
    }
    const fighter = this.fighters.find(item => item.liveUserId === event.profile.userId);
    if (!fighter) return;
    if (event.type === 'profile') {
      const weapon = WEAPONS.find(item => item.id === event.profile.weapon);
      if (weapon) fighter.weapon = weapon;
    }
  }

  private addLiveViewer(profile: LiveProfile) {
    const team = profile.team ?? 'cyan';
    const anchor = this.arena.spawns[team]?.[0]?.clone() ?? new THREE.Vector3();
    const offset = this.fighters.filter(fighter => fighter.team === team).length * 0.8;
    anchor.x = THREE.MathUtils.clamp(anchor.x + offset, -this.arena.worldSize * 0.5 + 2, this.arena.worldSize * 0.5 - 2);
    anchor.z = THREE.MathUtils.clamp(anchor.z + offset * 0.35, -this.arena.worldSize * 0.5 + 2, this.arena.worldSize * 0.5 - 2);
    const weapon = WEAPONS.find(item => item.id === profile.weapon) ?? WEAPONS[0];
    const outfit = OUTFITS.find(item => item.id === profile.outfit) ?? OUTFITS[0];
    const hair = (profile.hairstyle as HairstyleId | undefined) ?? HAIRSTYLES[0].id;
    const fighter = createFighter(this.fighters.length, team, false, weapon, anchor, outfit, hair, profile.userName, profile.userId);
    fighter.livePower = profile.giftPower;
    this.fighters.push(fighter);
    this.scene.add(fighter.group);
    this.paint.paint(anchor.x, anchor.z, 1.8, team, 1, 'spawn');
  }

  setSpectatorMode(enabled: boolean) {
    this.spectatorMode = enabled;
    if (enabled) {
      this.player.isPlayer = false;
      this.player.aiMode = 'paint';
      this.player.thinkCooldown = 0;
    }
  }

  start() {
    this.paint.reset();
    this.elapsed = 0; this.matchTime = this.getMatchDuration(); this.kills = 0; this.ending = false;
    this.arena.teams.forEach(team => { this.endingCoverage[team] = 0; });
    this.playerShotCount = 0; this.playerLastShotPellets = 0;
    this.projectiles.forEach(p => { this.scene.remove(p.mesh); p.tail.forEach(t => this.scene.remove(t)); }); this.projectiles = [];
    this.waterBombs.forEach(bomb => { this.scene.remove(bomb.mesh); bomb.mesh.geometry.dispose(); (bomb.mesh.material as THREE.Material).dispose(); }); this.waterBombs = [];
    this.effects.forEach(e => this.scene.remove(e.group)); this.effects = [];
      for (const f of this.fighters) { f.swim = false; f.swimLevel = 0; f.surfaceClimbing = false; f.surfaceNormal.set(0, 1, 0); }
    this.surfaceDecals.forEach(decal => { this.scene.remove(decal); decal.geometry.dispose(); });
    this.surfaceDecals = [];
    this.surfaceInk = [];
    for (const f of this.fighters) {
      f.group.position.copy(f.spawn); f.health = 100; f.ammo = 100; f.alive = true; f.group.visible = true; f.score = 0; f.spawnPulse = 1; f.recoil = 0;
      f.verticalVelocity = 0; f.grounded = true; f.previousGrounded = true; f.landingPulse = 0;
      f.aiMode = 'paint'; f.thinkCooldown = 0; f.aiCommitUntil = 0; f.aiLastProductivePaintAt = 0;
      f.aiNextPaintShotAt = 0.12 + Math.random() * 0.28; f.aiPaintShots = 0; f.aiFightShots = 0; f.aiProductivePaintCells = 0;
      f.aiStuckTime = 0; f.aiLastPosX = f.spawn.x; f.aiLastPosZ = f.spawn.z; f.aiSteerBias = 0; f.aiSteerUntil = 0;
      f.aiJumpCooldown = 0.35 + Math.random() * 0.45; f.aiJumpCount = 0;
      f.lastDamagedAt = -Infinity; f.inkStain = 0; f.inkStainTeam = null; f.rollerHitCooldown = 0; f.surfaceClimbing = false; f.surfaceNormal.set(0, 1, 0);
      f.lastRollerPaintX = f.spawn.x; f.lastRollerPaintZ = f.spawn.z;
      resetFighterPose(f);
      if (f.isPlayer) f.group.rotation.y = this.cameraYaw + Math.PI;
      this.paint.paint(f.spawn.x, f.spawn.z, 2.4, f.team, 1, 'spawn');
    }
    this.running = true; this.paused = false; this.lastTime = performance.now(); this.cameraShake = 0;
    requestAnimationFrame(this.loop);
  }

  setPaused(v: boolean) { this.paused = v; }
  get isPaused() { return this.paused; }
  get isRunning() { return this.running; }

  getDebugState() {
    return {
      playerYaw: this.player.group.rotation.y,
      playerTilt: this.player.group.rotation.z,
      cameraYaw: this.cameraYaw,
      cameraPitch: this.cameraPitch,
      positionX: this.player.group.position.x,
      positionY: this.player.group.position.y,
      positionZ: this.player.group.position.z,
      firing: this.input.state.firing,
      submergeHeld: this.input.state.submerge,
      playerSubmerged: this.player.swim,
      playerSurfaceClimbing: this.player.surfaceClimbing,
      playerDisplayName: this.player.group.userData.displayName,
      playerLivePower: this.player.livePower,
      playerSurfaceNormal: { x: this.player.surfaceNormal.x, y: this.player.surfaceNormal.y, z: this.player.surfaceNormal.z },
      moveX: this.input.state.moveX,
      moveY: this.input.state.moveY,
      spectatorMode: this.spectatorMode,
      ending: this.ending,
      endingElapsed: this.endingElapsed,
      endingCoverageReady: this.endingCoverageReady,
      cameraY: this.camera.position.y,
      spectatorPitch: this.spectatorPitch,
      fighterCount: this.fighters.length,
      teamSize: this.arena.teamSize,
      worldSize: this.arena.worldSize,
      activeAI: this.fighters.filter(f => !f.isPlayer).length,
      aiPositions: this.fighters.filter(f => !f.isPlayer).map(f => ({ id: f.id, x: f.group.position.x, y: f.group.position.y, z: f.group.position.z, health: f.health, stain: f.inkStain, stainTeam: f.inkStainTeam, grounded: f.grounded, mode: f.aiMode, colliding: f.grounded && this.collides(f.group.position.x, f.group.position.z, f.group.position.y, 0.12) })),
      aiCollisionViolations: this.fighters.filter(f => !f.isPlayer && f.grounded && this.collides(f.group.position.x, f.group.position.z, f.group.position.y, 0.12)).length,
      coverage: this.paint.coverage(),
      teams: this.arena.teams,
      rules: this.arena.id === 'custom' ? this.save.customMode.rules : undefined,
      matchTime: this.matchTime,
      fighterNames: this.fighters.map(f => f.group.userData.displayName ?? null),
      liveMode: this.liveMode,
      liveRoom: this.liveRoom ? { roomCode: this.liveRoom.roomCode, connected: this.liveRoom.connected, viewers: this.liveRoom.viewers } : undefined,
      liveFeed: this.liveFeed,
      liveGiftPower: this.liveGiftPower,
      liveViewerCount: this.liveProfiles.length,
      liveProfiles: this.liveProfiles.map(profile => ({ userId: profile.userId, userName: profile.userName, team: profile.team, giftPower: profile.giftPower })),
      aiModes: this.fighters.filter(f => !f.isPlayer).reduce((modes, fighter) => {
        modes[fighter.aiMode]++;
        return modes;
      }, { paint: 0, fight: 0, retreat: 0 }),
      aiPaintShots: this.fighters.reduce((sum, fighter) => sum + fighter.aiPaintShots, 0),
      aiFightShots: this.fighters.reduce((sum, fighter) => sum + fighter.aiFightShots, 0),
      aiJumpCount: this.fighters.reduce((sum, fighter) => sum + fighter.aiJumpCount, 0),
      aiSubmergedCount: this.fighters.filter(fighter => !fighter.isPlayer && fighter.swim).length,
      aiAverageAmmo: this.fighters.filter(fighter => !fighter.isPlayer).reduce((sum, fighter, _, ai) => sum + fighter.ammo / Math.max(1, ai.length), 0),
      stainedFighters: this.fighters.filter(fighter => fighter.inkStain > 0.05).map(fighter => ({ id: fighter.id, team: fighter.inkStainTeam, amount: fighter.inkStain })),
      playerLastDamagedAt: this.player.lastDamagedAt,
      aiProductivePaintCells: this.fighters.reduce((sum, fighter) => sum + fighter.aiProductivePaintCells, 0),
      projectiles: this.projectiles.length,
      waterBombs: this.waterBombs.length,
      surfaceInk: this.surfaceInk.length,
      projectileSnapshot: this.projectiles.map(projectile => ({
        ownerId: projectile.owner.id,
        weapon: projectile.weapon.id,
        intent: projectile.intent,
        velocityX: projectile.velocity.x,
        velocityY: projectile.velocity.y,
        velocityZ: projectile.velocity.z,
        tailCount: projectile.tail.length
      })),
      playerWeapon: this.player.weapon.id,
      playerHealth: this.player.health,
      playerAmmo: this.player.ammo,
      playerShotCount: this.playerShotCount,
      playerLastShotPellets: this.playerLastShotPellets,
      playerAmmoSpent: this.playerShotCount > 0 ? this.player.weapon.ammoCost * this.playerShotCount : 0,
      effects: this.effects.length,
      surfaceDecals: this.surfaceDecals.length,
      arena: this.arena.id,
      renderer: this.renderer.info.render
    };
  }

  debugRespawnPlayer() {
    if (location.hostname === 'localhost') this.respawn(this.player);
  }

  debugSetPlayerAmmo(ammo: number) {
    if (location.hostname !== 'localhost') return false;
    this.player.ammo = THREE.MathUtils.clamp(ammo, 0, 100);
    return true;
  }

  debugPaintUnderPlayer(team: Team | null) {
    if (location.hostname !== 'localhost' || !team) return false;
    this.paint.paint(this.player.group.position.x, this.player.group.position.z, 2.2, team, 1, 'spawn');
    return true;
  }

  debugFinishMatch() {
    if (location.hostname === 'localhost') this.matchTime = 0;
  }

  debugSetPlayerHealth(health: number) {
    if (location.hostname !== 'localhost') return false;
    this.player.health = THREE.MathUtils.clamp(health, 1, 100);
    return true;
  }

  debugSetPlayerLastDamaged(secondsAgo: number) {
    if (location.hostname !== 'localhost') return false;
    this.player.lastDamagedAt = this.elapsed - Math.max(0, secondsAgo);
    return true;
  }

  debugThrowWaterBomb() {
    if (location.hostname !== 'localhost') return false;
    return this.throwWaterBomb(this.player, this.aimDirection());
  }

  debugFirePlayer() {
    if (location.hostname !== 'localhost' || !this.player.alive) return false;
    this.player.fireCooldown = 0;
    this.tryFire(this.player, this.aimDirection());
    return true;
  }

  debugPrepareWallClimb() {
    if (location.hostname !== 'localhost') return false;
    const candidate = this.obstacleBoxes
      .map((box, index) => ({ box, object: this.obstacles[index] }))
      .filter(item => item.box.max.y > 2.4 && item.box.getSize(this.scratchA).x > 4)
      .sort((a, b) => a.box.min.x - b.box.min.x)[0];
    if (!candidate) return false;
    const box = candidate.box;
    const wallX = box.min.x;
    const y = Math.min(box.max.y - 1, Math.max(1.4, box.min.y + 1.8));
    const z = THREE.MathUtils.clamp(box.getCenter(this.scratchA).z, box.min.z + 1, box.max.z - 1);
    const origin = new THREE.Vector3(wallX - 4, y, z);
    this.surfaceRaycaster.set(origin, new THREE.Vector3(1, 0, 0));
    this.surfaceRaycaster.far = 8;
    const hit = this.surfaceRaycaster.intersectObjects(this.paintables, false)[0];
    if (!hit) return false;
    this.paintSurfaceHit(hit, this.player.team, 3.4, 'burst');
    const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    this.player.group.position.copy(hit.point).addScaledVector(normal, BODY_RADIUS + 0.05);
    this.player.group.position.y = y;
    this.player.velocity.set(0, 0, 0);
    this.player.verticalVelocity = 0;
    this.player.grounded = false;
    this.player.surfaceNormal.copy(normal);
    this.player.surfacePoint.copy(hit.point);
    return true;
  }

  dispose() {
    this.running = false;
    window.removeEventListener('resize', this.resize);
    this.input.dispose();
    this.paint.dispose();
    this.surfaceDecals.forEach(decal => { this.scene.remove(decal); decal.geometry.dispose(); });
    this.surfaceSplatTexture.dispose();
    Object.values(this.decalMaterials).forEach(material => material.dispose());
    Object.values(this.projectileGeometries).forEach(geometry => geometry.dispose());
    Object.values(this.projectileMaterials).forEach(material => material.dispose());
    Object.values(this.tailMaterials).forEach(material => material.dispose());
    this.renderer.dispose();
  }

  private createTeams() {
    const weapon = WEAPONS.find(w => w.id === this.save.weapon) ?? WEAPONS[0];
    const outfit = OUTFITS.find(o => o.id === this.save.outfit) ?? OUTFITS[0];
    const teamSize = this.liveMode ? 1 : this.arena.teamSize;
    const teams = this.liveMode ? TEAM_ORDER.slice(0, 4) : this.arena.teams.length ? this.arena.teams : ['cyan', 'orange'] as Team[];
    let fighterId = 0;
    for (let teamIndex = 0; teamIndex < teams.length; teamIndex++) {
      const team = teams[teamIndex];
      const spawns = this.arena.spawns[team] ?? [];
      for (let member = 0; member < teamSize; member++) {
        const spawn = spawns[member] ?? new THREE.Vector3(Math.cos(teamIndex / teams.length * Math.PI * 2) * 24, 0, Math.sin(teamIndex / teams.length * Math.PI * 2) * 24);
        const liveProfile = this.liveMode ? this.liveInitialProfiles.find(profile => profile.team === team) : undefined;
        const isPlayer = teamIndex === 0 && member === 0;
        const liveWeapon = liveProfile ? WEAPONS.find(item => item.id === liveProfile.weapon) ?? weapon : weapon;
        const liveOutfit = liveProfile ? OUTFITS.find(item => item.id === liveProfile.outfit) ?? outfit : outfit;
        const liveHair: HairstyleId = (liveProfile?.hairstyle as HairstyleId | undefined) ?? this.save.hairstyle;
        const fighter = createFighter(fighterId++, team, isPlayer, liveProfile ? liveWeapon : isPlayer ? weapon : WEAPONS[(fighterId + 1) % WEAPONS.length], spawn, liveProfile ? liveOutfit : isPlayer ? outfit : OUTFITS[fighterId % OUTFITS.length], liveProfile ? liveHair : isPlayer ? this.save.hairstyle : HAIRSTYLES[fighterId % HAIRSTYLES.length].id, liveProfile?.userName, liveProfile?.userId);
        if (liveProfile) fighter.livePower = liveProfile.giftPower;
        this.fighters.push(fighter); this.scene.add(fighter.group);
        if (isPlayer) this.player = fighter;
      }
    }
  }

  private loop = (now: number) => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.034, (now - this.lastTime) / 1000 || 0.016);
    this.lastTime = now;
    if (!this.paused) this.update(dt, now / 1000);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number, time: number) {
    this.elapsed += dt;
    if (this.ending) { this.updateEnding(dt); return; }
    this.matchTime -= dt;
    if (this.matchTime <= 0) { this.finish(); return; }
    this.input.update();
    if (this.spectatorMode) this.updateSpectatorInput();
    else this.updatePlayer(dt);
    for (const fighter of this.fighters) {
      if (!fighter.isPlayer) this.updateAI(fighter, dt);
      this.updateFighterCommon(fighter, dt, time);
    }
    this.updateProjectiles(dt);
    this.updateWaterBombs(dt);
    this.updateEffects(dt);
    this.paint.flushTexture(time);
    this.updateCamera(dt);
    if (this.elapsed - this.lastStatsAt > 0.12) { this.lastStatsAt = this.elapsed; this.emitStats(); }
  }

  private updateSpectatorInput() {
    const look = this.input.consumeLook();
    this.spectatorYaw -= look.x * 0.0016 * this.save.sensitivity;
    this.spectatorPitch = THREE.MathUtils.clamp(this.spectatorPitch - look.y * 0.0014 * this.save.sensitivity, 0.72, 1.38);
    const maxDistance = this.arena.worldSize > 50 ? 68 : 42;
    this.spectatorDistance = THREE.MathUtils.clamp(this.spectatorDistance - this.input.state.moveY * 0.18, 23, maxDistance);
  }

  private updatePlayer(dt: number) {
    if (!this.player.alive) return;
    const look = this.input.consumeLook();
    this.cameraYaw -= look.x * 0.0022 * this.save.sensitivity;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch - look.y * 0.0018 * this.save.sensitivity, 0.12, 0.78);
    const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const desired = forward.multiplyScalar(this.input.state.moveY).add(right.multiplyScalar(this.input.state.moveX));
    const wantsSubmerge = this.input.state.submerge && this.customRule('allowSubmerge');
    const groundOwn = this.paint.teamAt(this.player.group.position.x, this.player.group.position.z) === this.player.team;
    const surfaceInk = this.findSurfaceInk(this.player, this.player.team);
    const surfaceOwn = Boolean(surfaceInk);
    const canSubmerge = wantsSubmerge && (groundOwn || surfaceOwn) && (this.player.grounded || surfaceOwn);
    this.player.swim = canSubmerge;
    this.player.surfaceClimbing = Boolean(canSubmerge && surfaceInk && Math.abs(surfaceInk.normal.y) < 0.72);
    if (surfaceInk) {
      this.player.surfaceNormal.copy(surfaceInk.normal);
      this.player.surfacePoint.copy(surfaceInk.point);
    }
    const facingYaw = this.cameraYaw + Math.PI;
    if (!this.player.surfaceClimbing) this.player.group.rotation.set(0, facingYaw, 0);
    const weaponSpeed = this.player.weapon.speedScale ?? 1;
    const speed = (canSubmerge ? 10.1 : groundOwn || surfaceOwn ? 7.15 : 6.3) * weaponSpeed;
    if (this.player.surfaceClimbing && surfaceInk) {
      this.moveFighterOnSurface(this.player, dt, surfaceInk, speed);
    } else {
      if (desired.lengthSq() > 0.01) {
        desired.normalize().multiplyScalar(speed);
        this.player.velocity.lerp(desired, 1 - Math.pow(0.001, dt));
      } else this.player.velocity.lerp(new THREE.Vector3(0, this.player.velocity.y, 0), 1 - Math.pow(0.02, dt));
      if (this.input.consumeJump() && this.player.grounded && this.customRule('allowJump')) {
        this.player.verticalVelocity = 8.6;
        this.player.grounded = false;
        this.player.previousGrounded = false;
        this.spawnJumpBurst(this.player.group.position, this.player.team);
        this.playTone(440, 0.08, 0.035);
      }
      this.moveFighter(this.player, dt);
    }
    if (this.input.consumeWaterBomb() && this.customRule('allowSpecialWeapons')) this.throwWaterBomb(this.player, this.aimDirection());
    const firePressed = this.input.consumeFirePress();
    if (!canSubmerge && this.input.state.firing && (this.player.weapon.automatic || firePressed)) {
      this.tryFire(this.player, this.aimDirection());
    }
  }

  private updateAI(f: Fighter, dt: number) {
    if (!f.alive) return;
    const now = this.elapsed;
    f.thinkCooldown -= dt;
    f.aiJumpCooldown = Math.max(0, f.aiJumpCooldown - dt);
    let enemy = this.closestEnemyInRadius(f, f.weapon.id === 'charger' ? 30 : 15);
    let enemyDistanceSq = enemy ? enemy.group.position.distanceToSquared(f.group.position) : Infinity;
    const onOwnPaint = this.paint.teamAt(f.group.position.x, f.group.position.z) === f.team || Boolean(this.findSurfaceInk(f, f.team));
    const enemyClose = enemyDistanceSq < 6.5 * 6.5;
    // AI submerges to refill at low ammo and uses allied ink lanes for fast rotations when combat is not immediate.
    const wantsRefill = f.ammo < 46;
    const wantsFastTravel = f.aiMode !== 'fight' && f.ammo < 88 && this.scratchC.subVectors(f.aiTarget, f.group.position).setY(0).lengthSq() > 28;
    f.swim = f.grounded && onOwnPaint && !enemyClose && (wantsRefill || wantsFastTravel);

    if (f.thinkCooldown <= 0) {
      const reaction = this.difficulty === 'expert' ? 0.22 : this.difficulty === 'standard' ? 0.38 : 0.58;
      f.thinkCooldown = reaction + Math.random() * reaction * 0.55;
      enemy = this.closestEnemyInRadius(f, 15);
      enemyDistanceSq = enemy ? enemy.group.position.distanceToSquared(f.group.position) : Infinity;
      const paintStarved = now - f.aiLastProductivePaintAt > 3.1;
      const enterFightDistance = f.weapon.id === 'roller' || f.weapon.id === 'brush' ? 5.4
        : f.weapon.id === 'bucket' || f.weapon.id === 'umbrella' ? 7.5
        : f.weapon.id === 'charger' ? 12
        : 8.5;
      const exitFightDistance = enterFightDistance + 3.4;
      const canContinueFight = f.aiMode === 'fight' && now < f.aiCommitUntil && enemyDistanceSq < exitFightDistance * exitFightDistance;
      const shouldEnterFight = enemy && enemyDistanceSq < enterFightDistance * enterFightDistance && !paintStarved;

      if (f.health < 31 || f.ammo < 24) {
        f.aiMode = 'retreat';
        f.aiCommitUntil = now + 0.9;
        if (onOwnPaint && f.ammo < 58) f.aiTarget.copy(f.group.position).addScaledVector(this.scratchC.set(Math.sin(f.group.rotation.y), 0, Math.cos(f.group.rotation.y)), 5);
        else f.aiTarget.copy(f.spawn).lerp(f.group.position, 0.2);
      } else if (canContinueFight || shouldEnterFight) {
        f.aiMode = 'fight';
        f.aiCommitUntil = Math.max(f.aiCommitUntil, now + 1.25 + Math.random() * 0.65);
        if (enemy) f.aiTarget.copy(enemy.group.position);
      } else {
        f.aiMode = 'paint';
        f.aiCommitUntil = now + 1 + Math.random() * 0.7;
        this.paint.findTarget(f.team, f.group.position, f.aiTarget);
      }
    }

    if (f.aiMode === 'fight' && enemy) f.aiTarget.copy(enemy.group.position);
    this.scratchA.subVectors(f.aiTarget, f.group.position).setY(0);
    const targetDistanceSq = this.scratchA.lengthSq();
    if (targetDistanceSq < 2.5 && f.aiMode !== 'fight') f.thinkCooldown = 0;
    if (targetDistanceSq > 0.1) {
      const moved = Math.hypot(f.group.position.x - f.aiLastPosX, f.group.position.z - f.aiLastPosZ);
      f.aiLastPosX = f.group.position.x;
      f.aiLastPosZ = f.group.position.z;
      f.aiStuckTime = moved < 0.045 && f.aiMode !== 'fight' ? f.aiStuckTime + dt : 0;
      if (f.aiStuckTime > 0.65) {
        f.thinkCooldown = 0;
        f.aiStuckTime = 0;
        f.aiSteerBias = Math.random() < 0.5 ? -1 : 1;
        f.aiSteerUntil = now + 0.9 + Math.random() * 0.7;
        this.triggerAIJump(f, 8.2);
      }

      // Probe both body height and the floor ahead. A low wall or upward ledge is a deliberate jump cue.
      const heading = Math.atan2(this.scratchA.x, this.scratchA.z);
      const probeAngle = heading + (now < f.aiSteerUntil ? f.aiSteerBias * 0.85 : 0);
      const probeX = f.group.position.x + Math.sin(probeAngle) * 1.35;
      const probeZ = f.group.position.z + Math.cos(probeAngle) * 1.35;
      const blockedAhead = this.collides(probeX, probeZ, f.group.position.y);
      const floorAhead = this.groundHeightAt(this.scratchC.set(probeX, f.group.position.y + 1.4, probeZ));
      const riseAhead = floorAhead - f.group.position.y;
      const jumpableLedge = riseAhead > 0.32 && riseAhead < 1.45;
      if (blockedAhead && now >= f.aiSteerUntil) {
        f.aiSteerBias = Math.random() < 0.5 ? -1 : 1;
        f.aiSteerUntil = now + 0.8 + Math.random() * 0.6;
      }
      const clearsAtJumpHeight = !this.collides(probeX, probeZ, f.group.position.y + 1.05);
      if ((jumpableLedge || (blockedAhead && clearsAtJumpHeight)) && f.grounded) this.triggerAIJump(f, 8.5);

      const travelAngle = blockedAhead && !clearsAtJumpHeight ? probeAngle : heading;
      const baseSpeed = f.aiMode === 'retreat' ? 7.7 : f.aiMode === 'paint' ? 6.15 : 5.35 + (this.difficulty === 'expert' ? 0.75 : 0);
      const giftBoost = this.liveMode ? Math.min(0.35, f.livePower * 0.004) : 0;
      const speed = (f.swim ? Math.max(10, baseSpeed * (1.45 + giftBoost)) : baseSpeed * (1 + giftBoost)) * (f.weapon.speedScale ?? 1);
      this.scratchB.set(Math.sin(travelAngle), 0, Math.cos(travelAngle)).multiplyScalar(speed);
      f.velocity.lerp(this.scratchB, 1 - Math.pow(0.01, dt));
      f.group.rotation.y = Math.atan2(f.velocity.x, f.velocity.z);
      this.moveFighter(f, dt);
    }

    // Paint while climbing ramps and running along elevated routes, not only at the target.
    if (f.grounded && f.group.position.y > 0.6 && now >= f.aiNextPaintShotAt - 0.1 && f.aiMode === 'paint') {
      const spread = f.weapon.range * 0.22;
      this.scratchA.set(f.group.position.x + Math.sin(f.group.rotation.y) * spread, 0.05, f.group.position.z + Math.cos(f.group.rotation.y) * spread);
      this.scratchB.copy(f.group.position).setY(f.group.position.y + 1.05);
      const direction = this.scratchA.sub(this.scratchB).normalize();
      this.tryFire(f, direction, 'paint');
    }

    const combatRange = f.weapon.id === 'charger' ? Math.min(f.weapon.range, 28) : Math.min(f.weapon.range, 13);
    if (f.aiMode === 'fight' && enemy && enemyDistanceSq < combatRange ** 2 && !f.swim) {
      this.scratchA.copy(enemy.group.position).setY(enemy.group.position.y + 1);
      this.scratchB.copy(f.group.position).setY(f.group.position.y + 1.05);
      const direction = this.scratchA.sub(this.scratchB).normalize();
      const error = this.difficulty === 'expert' ? 0.025 : this.difficulty === 'standard' ? 0.075 : 0.15;
      direction.x += (Math.random() - 0.5) * error;
      direction.z += (Math.random() - 0.5) * error;
      f.group.rotation.y = Math.atan2(direction.x, direction.z);
      this.tryFire(f, direction.normalize(), 'fight');
    } else if (f.aiMode === 'paint' && now >= f.aiNextPaintShotAt && !f.swim) {
      f.aiNextPaintShotAt = now + Math.max(f.weapon.fireRate, 0.2) + 0.08 + Math.random() * 0.18;
      this.scratchA.copy(f.aiTarget).setY(0.04);
      this.scratchB.copy(f.group.position).setY(1.05);
      const direction = this.scratchA.sub(this.scratchB).normalize();
      f.group.rotation.y = Math.atan2(direction.x, direction.z);
      this.tryFire(f, direction, 'paint');
    }
  }

  private updateFighterCommon(f: Fighter, dt: number, time: number) {
    f.fireCooldown -= dt;
    f.rollerHitCooldown = Math.max(0, f.rollerHitCooldown - dt);
    if (!f.alive) {
      if (time >= f.respawnAt && this.customRule('allowRespawn')) this.respawn(f);
      return;
    }
    const paintHere = this.paint.teamAt(f.group.position.x, f.group.position.z);
    const ownGroundPaint = paintHere === f.team;
    const ownSurfacePaint = Boolean(this.findSurfaceInk(f, f.team));
    const ownPaint = ownGroundPaint || ownSurfacePaint;
    const speed = f.velocity.length();
    // Ground, platform tops, ramps and vertical faces all use the same allied-ink rule.
    if (!ownPaint || (!f.grounded && !f.surfaceClimbing)) f.swim = false;
    if (this.save.infiniteHealth && f.isPlayer) f.health = 100;
    if (this.save.infiniteInk && f.isPlayer) f.ammo = 100;
    if (f.swim) f.ammo = Math.min(100, f.ammo + dt * 46);
    const outOfCombat = this.elapsed - f.lastDamagedAt >= 3;
    if (f.swim && ownPaint && outOfCombat) f.health = Math.min(100, f.health + dt * 20);
    else if (ownPaint) f.health = Math.min(100, f.health + dt * 4);
    else if (paintHere && !(f.isPlayer && this.save.infiniteHealth)) {
      if (this.customRule('allowDamage')) f.health = Math.max(10, f.health - dt * 11);
      f.lastDamagedAt = this.elapsed;
      f.inkStain = Math.max(f.inkStain, 0.35);
      f.inkStainTeam = paintHere;
    }
    if (f.swim && Math.random() < dt * 8) this.spawnGroundRing(f.group.position, f.team, 0.34, 1.15, 0.3);
    animateFighter(f, time, speed, dt);
  }

  private triggerAIJump(f: Fighter, strength: number) {
    if (!this.customRule('allowJump') || !f.grounded || f.aiJumpCooldown > 0) return false;
    f.verticalVelocity = strength;
    f.grounded = false;
    f.previousGrounded = false;
    f.aiJumpCooldown = 0.8;
    f.aiJumpCount++;
    this.spawnJumpBurst(f.group.position, f.team);
    return true;
  }

  private moveFighter(f: Fighter, dt: number) {
    f.previousGrounded = f.grounded;
    const groundY = this.groundHeightAt(f.group.position);
    if (!f.grounded || f.verticalVelocity > 0) {
      f.verticalVelocity -= 22 * dt;
      f.group.position.y += f.verticalVelocity * dt;
      if (f.group.position.y <= groundY) {
        f.group.position.y = groundY;
        f.verticalVelocity = 0;
        f.grounded = true;
        if (!f.previousGrounded) {
          f.landingPulse = 1;
          this.spawnLandingBurst(f.group.position, f.team);
        }
      } else {
        f.grounded = false;
      }
    }

    const next = f.group.position.clone().addScaledVector(new THREE.Vector3(f.velocity.x, 0, f.velocity.z), dt);
    const worldSize = this.arena.worldSize;
    next.x = THREE.MathUtils.clamp(next.x, -worldSize / 2 + 1, worldSize / 2 - 1);
    next.z = THREE.MathUtils.clamp(next.z, -worldSize / 2 + 1, worldSize / 2 - 1);
    const feetY = f.group.position.y;
    if (!this.collides(next.x, next.z, feetY)) f.group.position.set(next.x, f.group.position.y, next.z);
    else {
      const currentX = f.group.position.x;
      const currentZ = f.group.position.z;
      if (!this.collides(next.x, currentZ, feetY)) f.group.position.x = next.x;
      else if (!this.collides(currentX, next.z, feetY)) f.group.position.z = next.z;
      else {
        f.velocity.multiplyScalar(-0.08);
        if (!f.isPlayer && f.grounded && Math.random() < 0.16) {
          f.verticalVelocity = 7.6;
          f.grounded = false;
        }
      }
    }
    const movedGroundY = this.groundHeightAt(this.scratchC.copy(f.group.position).setY(f.group.position.y + 0.5));
    this.snapToWalkableSurface(f, dt, movedGroundY);
    const trail = f.weapon.trailPaint;
    if (trail && f.velocity.lengthSq() > trail * trail && f.grounded) {
      const dx = f.group.position.x - f.lastRollerPaintX;
      const dz = f.group.position.z - f.lastRollerPaintZ;
      if (dx * dx + dz * dz > 0.16) {
        const radius = f.weapon.id === 'brush' ? 0.95 : 1.35;
        const strength = f.weapon.id === 'brush' ? 0.7 : 0.85;
        this.paint.paint(f.group.position.x, f.group.position.z, radius, f.team, strength, 'roller', f.velocity.x, f.velocity.z);
        if (f.weapon.id === 'roller') this.applyRollerContactDamage(f, radius);
        f.lastRollerPaintX = f.group.position.x;
        f.lastRollerPaintZ = f.group.position.z;
      }
    }
  }

  private applyRollerContactDamage(owner: Fighter, paintRadius: number) {
    if (owner.rollerHitCooldown > 0) return;
    const damageRadius = paintRadius;
    for (const target of this.fighters) {
      if (!target.alive || target.team === owner.team) continue;
      const dx = target.group.position.x - owner.group.position.x;
      const dz = target.group.position.z - owner.group.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > damageRadius) continue;
      const falloff = 1 - distance / damageRadius;
      const damage = Math.round(26 + falloff * 34);
      if (this.customRule('allowDamage') && !(target.isPlayer && this.save.infiniteHealth)) target.health -= damage;
      target.lastDamagedAt = this.elapsed;
      target.inkStain = Math.max(target.inkStain, 0.7 + falloff * 0.3);
      target.inkStainTeam = owner.team;
      target.hitFlash = 0.25;
      target.velocity.add(this.scratchA.set(dx, 0, dz).normalize().multiplyScalar(4.5 + falloff * 2));
      const eliminated = target.health <= 0;
      this.spawnHitBurst(target.group.position.clone().add(new THREE.Vector3(0, 0.9, 0)), owner.team, this.scratchA, eliminated);
      if (owner.isPlayer) this.callbacks.onHit(damage, eliminated);
      if (eliminated) this.eliminate(target, owner);
      owner.rollerHitCooldown = 0.45;
      break;
    }
  }

  private findSurfaceInk(fighter: Fighter, team: Team) {
    let best: SurfaceInkSample | null = null;
    let bestScore = Infinity;
    for (const sample of this.surfaceInk) {
      if (sample.team !== team) continue;
      const toFighter = this.scratchA.subVectors(fighter.group.position, sample.point);
      const planeDistance = Math.abs(toFighter.dot(sample.normal));
      const tangentDistanceSq = Math.max(0, toFighter.lengthSq() - planeDistance * planeDistance);
      const reach = sample.radius * 1.08 + 0.5;
      if (planeDistance > 1.15 || tangentDistanceSq > reach * reach) continue;
      const score = planeDistance * planeDistance + tangentDistanceSq * 0.18;
      if (score < bestScore) {
        bestScore = score;
        best = sample;
      }
    }
    return best;
  }

  private moveFighterOnSurface(fighter: Fighter, dt: number, sample: SurfaceInkSample, speed: number) {
    const normal = sample.normal;
    const wallRight = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    if (wallRight.lengthSq() < 0.01) wallRight.set(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const wallUp = new THREE.Vector3().copy(normal).cross(wallRight).normalize();
    const tangentMove = new THREE.Vector3().copy(wallRight).multiplyScalar(this.input.state.moveX)
      .addScaledVector(wallUp, this.input.state.moveY);
    if (tangentMove.lengthSq() > 0.01) tangentMove.normalize().multiplyScalar(speed);
    fighter.velocity.lerp(tangentMove, 1 - Math.pow(0.001, dt));
    const offset = BODY_RADIUS + 0.07;
    const planeDistance = new THREE.Vector3().subVectors(fighter.group.position, sample.point).dot(normal);
    fighter.group.position.addScaledVector(normal, offset - planeDistance);
    fighter.group.position.addScaledVector(fighter.velocity, dt);
    fighter.verticalVelocity = 0;
    fighter.grounded = false;
    fighter.surfaceNormal.copy(normal);
    fighter.surfacePoint.copy(sample.point);
    const facing = wallUp.clone().multiplyScalar(Math.sign(this.input.state.moveY || 1));
    fighter.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(wallRight, normal, facing));
    if (this.input.consumeJump()) {
      fighter.surfaceClimbing = false;
      fighter.swim = false;
      fighter.group.rotation.set(0, this.cameraYaw + Math.PI, 0);
      fighter.group.position.addScaledVector(normal, 0.35);
      fighter.velocity.copy(normal).multiplyScalar(6.4);
      fighter.verticalVelocity = 4.8;
    }
  }

  /** Highest explicitly walkable surface under the fighter; decorations and pipes never become terrain. */
  private groundHeightAt(position: THREE.Vector3) {
    this.surfaceRaycaster.set(this.scratchA.copy(position).setY(position.y + 1.8), this.scratchB.set(0, -1, 0));
    this.surfaceRaycaster.far = 10;
    const hit = this.surfaceRaycaster.intersectObjects(this.walkables, false)[0];
    return hit ? hit.point.y : 0;
  }

  private snapToWalkableSurface(f: Fighter, dt: number, groundY: number) {
    if (!f.grounded || f.verticalVelocity > 0.1) return;
    const delta = groundY - f.group.position.y;
    if (delta > 0.02 && delta <= 1.15) {
      f.group.position.y = THREE.MathUtils.lerp(f.group.position.y, groundY, 1 - Math.pow(0.0001, dt));
    } else if (delta < -0.02 && delta > -3) {
      f.group.position.y = Math.max(groundY, f.group.position.y - 9 * dt);
      if (f.group.position.y <= groundY + 0.02) { f.group.position.y = groundY; f.grounded = true; }
    } else if (delta > 1.15) {
      // A surface above step height is not traversable without a real jump.
      f.grounded = false;
    }
  }

  /** Height-aware collision: blocks the body cylinder but lets fighters stand on top of geometry. */
  private collides(x: number, z: number, feetY: number, radius = BODY_RADIUS) {
    const topY = feetY + 1.62;
    for (const box of this.obstacleBoxes) {
      const standingOnTop = feetY >= box.max.y - 0.12 && feetY <= box.max.y + 0.42;
      if (standingOnTop || topY <= box.min.y + 0.06 || feetY >= box.max.y + 0.42) continue;
      if (x + radius <= box.min.x || x - radius >= box.max.x) continue;
      if (z + radius <= box.min.z || z - radius >= box.max.z) continue;
      return true;
    }
    return false;
  }

  private tryFire(f: Fighter, direction: THREE.Vector3, intent: 'paint' | 'fight' = 'fight') {
    const w = f.weapon;
    const infiniteInk = f.isPlayer && this.save.infiniteInk;
    if (f.fireCooldown > 0 || (!infiniteInk && f.ammo < w.ammoCost) || !f.alive) return;
    f.fireCooldown = w.fireRate;
    if (!infiniteInk) f.ammo -= w.ammoCost;
    f.recoil = 1;
    f.aimPitch = THREE.MathUtils.clamp(-Math.asin(direction.y), -0.65, 0.75);
    if (!f.isPlayer) {
      if (intent === 'paint') f.aiPaintShots++;
      else f.aiFightShots++;
    }
    const pellets = w.pellets ?? 1;
    if (f.isPlayer) {
      this.playerShotCount++;
      this.playerLastShotPellets = pellets;
    }
    const scale = w.projectileScale ?? 1;
    const muzzle = f.group.position.clone().add(new THREE.Vector3(0, 1.15, 0)).addScaledVector(direction, 0.82);
    this.spawnMuzzleFlash(muzzle, f.team, direction, w.id === 'roller' ? 1.3 : scale);
    for (let i = 0; i < pellets; i++) {
      const dir = direction.clone();
      const angularOffset = pellets > 1 ? (i / (pellets - 1) - 0.5) * w.spread * 3.2 : 0;
      dir.x += (Math.random() - 0.5) * w.spread + Math.cos(direction.y) * angularOffset * 0.6;
      dir.y += (Math.random() - 0.5) * w.spread * 0.45;
      dir.z += (Math.random() - 0.5) * w.spread + angularOffset * 0.6;
      dir.normalize();
      const mesh = new THREE.Mesh(
        scale > 1.2 ? this.projectileGeometries.large : this.projectileGeometries.small,
        this.projectileMaterials[f.team]
      );
      mesh.scale.set(0.72 * scale, 0.72 * scale, (w.id === 'charger' ? 3.2 : w.id === 'roller' ? 1.25 : 1.8) * scale);
      mesh.position.copy(f.group.position).add(new THREE.Vector3(0, 1.15, 0)).addScaledVector(dir, 0.75);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.scene.add(mesh);
      // Two lightweight blobs are enough to read the projectile direction.
      const tail: THREE.Mesh[] = [];
      const tailCount = this.save.quality === 'high' ? 2 : this.save.quality === 'medium' ? 1 : 0;
      for (let t = 0; t < tailCount; t++) {
        const tailMesh = new THREE.Mesh(
          scale > 1.2 ? this.projectileGeometries.tailLarge : this.projectileGeometries.tailSmall,
          this.tailMaterials[f.team]
        );
        tailMesh.scale.setScalar(1 - t * 0.22);
        tailMesh.position.copy(mesh.position);
        this.scene.add(tailMesh);
        tail.push(tailMesh);
      }
      this.projectiles.push({
        mesh,
        velocity: dir.multiplyScalar(w.projectileSpeed),
        owner: f,
        life: w.range / w.projectileSpeed,
        weapon: w,
        previousPosition: mesh.position.clone(),
        tail,
        intent
      });
    }
    if (f.isPlayer || this.elapsed - this.lastAISoundAt > 0.075) {
      this.playTone(f.team === 'cyan' ? 320 : 240, 0.035, 0.028);
      if (!f.isPlayer) this.lastAISoundAt = this.elapsed;
    }
  }

  private throwWaterBomb(owner: Fighter, aim: THREE.Vector3) {
    const infiniteInk = owner.isPlayer && this.save.infiniteInk;
    if (!owner.alive || owner.swim || (!infiniteInk && owner.ammo < 50)) return false;
    if (!infiniteInk) owner.ammo -= 50;
    owner.recoil = 1;
    const material = new THREE.MeshPhysicalMaterial({
      color: TEAM_COLORS[owner.team].main,
      roughness: 0.06,
      transmission: 0.18,
      transparent: true,
      opacity: 0.92,
      clearcoat: 1,
      clearcoatRoughness: 0.03
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), material);
    mesh.scale.set(1, 1.12, 1);
    mesh.position.copy(owner.group.position).add(new THREE.Vector3(0, 1.25, 0));
    const forward = aim.clone().normalize();
    const horizontal = new THREE.Vector3(forward.x, 0, forward.z).normalize();
    mesh.position.addScaledVector(horizontal, 0.65);
    this.scene.add(mesh);
    this.waterBombs.push({
      mesh,
      velocity: horizontal.multiplyScalar(16).add(new THREE.Vector3(0, 9.4 + forward.y * 4, 0)),
      owner,
      life: 2.8,
      previousPosition: mesh.position.clone()
    });
    this.spawnMuzzleFlash(mesh.position, owner.team, aim, 1.4);
    this.playTone(owner.team === 'cyan' ? 260 : 210, 0.09, 0.055);
    return true;
  }

  private updateWaterBombs(dt: number) {
    for (let i = this.waterBombs.length - 1; i >= 0; i--) {
      const bomb = this.waterBombs[i];
      bomb.life -= dt;
      bomb.velocity.y -= 18 * dt;
      bomb.previousPosition.copy(bomb.mesh.position);
      bomb.mesh.position.addScaledVector(bomb.velocity, dt);
      bomb.mesh.rotation.x += dt * 6;
      bomb.mesh.rotation.z += dt * 8;
      const pos = bomb.mesh.position;
      let surfaceHit: THREE.Intersection<THREE.Object3D> | undefined;
      const travel = this.scratchA.subVectors(pos, bomb.previousPosition);
      if (travel.lengthSq() > 0.0001) {
        const travelLength = travel.length();
        this.surfaceRaycaster.set(bomb.previousPosition, travel.multiplyScalar(1 / travelLength));
        this.surfaceRaycaster.far = travelLength;
        surfaceHit = this.surfaceRaycaster.intersectObjects(this.paintables, false)[0];
      }
      const groundY = this.groundHeightAt(pos);
      const worldHalf = this.arena.worldSize * 0.5;
      const detonate = Boolean(surfaceHit) || bomb.life <= 0 || pos.y <= groundY + 0.2 || Math.abs(pos.x) > worldHalf || Math.abs(pos.z) > worldHalf;
      if (!detonate) continue;
      if (surfaceHit) pos.copy(surfaceHit.point); else pos.y = Math.max(groundY + 0.06, 0.06);
      this.explodeWaterBomb(bomb, surfaceHit);
      this.scene.remove(bomb.mesh);
      bomb.mesh.geometry.dispose();
      (bomb.mesh.material as THREE.Material).dispose();
      this.waterBombs.splice(i, 1);
    }
  }

  private explodeWaterBomb(bomb: WaterBomb, surfaceHit?: THREE.Intersection<THREE.Object3D>) {
    const position = bomb.mesh.position;
    const radius = 5.1;
    if (surfaceHit) this.paintSurfaceHit(surfaceHit, bomb.owner.team, radius * 0.78, 'burst');
    this.paintExplosionOnNearbySurfaces(position, bomb.owner.team, radius * 0.78, surfaceHit?.object);
    this.paint.paintImpact(position.x, position.z, radius, bomb.owner.team, bomb.velocity.x, bomb.velocity.z, 0.18, 'burst');
    this.spawnPaintSplash(position, bomb.owner.team, 1.75);
    this.spawnGroundRing(position, bomb.owner.team, 0.55, 6.3, 0.52);
    for (const fighter of this.fighters) {
      if (!fighter.alive || fighter.team === bomb.owner.team) continue;
      const dx = fighter.group.position.x - position.x;
      const dz = fighter.group.position.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      const falloff = 1 - distance / radius;
      const damage = Math.round(24 + falloff * 46);
      if (this.customRule('allowDamage') && !(fighter.isPlayer && this.save.infiniteHealth)) fighter.health -= damage;
      fighter.lastDamagedAt = this.elapsed;
      fighter.inkStain = Math.max(fighter.inkStain, 0.72 + falloff * 0.28);
      fighter.inkStainTeam = bomb.owner.team;
      fighter.hitFlash = 0.3;
      fighter.velocity.add(this.scratchA.set(dx, 0, dz).normalize().multiplyScalar(4 + falloff * 3));
      const eliminated = fighter.health <= 0;
      this.spawnHitBurst(fighter.group.position.clone().add(new THREE.Vector3(0, 1, 0)), bomb.owner.team, this.scratchA, eliminated);
      if (bomb.owner.isPlayer) this.callbacks.onHit(damage, eliminated);
      if (eliminated) this.eliminate(fighter, bomb.owner);
    }
    bomb.owner.score += 18;
    if (bomb.owner.isPlayer) this.cameraShake = Math.max(this.cameraShake, 0.42);
    this.playTone(92, 0.18, 0.085);
  }

  private paintExplosionOnNearbySurfaces(position: THREE.Vector3, team: Team, radius: number, skip?: THREE.Object3D) {
    const directions = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
    ];
    for (const direction of directions) {
      this.surfaceRaycaster.set(position, direction);
      this.surfaceRaycaster.far = radius * 0.72;
      const hit = this.surfaceRaycaster.intersectObjects(this.paintables, false).find(item => item.object !== skip);
      if (hit) this.paintSurfaceHit(hit, team, radius * 0.42, 'burst');
    }
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.weapon.arcing) p.velocity.y -= 12 * dt;
      p.previousPosition.copy(p.mesh.position);
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.z += dt * 8;
      p.tail.forEach((tailMesh, ti) => {
        const delay = 0.018 + ti * 0.025;
        tailMesh.position.copy(p.mesh.position).addScaledVector(p.velocity, -delay);
        tailMesh.quaternion.copy(p.mesh.quaternion);
      });
      const pos = p.mesh.position;
      this.scratchA.subVectors(pos, p.previousPosition);
      const travelDistance = this.scratchA.length();
      let surfaceHit: THREE.Intersection<THREE.Object3D> | undefined;
      if (travelDistance > 0.001) {
        this.surfaceRaycaster.set(p.previousPosition, this.scratchA.multiplyScalar(1 / travelDistance));
        this.surfaceRaycaster.far = travelDistance;
        surfaceHit = this.surfaceRaycaster.intersectObjects(this.paintables, false)[0];
      }
      const worldHalf = this.arena.worldSize * 0.5;
      let remove = Boolean(surfaceHit) || p.life <= 0 || pos.y <= 0.12 || Math.abs(pos.x) > worldHalf || Math.abs(pos.z) > worldHalf;
      if (surfaceHit) pos.copy(surfaceHit.point);
      for (const f of this.fighters) {
        if (f.team === p.owner.team || !f.alive || f.id === p.owner.id) continue;
        const dx = f.group.position.x - pos.x;
        const dy = f.group.position.y + 1 - pos.y;
        const dz = f.group.position.z - pos.z;
        if (dx * dx + dy * dy + dz * dz < 0.7396) {
          const damage = p.weapon.damage;
          if (this.customRule('allowDamage') && !(f.isPlayer && this.save.infiniteHealth)) f.health -= damage;
          f.lastDamagedAt = this.elapsed;
          f.inkStain = 1;
          f.inkStainTeam = p.owner.team;
          f.hitFlash = 0.24;
          f.velocity.add(p.velocity.clone().setY(0).normalize().multiplyScalar(p.weapon.id === 'roller' ? 4.4 : 2.1));
          remove = true;
          this.paint.paint(pos.x, pos.z, p.weapon.paintRadius * 0.7, p.owner.team, 1, p.weapon.id, p.velocity.x, p.velocity.z);
          const eliminated = f.health <= 0;
          this.spawnHitBurst(pos, p.owner.team, p.velocity, eliminated);
          if (p.owner.isPlayer) this.callbacks.onHit(damage, eliminated);
          if (f.isPlayer) { this.playTone(105, 0.12, 0.07); this.cameraShake = Math.max(this.cameraShake, 0.32); }
          if (eliminated) this.eliminate(f, p.owner);
          break;
        }
      }
      if (remove) {
        const radius = p.weapon.paintRadius * (p.weapon.id === 'burst' ? 1.25 : 1);
        if (surfaceHit) this.paintSurfaceHit(surfaceHit, p.owner.team, radius, p.weapon.id);
        // Fast hits leave a directional streak splat instead of a round dot.
        const speed = p.velocity.length();
        const stretch = THREE.MathUtils.clamp((speed - 14) / 30, 0, 0.55);
        const changedCells = this.paint.paintImpact(pos.x, pos.z, radius, p.owner.team, p.velocity.x, p.velocity.z, stretch, p.weapon.id);
        if (p.intent === 'paint' && !p.owner.isPlayer && changedCells > 0) {
          p.owner.aiProductivePaintCells += changedCells;
          p.owner.aiLastProductivePaintAt = this.elapsed;
        }
        if (this.save.quality === 'high' || p.weapon.id === 'burst' || p.weapon.id === 'bucket') {
          this.spawnPaintSplash(pos, p.owner.team, radius * 0.4);
        }
        p.owner.score += Math.round(radius * 3);
        this.disposeProjectile(i);
      }
    }
  }

  private disposeProjectile(index: number) {
    const p = this.projectiles[index];
    this.scene.remove(p.mesh);
    p.tail.forEach(t => this.scene.remove(t));
    this.projectiles.splice(index, 1);
  }

  private createSurfaceSplatTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const lobes = 18;
    for (let i = 0; i <= lobes; i++) {
      const angle = i / lobes * Math.PI * 2;
      const radius = 45 + Math.sin(angle * 7) * 8 + Math.sin(angle * 11 + 0.8) * 5;
      const x = 64 + Math.cos(angle) * radius;
      const y = 64 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    for (const [x, y, r] of [[18, 34, 6], [109, 43, 8], [96, 106, 5], [29, 104, 7]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  private paintSurfaceHit(hit: THREE.Intersection<THREE.Object3D>, team: Team, radius: number, weaponId: WeaponSpec['id']) {
    if (!(hit.object instanceof THREE.Mesh) || !hit.face) return;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const position = hit.point.clone().addScaledVector(normal, 0.012);
    this.decalOrientation.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal));
    const stretch = weaponId === 'roller' || weaponId === 'brush' ? 1.55 : weaponId === 'charger' ? 2.2 : weaponId === 'bucket' || weaponId === 'umbrella' ? 1.25 : weaponId === 'burst' ? 1.38 : 1;
    this.decalSize.set(radius * 2 * stretch, radius * 2, radius * 0.9);
    try {
      const geometry = new DecalGeometry(hit.object, position, this.decalOrientation, this.decalSize);
      const decal = new THREE.Mesh(geometry, this.decalMaterials[team]);
      decal.renderOrder = 6;
      decal.userData.team = team;
      this.scene.add(decal);
      this.surfaceDecals.push(decal);
      this.surfaceInk = this.surfaceInk.filter(sample => {
        if (sample.team === team) return true;
        const samePlane = sample.normal.dot(normal) > 0.82;
        return !samePlane || sample.point.distanceToSquared(position) > (sample.radius + radius) ** 2 * 0.38;
      });
      this.surfaceInk.push({ point: position.clone(), normal: normal.clone(), team, radius });
      if (this.surfaceInk.length > 220) this.surfaceInk.shift();
      const maxDecals = this.save.quality === 'high' ? 260 : this.save.quality === 'medium' ? 170 : 90;
      if (this.surfaceDecals.length > maxDecals) {
        const oldest = this.surfaceDecals.shift()!;
        this.scene.remove(oldest);
        oldest.geometry.dispose();
      }
    } catch { /* extremely small or degenerate meshes can reject decals */ }
  }

  private updateEffects(dt: number) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.life -= dt;
      effect.update(effect, dt);
      if (effect.life <= 0) {
        this.scene.remove(effect.group);
        effect.group.traverse(object => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(material => material.dispose());
          }
        });
        this.effects.splice(i, 1);
      }
    }
  }

  private addEffect(group: THREE.Group, life: number, update: CombatEffect['update']) {
    this.scene.add(group);
    this.effects.push({ group, life, maxLife: life, update });
  }

  private spawnMuzzleFlash(position: THREE.Vector3, team: Team, direction: THREE.Vector3, scale = 1) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
    const color = TEAM_COLORS[team].light;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 * scale, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
    );
    core.scale.z = 1.8;
    group.add(core);
    for (let i = 0; i < 5; i++) {
      const ray = new THREE.Mesh(
        new THREE.ConeGeometry(0.065 * scale, 0.6 * scale, 5),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
      );
      ray.rotation.x = Math.PI / 2;
      ray.rotation.z = i / 5 * Math.PI * 2;
      ray.position.z = 0.26 * scale;
      group.add(ray);
    }
    this.addEffect(group, 0.11, effect => {
      const t = 1 - effect.life / effect.maxLife;
      effect.group.scale.setScalar(1 + t * 1.8);
      effect.group.traverse(object => {
        if (object instanceof THREE.Mesh) (object.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      });
    });
  }

  private spawnHitBurst(position: THREE.Vector3, team: Team, direction: THREE.Vector3, eliminated: boolean) {
    const group = new THREE.Group();
    group.position.copy(position);
    const color = TEAM_COLORS[team].light;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(eliminated ? 0.45 : 0.28, 0.055, 6, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
    );
    ring.lookAt(this.camera.position);
    group.add(ring);
    const normal = direction.clone().normalize();
    for (let i = 0; i < (eliminated ? 12 : 7); i++) {
      const shard = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.07 + Math.random() * 0.09),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xffffff : color, transparent: true, opacity: 1 })
      );
      shard.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 6 + normal.x * 2,
        (Math.random() - 0.25) * 5,
        (Math.random() - 0.5) * 6 + normal.z * 2
      );
      group.add(shard);
    }
    this.addEffect(group, eliminated ? 0.55 : 0.32, (effect, dt) => {
      const t = 1 - effect.life / effect.maxLife;
      ring.scale.setScalar(1 + t * (eliminated ? 3.8 : 2.3));
      (ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      effect.group.children.slice(1).forEach(object => {
        const shard = object as THREE.Mesh;
        const velocity = shard.userData.velocity as THREE.Vector3;
        velocity.y -= 12 * dt;
        shard.position.addScaledVector(velocity, dt);
        shard.rotation.x += dt * 12;
        shard.rotation.y += dt * 9;
        (shard.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      });
    });
  }

  private spawnPaintSplash(position: THREE.Vector3, team: Team, scale: number) {
    const group = new THREE.Group();
    group.position.copy(position).setY(Math.max(0.1, position.y));
    const color = TEAM_COLORS[team].main;
    for (let i = 0; i < 7; i++) {
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry((0.08 + Math.random() * 0.09) * scale, 7, 5),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 })
      );
      drop.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 4, 1.2 + Math.random() * 3.5, (Math.random() - 0.5) * 4);
      group.add(drop);
    }
    this.addEffect(group, 0.45, (effect, dt) => {
      const t = 1 - effect.life / effect.maxLife;
      effect.group.children.forEach(object => {
        const drop = object as THREE.Mesh;
        const velocity = drop.userData.velocity as THREE.Vector3;
        velocity.y -= 11 * dt;
        drop.position.addScaledVector(velocity, dt);
        drop.scale.setScalar(Math.max(0.15, 1 - t * 0.75));
        (drop.material as THREE.MeshBasicMaterial).opacity = 0.88 * (1 - t);
      });
    });
  }

  private spawnJumpBurst(position: THREE.Vector3, team: Team) {
    this.spawnGroundRing(position, team, 0.42, 1.9, 0.28);
  }

  private spawnLandingBurst(position: THREE.Vector3, team: Team) {
    this.spawnGroundRing(position, team, 0.58, 2.8, 0.38);
    this.spawnPaintSplash(position.clone().setY(0.12), team, 0.55);
  }

  private spawnGroundRing(position: THREE.Vector3, team: Team, radius: number, growth: number, life: number) {
    const group = new THREE.Group();
    group.position.copy(position).setY(0.08);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius, radius + 0.09, 28),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team].light, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    this.addEffect(group, life, effect => {
      const t = 1 - effect.life / effect.maxLife;
      ring.scale.setScalar(1 + t * growth);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.72 * (1 - t);
    });
  }

  private eliminate(victim: Fighter, attacker: Fighter) {
    if (!this.customRule('allowDamage')) return;
    victim.alive = false; victim.group.visible = false; victim.health = 0; victim.respawnAt = performance.now() / 1000 + 3;
    attacker.score += 100;
    if (attacker.isPlayer) this.kills++;
    // Splatted fighters burst into one big radial paint explosion on the ground.
    const pos = victim.group.position;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 0.6 + Math.random() * 1.4;
      this.paint.paintImpact(
        pos.x + Math.cos(a) * dist,
        pos.z + Math.sin(a) * dist,
        1.5 + Math.random() * 1.1,
        attacker.team,
        Math.cos(a),
        Math.sin(a),
        0.35,
        'elimination'
      );
    }
    this.spawnPaintSplash(pos.clone().setY(0.8), attacker.team, 1.25);
    this.spawnGroundRing(pos, attacker.team, 0.55, 4.2, 0.5);
    this.playTone(attacker.isPlayer ? 540 : 400, 0.16, 0.07);
  }

  private respawn(f: Fighter) {
    f.alive = true; f.group.visible = true; f.health = 100; f.ammo = 100; f.group.position.copy(f.spawn); f.velocity.set(0, 0, 0); f.spawnPulse = 1;
    f.verticalVelocity = 0; f.grounded = true; f.previousGrounded = true; f.landingPulse = 0;
    f.lastDamagedAt = -Infinity; f.rollerHitCooldown = 0;
    f.aiJumpCooldown = 0.5;
    resetFighterPose(f);
    if (f.isPlayer) f.group.rotation.y = this.cameraYaw + Math.PI;
    this.paint.paint(f.spawn.x, f.spawn.z, 2.2, f.team, 1, 'spawn');
    this.spawnGroundRing(f.spawn, f.team, 0.7, 3.3, 0.65);
  }

  private aimDirection() {
    const target = new THREE.Vector3();
    this.camera.getWorldDirection(target);
    return target.normalize();
  }

  private closestEnemyInRadius(f: Fighter, radius: number) {
    let best: Fighter | null = null;
    let bestDistanceSq = radius * radius;
    for (const other of this.fighters) {
      if (other.team === f.team || !other.alive) continue;
      const distanceSq = other.group.position.distanceToSquared(f.group.position);
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = other;
      }
    }
    return best;
  }

  private updateCamera(dt: number) {
    if (this.spectatorMode) {
      let aliveCount = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      this.spectatorTarget.set(0, 0, 0);
      for (const fighter of this.fighters) {
        if (!fighter.alive) continue;
        const position = fighter.group.position;
        this.spectatorTarget.add(position);
        minX = Math.min(minX, position.x);
        maxX = Math.max(maxX, position.x);
        minZ = Math.min(minZ, position.z);
        maxZ = Math.max(maxZ, position.z);
        aliveCount++;
      }
      if (aliveCount > 0) this.spectatorTarget.multiplyScalar(1 / aliveCount);
      this.spectatorTarget.y = 1.2;
      const targetRadius = aliveCount > 0 ? Math.max(12, Math.hypot(maxX - minX, maxZ - minZ) * 0.58) : 18;
      if (!this.spectatorInitialized) {
        this.spectatorFocus.copy(this.spectatorTarget);
        this.spectatorRadius = targetRadius;
        this.spectatorInitialized = true;
      }
      const focusBlend = 1 - Math.pow(0.12, dt);
      const radiusBlend = 1 - Math.pow(0.2, dt);
      this.spectatorFocus.lerp(this.spectatorTarget, focusBlend);
      this.spectatorRadius = THREE.MathUtils.lerp(this.spectatorRadius, targetRadius, radiusBlend);
      const maxSpectatorDistance = this.arena.worldSize > 50 ? 68 : 44;
      const fittedDistance = THREE.MathUtils.clamp(Math.max(this.spectatorDistance, this.spectatorRadius * 1.55), 26, maxSpectatorDistance);
      const horizontal = Math.cos(this.spectatorPitch) * fittedDistance;
      this.scratchA.set(
        Math.sin(this.spectatorYaw) * horizontal,
        Math.sin(this.spectatorPitch) * fittedDistance,
        Math.cos(this.spectatorYaw) * horizontal
      ).add(this.spectatorFocus);
      this.camera.position.lerp(this.scratchA, 1 - Math.pow(0.035, dt));
      this.camera.lookAt(this.spectatorFocus);
      return;
    }
    this.cameraShake = Math.max(0, this.cameraShake - dt * 2.4);
    const target = this.player.group.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    const distance = 6.5;
    const offset = new THREE.Vector3(Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch), Math.sin(this.cameraPitch), Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)).multiplyScalar(distance);
    const desired = target.clone().add(offset);
    this.camera.position.lerp(desired, 1 - Math.pow(0.0005, dt));
    // Player-hit feedback: brief camera shake.
    if (this.cameraShake > 0.001) {
      const s = this.cameraShake * 0.22;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.7;
    }
    this.camera.lookAt(target.clone().add(new THREE.Vector3(-Math.sin(this.cameraYaw) * 3.2, 0.25, -Math.cos(this.cameraYaw) * 3.2)));
  }

  private emitStats() {
    const coverage = this.paint.coverage();
    const endingTeams = this.ending ? this.endingCoverage : Object.fromEntries(this.arena.teams.map(team => [team, coverage.teams[team]?.percent ?? 0]));
    const cyanPercent = endingTeams.cyan ?? coverage.cyanPercent;
    const orangePercent = endingTeams.orange ?? coverage.orangePercent;
    this.callbacks.onStats({
      time: Math.max(0, this.matchTime), cyan: cyanPercent, orange: orangePercent,
      teams: endingTeams,
      health: this.player.health, ammo: this.player.ammo, score: this.spectatorMode ? 0 : this.player.score, weapon: this.player.weapon,
      alive: this.spectatorMode ? true : this.player.alive, respawn: this.spectatorMode || this.player.alive ? 0 : Math.max(0, this.player.respawnAt - performance.now() / 1000)
    });
  }

  private beginEnding() {
    this.ending = true;
    this.running = true;
    this.spectatorMode = true;
    this.player.isPlayer = false;
    this.player.aiMode = 'paint';
    this.player.thinkCooldown = 9999;
    this.spectatorYaw = 0.65;
    this.spectatorPitch = 1.08;
    this.spectatorDistance = Math.max(32, this.arena.worldSize * 0.58);
    this.spectatorInitialized = false;
    this.paused = false;
    this.endingStartedAt = performance.now() / 1000;
    this.lastStatsAt = 0;
    this.endingAnnounced = false;
    this.endingElapsed = 0;
    this.endingCoverageReady = false;
    this.emitStats();
  }

  private endingStartedAt = 0;
  private endingElapsed = 0;
  private endingAnnounced = false;
  private endingCoverageReady = false;

  private updateEnding(dt: number) {
    this.endingElapsed += dt;
    this.updateCamera(dt);
    const liveCoverage = this.paint.coverage();
    const progress = THREE.MathUtils.clamp((this.endingElapsed - 1.2) / 3.8, 0, 1);
    for (const team of this.arena.teams) {
      const target = liveCoverage.teams[team]?.percent ?? 0;
      this.endingCoverage[team] = target * progress;
    }
    if (this.endingElapsed - this.lastStatsAt > 0.08) {
      this.lastStatsAt = this.endingElapsed;
      this.emitStats();
    }
    if (progress >= 1 && !this.endingCoverageReady) {
      this.endingCoverageReady = true;
      this.announceFinalRanking();
    }
  }

  private announceFinalRanking() {
    if (this.endingAnnounced) return;
    this.endingAnnounced = true;
    const ranked = [...this.arena.teams].sort((a, b) => (this.endingCoverage[b] ?? 0) - (this.endingCoverage[a] ?? 0));
    const finalCoverage = Object.fromEntries(this.arena.teams.map(team => [team, this.endingCoverage[team] ?? 0]));
    const stats: GameStats & { won: boolean; kills: number; ranking: Team[] } = {
      time: 0,
      cyan: finalCoverage.cyan ?? 0,
      orange: finalCoverage.orange ?? 0,
      teams: finalCoverage,
      health: this.player.health,
      ammo: this.player.ammo,
      score: this.player.score,
      weapon: this.player.weapon,
      alive: this.player.alive,
      respawn: 0,
      won: ranked[0] === this.player.team,
      kills: this.kills,
      ranking: ranked
    };
    this.callbacks.onEnd(stats);
  }

  private finish() {
    if (!this.ending) this.beginEnding();
  }

  private playTone(freq: number, duration: number, volume: number) {
    if (this.save.sfx <= 0) return;
    try {
      this.audioCtx ??= new AudioContext();
      const osc = this.audioCtx.createOscillator(); const gain = this.audioCtx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume * this.save.sfx, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);
      osc.connect(gain); gain.connect(this.audioCtx.destination); osc.start(); osc.stop(this.audioCtx.currentTime + duration);
    } catch { /* audio is optional */ }
  }

  private customRule(key: 'allowJump' | 'allowSubmerge' | 'allowSpecialWeapons' | 'allowRespawn' | 'allowDamage' | 'turfWin') {
    return this.arena.id !== 'custom' || this.save.customMode.rules[key];
  }

  private getMatchDuration() {
    const requested = Number(new URLSearchParams(location.search).get('testMatchSeconds'));
    const base = this.liveMode ? 120 : this.arena?.id === 'custom' ? this.save.customMode.rules.matchSeconds : 150;
    return location.hostname === 'localhost' && Number.isFinite(requested) && requested > 0
      ? THREE.MathUtils.clamp(requested, 2, 300)
      : base;
  }

  private resize = () => {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false);
  };
}
