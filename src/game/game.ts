import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { ArenaBuild, createArena } from './arena';
import { Difficulty, OUTFITS, SaveData, TEAM_COLORS, Team, WEAPONS, WeaponSpec } from './config';
import { animateFighter, createFighter, Fighter, resetFighterPose } from './fighter';
import { InputController } from './input';
import { PaintField } from './paintField';

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
  private effects: CombatEffect[] = [];
  private arena: ArenaBuild;
  private obstacles: THREE.Object3D[];
  private paintables: THREE.Mesh[];
  private walkables: THREE.Object3D[];
  private obstacleBoxes: THREE.Box3[] = [];
  private surfaceDecals: THREE.Mesh[] = [];
  private readonly surfaceRaycaster = new THREE.Raycaster();
  private readonly decalOrientation = new THREE.Euler();
  private readonly decalSize = new THREE.Vector3();
  private readonly decalMaterials: Record<Team, THREE.MeshPhysicalMaterial>;
  private player!: Fighter;
  private running = false;
  private paused = false;
  private lastTime = 0;
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

  constructor(private canvas: HTMLCanvasElement, private save: SaveData, private callbacks: GameCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: save.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, save.quality === 'high' ? 1.6 : save.quality === 'medium' ? 1.25 : 1));
    this.renderer.shadowMap.enabled = save.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.input = new InputController(canvas, save.joystickMode);
    this.arena = createArena(this.scene, save.arena);
    this.obstacles = this.arena.obstacles;
    this.paintables = this.arena.paintables;
    this.walkables = this.arena.walkables;
    this.scene.updateMatrixWorld(true);
    this.obstacleBoxes = this.obstacles.map(object => new THREE.Box3().setFromObject(object));
    this.decalMaterials = {
      cyan: new THREE.MeshPhysicalMaterial({ color: TEAM_COLORS.cyan.main, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false }),
      orange: new THREE.MeshPhysicalMaterial({ color: TEAM_COLORS.orange.main, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false })
    };
    this.paint = new PaintField(this.scene, this.arena.worldSize);
    this.projectileGeometries = {
      small: new THREE.SphereGeometry(0.14, 7, 5),
      large: new THREE.SphereGeometry(0.25, 8, 6),
      tailSmall: new THREE.SphereGeometry(0.1, 5, 4),
      tailLarge: new THREE.SphereGeometry(0.18, 6, 4)
    };
    this.projectileMaterials = {
      cyan: new THREE.MeshToonMaterial({ color: TEAM_COLORS.cyan.main, emissive: TEAM_COLORS.cyan.dark, emissiveIntensity: 0.4 }),
      orange: new THREE.MeshToonMaterial({ color: TEAM_COLORS.orange.main, emissive: TEAM_COLORS.orange.dark, emissiveIntensity: 0.4 })
    };
    this.tailMaterials = {
      cyan: new THREE.MeshBasicMaterial({ color: TEAM_COLORS.cyan.main, transparent: true, opacity: 0.34, depthWrite: false }),
      orange: new THREE.MeshBasicMaterial({ color: TEAM_COLORS.orange.main, transparent: true, opacity: 0.34, depthWrite: false })
    };
    this.difficulty = save.difficulty;
    this.createTeams();
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  bindMobileControls(root: HTMLElement) { this.input.bindMobileControls(root); }

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
    this.elapsed = 0; this.matchTime = this.getMatchDuration(); this.kills = 0;
    this.playerShotCount = 0; this.playerLastShotPellets = 0;
    this.projectiles.forEach(p => { this.scene.remove(p.mesh); p.tail.forEach(t => this.scene.remove(t)); }); this.projectiles = [];
    this.effects.forEach(e => this.scene.remove(e.group)); this.effects = [];
    for (const f of this.fighters) { f.swim = false; f.swimLevel = 0; }
    this.surfaceDecals.forEach(decal => { this.scene.remove(decal); decal.geometry.dispose(); });
    this.surfaceDecals = [];
    for (const f of this.fighters) {
      f.group.position.copy(f.spawn); f.health = 100; f.ammo = 100; f.alive = true; f.group.visible = true; f.score = 0; f.spawnPulse = 1; f.recoil = 0;
      f.verticalVelocity = 0; f.grounded = true; f.previousGrounded = true; f.landingPulse = 0;
      f.aiMode = 'paint'; f.thinkCooldown = 0; f.aiCommitUntil = 0; f.aiLastProductivePaintAt = 0;
      f.aiNextPaintShotAt = 0.12 + Math.random() * 0.28; f.aiPaintShots = 0; f.aiFightShots = 0; f.aiProductivePaintCells = 0;
      f.aiStuckTime = 0; f.aiLastPosX = f.spawn.x; f.aiLastPosZ = f.spawn.z; f.aiSteerBias = 0; f.aiSteerUntil = 0;
      f.aiJumpCooldown = 0.35 + Math.random() * 0.45; f.aiJumpCount = 0;
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
      moveX: this.input.state.moveX,
      moveY: this.input.state.moveY,
      spectatorMode: this.spectatorMode,
      cameraY: this.camera.position.y,
      spectatorPitch: this.spectatorPitch,
      fighterCount: this.fighters.length,
      teamSize: this.arena.teamSize,
      worldSize: this.arena.worldSize,
      activeAI: this.fighters.filter(f => !f.isPlayer).length,
      aiPositions: this.fighters.filter(f => !f.isPlayer).map(f => ({ id: f.id, x: f.group.position.x, y: f.group.position.y, z: f.group.position.z, grounded: f.grounded, mode: f.aiMode, colliding: f.grounded && this.collides(f.group.position.x, f.group.position.z, f.group.position.y, 0.12) })),
      aiCollisionViolations: this.fighters.filter(f => !f.isPlayer && f.grounded && this.collides(f.group.position.x, f.group.position.z, f.group.position.y, 0.12)).length,
      coverage: this.paint.coverage(),
      aiModes: this.fighters.filter(f => !f.isPlayer).reduce((modes, fighter) => {
        modes[fighter.aiMode]++;
        return modes;
      }, { paint: 0, fight: 0, retreat: 0 }),
      aiPaintShots: this.fighters.reduce((sum, fighter) => sum + fighter.aiPaintShots, 0),
      aiFightShots: this.fighters.reduce((sum, fighter) => sum + fighter.aiFightShots, 0),
      aiJumpCount: this.fighters.reduce((sum, fighter) => sum + fighter.aiJumpCount, 0),
      aiSubmergedCount: this.fighters.filter(fighter => !fighter.isPlayer && fighter.swim).length,
      aiAverageAmmo: this.fighters.filter(fighter => !fighter.isPlayer).reduce((sum, fighter, _, ai) => sum + fighter.ammo / Math.max(1, ai.length), 0),
      aiProductivePaintCells: this.fighters.reduce((sum, fighter) => sum + fighter.aiProductivePaintCells, 0),
      projectiles: this.projectiles.length,
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

  debugFirePlayer() {
    if (location.hostname !== 'localhost' || !this.player.alive) return false;
    this.player.fireCooldown = 0;
    this.tryFire(this.player, this.aimDirection());
    return true;
  }

  dispose() {
    this.running = false;
    window.removeEventListener('resize', this.resize);
    this.input.dispose();
    this.paint.dispose();
    this.surfaceDecals.forEach(decal => { this.scene.remove(decal); decal.geometry.dispose(); });
    Object.values(this.decalMaterials).forEach(material => material.dispose());
    Object.values(this.projectileGeometries).forEach(geometry => geometry.dispose());
    Object.values(this.projectileMaterials).forEach(material => material.dispose());
    Object.values(this.tailMaterials).forEach(material => material.dispose());
    this.renderer.dispose();
  }

  private createTeams() {
    const weapon = WEAPONS.find(w => w.id === this.save.weapon) ?? WEAPONS[0];
    const outfit = OUTFITS.find(o => o.id === this.save.outfit) ?? OUTFITS[0];
    const cyanSpawns = this.arena.spawns.cyan;
    const orangeSpawns = this.arena.spawns.orange;
    const teamSize = this.arena.teamSize;
    this.player = createFighter(0, 'cyan', true, weapon, cyanSpawns[0], outfit.primary, outfit.accent);
    this.fighters.push(this.player); this.scene.add(this.player.group);
    for (let i = 1; i < teamSize; i++) {
      const f = createFighter(i, 'cyan', false, WEAPONS[i % WEAPONS.length], cyanSpawns[i]);
      this.fighters.push(f); this.scene.add(f.group);
    }
    for (let i = 0; i < teamSize; i++) {
      const f = createFighter(teamSize + i, 'orange', false, WEAPONS[(i + 1) % WEAPONS.length], orangeSpawns[i]);
      this.fighters.push(f); this.scene.add(f.group);
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
    const facingYaw = this.cameraYaw + Math.PI;
    this.player.group.rotation.y = facingYaw;
    const onOwn = this.paint.teamAt(this.player.group.position.x, this.player.group.position.z) === this.player.team;
    const wantsSubmerge = this.input.state.submerge;
    const canSubmerge = wantsSubmerge && onOwn && this.player.grounded;
    this.player.swim = canSubmerge;
    const weaponSpeed = this.player.weapon.speedScale ?? 1;
    const speed = (canSubmerge ? 10.1 : onOwn ? 7.15 : 6.3) * weaponSpeed;
    if (desired.lengthSq() > 0.01) {
      desired.normalize().multiplyScalar(speed);
      this.player.velocity.lerp(desired, 1 - Math.pow(0.001, dt));
    } else this.player.velocity.lerp(new THREE.Vector3(0, this.player.velocity.y, 0), 1 - Math.pow(0.02, dt));
    if (this.input.consumeJump() && this.player.grounded) {
      this.player.verticalVelocity = 8.6;
      this.player.grounded = false;
      this.player.previousGrounded = false;
      this.spawnJumpBurst(this.player.group.position, this.player.team);
      this.playTone(440, 0.08, 0.035);
    }
    this.moveFighter(this.player, dt);
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
    const onOwnPaint = this.paint.teamAt(f.group.position.x, f.group.position.z) === f.team;
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
      const speed = (f.swim ? Math.max(10, baseSpeed * 1.45) : baseSpeed) * (f.weapon.speedScale ?? 1);
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
    if (!f.alive) {
      if (time >= f.respawnAt) this.respawn(f);
      return;
    }
    const paintHere = this.paint.teamAt(f.group.position.x, f.group.position.z);
    const ownPaint = paintHere === f.team;
    const speed = f.velocity.length();
    // Submerging is explicit for the player and tactical for AI. It is the only way to refill ammo.
    if (!ownPaint || !f.grounded) f.swim = false;
    if (f.swim) f.ammo = Math.min(100, f.ammo + dt * 46);
    if (ownPaint) f.health = Math.min(100, f.health + dt * 4);
    else if (paintHere) f.health = Math.max(10, f.health - dt * 11);
    if (f.swim && Math.random() < dt * 8) this.spawnGroundRing(f.group.position, f.team, 0.34, 1.15, 0.3);
    animateFighter(f, time, speed, dt);
  }

  private triggerAIJump(f: Fighter, strength: number) {
    if (!f.grounded || f.aiJumpCooldown > 0) return false;
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
        f.lastRollerPaintX = f.group.position.x;
        f.lastRollerPaintZ = f.group.position.z;
      }
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
    if (f.fireCooldown > 0 || f.ammo < w.ammoCost || !f.alive) return;
    f.fireCooldown = w.fireRate; f.ammo -= w.ammoCost; f.recoil = 1;
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
          f.health -= damage;
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
    this.callbacks.onStats({
      time: Math.max(0, this.matchTime), cyan: coverage.cyanPercent, orange: coverage.orangePercent,
      health: this.player.health, ammo: this.player.ammo, score: this.spectatorMode ? 0 : this.player.score, weapon: this.player.weapon,
      alive: this.spectatorMode ? true : this.player.alive, respawn: this.spectatorMode || this.player.alive ? 0 : Math.max(0, this.player.respawnAt - performance.now() / 1000)
    });
  }

  private finish() {
    this.running = false;
    const c = this.paint.coverage();
    const stats: GameStats & { won: boolean; kills: number } = {
      time: 0, cyan: c.cyanPercent, orange: c.orangePercent, health: this.player.health, ammo: this.player.ammo,
      score: this.player.score, weapon: this.player.weapon, alive: this.player.alive, respawn: 0,
      won: c.cyanPercent >= c.orangePercent, kills: this.kills
    };
    this.callbacks.onEnd(stats);
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

  private getMatchDuration() {
    const requested = Number(new URLSearchParams(location.search).get('testMatchSeconds'));
    return location.hostname === 'localhost' && Number.isFinite(requested) && requested > 0
      ? THREE.MathUtils.clamp(requested, 2, 150)
      : 150;
  }

  private resize = () => {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false);
  };
}
