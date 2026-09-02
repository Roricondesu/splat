import * as THREE from 'three';
import { ArenaId, CustomModeConfig, Team, TEAM_ORDER } from './config';

const INK = 0x17303e;
const WHITE = 0xf4f8fa;
const CONCRETE = 0xb8c5cb;
const CYAN = 0x18cfc7;
const ORANGE = 0xff6b2b;
const LIME = 0xb8ee48;
const PURPLE = 0x8d78df;
const PINK = 0xec91b4;
const BLUE = 0x75b8df;
const SAND = 0xe4c982;

export interface ArenaBuild {
  id: ArenaId;
  root: THREE.Group;
  obstacles: THREE.Object3D[];
  paintables: THREE.Mesh[];
  walkables: THREE.Object3D[];
  spawns: Partial<Record<Team, THREE.Vector3[]>>;
  teams: Team[];
  worldSize: number;
  teamSize: number;
}

interface BuildContext {
  root: THREE.Group;
  obstacles: THREE.Object3D[];
  walkables: THREE.Object3D[];
}

function toon(color: number) {
  return new THREE.MeshToonMaterial({ color });
}

function glossy(color: number) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.34, clearcoat: 0.48, clearcoatRoughness: 0.22 });
}

function meshBox(width: number, height: number, depth: number, color: number, gloss = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), gloss ? glossy(color) : toon(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addObject(ctx: BuildContext, object: THREE.Object3D, options: { solid?: boolean; walkable?: boolean } = {}) {
  ctx.root.add(object);
  if (options.solid) ctx.obstacles.push(object);
  if (options.walkable) ctx.walkables.push(object);
  return object;
}

function placeBox(
  ctx: BuildContext,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
  options: { solid?: boolean; walkable?: boolean; gloss?: boolean; rotationY?: number } = {}
) {
  const object = meshBox(size[0], size[1], size[2], color, options.gloss);
  object.position.set(position[0], position[1], position[2]);
  object.rotation.y = options.rotationY ?? 0;
  return addObject(ctx, object, options);
}

function placeRamp(
  ctx: BuildContext,
  center: THREE.Vector3,
  width: number,
  length: number,
  rise: number,
  yaw: number,
  color: number
) {
  const slopeLength = Math.hypot(length, rise);
  const ramp = meshBox(width, 0.28, slopeLength, color, true);
  ramp.position.copy(center);
  ramp.position.y += rise * 0.5;
  ramp.rotation.order = 'YXZ';
  ramp.rotation.y = yaw;
  ramp.rotation.x = -Math.atan2(rise, length);
  addObject(ctx, ramp, { walkable: true });
  const rails = new THREE.Group();
  rails.position.copy(center);
  rails.position.y += rise * 0.5 + 0.48;
  rails.rotation.order = 'YXZ';
  rails.rotation.y = yaw;
  rails.rotation.x = -Math.atan2(rise, length);
  for (const x of [-width * 0.5 + 0.12, width * 0.5 - 0.12]) {
    const rail = meshBox(0.12, 0.62, slopeLength, INK);
    rail.position.x = x;
    rails.add(rail);
  }
  addObject(ctx, rails);
  return ramp;
}

function building(
  ctx: BuildContext,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  color: number,
  accent: number
) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const body = meshBox(width, height, depth, color, true);
  body.position.y = height * 0.5;
  root.add(body);
  const roof = meshBox(width + 0.35, 0.28, depth + 0.35, WHITE);
  roof.position.y = height + 0.14;
  root.add(roof);
  for (const side of [-1, 1]) {
    const band = meshBox(width * 0.62, 0.22, 0.1, accent);
    band.position.set(0, height * (side > 0 ? 0.72 : 0.4), depth * 0.5 + 0.055);
    root.add(band);
  }
  addObject(ctx, root);
  ctx.obstacles.push(body);
  ctx.walkables.push(roof);
  return root;
}

function crateStack(ctx: BuildContext, x: number, z: number, color: number, levels = 2) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  for (let y = 0; y < levels; y++) {
    const count = Math.max(1, levels - y);
    for (let i = 0; i < count; i++) {
      const box = meshBox(1.45, 1.25, 1.45, y % 2 ? WHITE : color, true);
      box.position.set((i - (count - 1) / 2) * 1.5, 0.625 + y * 1.27, 0);
      root.add(box);
    }
  }
  addObject(ctx, root);
  for (const child of root.children) ctx.obstacles.push(child);
}

function arch(ctx: BuildContext, x: number, z: number, yaw: number, color: number) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  for (const side of [-1, 1]) {
    const pillar = meshBox(0.65, 4.4, 1.15, color, true);
    pillar.position.set(side * 2.25, 2.2, 0);
    root.add(pillar);
  }
  const beam = meshBox(5.15, 0.7, 1.15, WHITE, true);
  beam.position.y = 4.05;
  root.add(beam);
  addObject(ctx, root);
  for (const child of root.children) ctx.obstacles.push(child);
}

function pipe(ctx: BuildContext, from: THREE.Vector3, to: THREE.Vector3, radius: number, color: number) {
  const direction = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 12), glossy(color));
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  addObject(ctx, mesh, { solid: true });
  return mesh;
}

function addPerimeter(ctx: BuildContext, size = 46) {
  const edge = size * 0.5 + 0.3;
  placeBox(ctx, [size, 1.6, 0.6], [0, 0.8, -edge], WHITE, { solid: true, gloss: true });
  placeBox(ctx, [size, 1.6, 0.6], [0, 0.8, edge], WHITE, { solid: true, gloss: true });
  placeBox(ctx, [0.6, 1.6, size], [-edge, 0.8, 0], WHITE, { solid: true, gloss: true });
  placeBox(ctx, [0.6, 1.6, size], [edge, 0.8, 0], WHITE, { solid: true, gloss: true });
}

function buildSkylineMarket(ctx: BuildContext) {
  const size = 72;
  addPerimeter(ctx, size);

  // White modular blocks keep the arena readable while giving every route a paintable face.
  placeBox(ctx, [18, 1.2, 18], [0, 0.6, 0], WHITE, { solid: true, walkable: true, gloss: true });
  placeBox(ctx, [10, 2.4, 10], [0, 1.8, 0], WHITE, { solid: true, walkable: true, gloss: true });
  placeRamp(ctx, new THREE.Vector3(0, 0, 12.5), 5.2, 10.5, 2.4, 0, WHITE);
  placeRamp(ctx, new THREE.Vector3(0, 2.4, -8.5), 4.4, 7.5, 2.2, Math.PI, WHITE);

  const nw = building(ctx, -20, -18, 12, 10, 4.8, WHITE, INK);
  const se = building(ctx, 20, 18, 12, 10, 4.8, WHITE, INK);
  const ne = building(ctx, 21, -18, 10, 9, 6.4, WHITE, INK);
  const sw = building(ctx, -21, 18, 10, 9, 6.4, WHITE, INK);
  nw.userData.route = 'northwest-block';
  se.userData.route = 'southeast-block';
  ne.userData.route = 'high-east';
  sw.userData.route = 'high-west';

  // Broad flank ramps, roof bridges and climbable vertical faces.
  placeRamp(ctx, new THREE.Vector3(-20, 0, -9), 5.2, 9.5, 4.8, 0, WHITE);
  placeRamp(ctx, new THREE.Vector3(20, 0, 9), 5.2, 9.5, 4.8, Math.PI, WHITE);
  placeRamp(ctx, new THREE.Vector3(10, 0, -18), 5.2, 11, 6.4, Math.PI / 2, WHITE);
  placeRamp(ctx, new THREE.Vector3(-10, 0, 18), 5.2, 11, 6.4, -Math.PI / 2, WHITE);
  placeBox(ctx, [11, 0.45, 3.2], [-9, 5.15, -10], WHITE, { walkable: true, gloss: true, rotationY: 0.25 });
  placeBox(ctx, [11, 0.45, 3.2], [9, 5.15, 10], WHITE, { walkable: true, gloss: true, rotationY: -0.25 });
  placeBox(ctx, [14, 0.45, 3.5], [0, 7.05, -22], WHITE, { walkable: true, gloss: true });
  placeBox(ctx, [14, 0.45, 3.5], [0, 7.05, 22], WHITE, { walkable: true, gloss: true });

  arch(ctx, 0, -28, 0, WHITE);
  arch(ctx, 0, 28, Math.PI, WHITE);
  crateStack(ctx, -12, 9, WHITE, 2);
  crateStack(ctx, 12, -9, WHITE, 2);
  crateStack(ctx, -29, -8, WHITE, 1);
  crateStack(ctx, 29, 8, WHITE, 1);
  for (const z of [-9, 0, 9]) pipe(ctx, new THREE.Vector3(-8, 8.2, z), new THREE.Vector3(8, 8.2, z), 0.2, INK);

  return {
    cyan: [new THREE.Vector3(-31, 0, 29), new THREE.Vector3(-27, 0, 31), new THREE.Vector3(-33, 0, 24), new THREE.Vector3(-29, 0, 25)],
    orange: [new THREE.Vector3(31, 0, -29), new THREE.Vector3(27, 0, -31), new THREE.Vector3(33, 0, -24), new THREE.Vector3(29, 0, -25)]
  };
}

function buildCanalFoundry(ctx: BuildContext) {
  const size = 72;
  addPerimeter(ctx, size);

  // A white-block canal: long banks, broad crossings and a visible central trench.
  placeBox(ctx, [22, 1.8, 58], [-20, 0.9, 0], WHITE, { solid: true, walkable: true, gloss: true });
  placeBox(ctx, [22, 1.8, 58], [20, 0.9, 0], WHITE, { solid: true, walkable: true, gloss: true });
  placeBox(ctx, [12, 0.45, 5.2], [0, 2.25, -20], WHITE, { walkable: true, gloss: true });
  placeBox(ctx, [12, 0.45, 5.2], [0, 2.25, 0], WHITE, { walkable: true, gloss: true });
  placeBox(ctx, [12, 0.45, 5.2], [0, 2.25, 20], WHITE, { walkable: true, gloss: true });
  for (const z of [-20, 0, 20]) {
    placeRamp(ctx, new THREE.Vector3(-9, 1.65, z), 5.2, 4, 0.6, Math.PI / 2, WHITE);
    placeRamp(ctx, new THREE.Vector3(9, 1.65, z), 5.2, 4, 0.6, -Math.PI / 2, WHITE);
  }

  building(ctx, -21, -19, 13, 12, 6.2, WHITE, INK);
  building(ctx, 21, 19, 13, 12, 5.2, WHITE, INK);
  building(ctx, -21, 19, 10, 10, 4, WHITE, INK);
  building(ctx, 21, -19, 10, 10, 7.2, WHITE, INK);
  placeRamp(ctx, new THREE.Vector3(-21, 1.8, -8), 5.2, 11, 4.4, 0, WHITE);
  placeRamp(ctx, new THREE.Vector3(21, 1.8, 8), 5.2, 11, 3.4, Math.PI, WHITE);
  placeRamp(ctx, new THREE.Vector3(21, 1.8, -9), 5.2, 12, 5.4, Math.PI, WHITE);

  // Elevated service decks are white, continuous and reachable from both banks.
  placeBox(ctx, [4.4, 0.45, 22], [-10, 5.9, 10], WHITE, { walkable: true, gloss: true });
  placeBox(ctx, [4.4, 0.45, 22], [10, 5.9, -10], WHITE, { walkable: true, gloss: true });
  placeBox(ctx, [18, 0.45, 3.8], [0, 5.9, 10], WHITE, { walkable: true, gloss: true });
  placeBox(ctx, [18, 0.45, 3.8], [0, 5.9, -10], WHITE, { walkable: true, gloss: true });
  for (const x of [-29, 29]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 6.2, 16), glossy(WHITE));
    tank.position.set(x, 3.1, x < 0 ? 8 : -8);
    addObject(ctx, tank, { solid: true });
  }
  pipe(ctx, new THREE.Vector3(-31, 8, -25), new THREE.Vector3(31, 8, -25), 0.42, INK);
  pipe(ctx, new THREE.Vector3(-31, 9, 25), new THREE.Vector3(31, 9, 25), 0.34, INK);
  crateStack(ctx, -12, -10, WHITE, 2);
  crateStack(ctx, 12, 10, WHITE, 2);
  crateStack(ctx, -7, 27, WHITE, 1);
  crateStack(ctx, 7, -27, WHITE, 1);
  arch(ctx, 0, -31, 0, WHITE);
  arch(ctx, 0, 31, Math.PI, WHITE);

  return {
    cyan: [new THREE.Vector3(-32, 0, 28), new THREE.Vector3(-28, 0, 30), new THREE.Vector3(-33, 0, 22), new THREE.Vector3(-28, 0, 24)],
    orange: [new THREE.Vector3(32, 0, -28), new THREE.Vector3(28, 0, -30), new THREE.Vector3(33, 0, -22), new THREE.Vector3(28, 0, -24)]
  };
}

function buildBlankExpanse(ctx: BuildContext) {
  const worldSize = 72;
  addPerimeter(ctx, worldSize + 2);

  // Deliberately empty: only a low center marker and perimeter stripes provide
  // orientation without changing pathing or blocking 20 simultaneous fighters.
  const centerRing = new THREE.Mesh(
    new THREE.RingGeometry(3.8, 4.15, 48),
    new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
  );
  centerRing.rotation.x = -Math.PI / 2;
  centerRing.position.y = 0.022;
  centerRing.userData.paintable = false;
  addObject(ctx, centerRing);

  for (const z of [-22, 0, 22]) {
    const line = meshBox(worldSize - 6, 0.025, 0.12, z === 0 ? SAND : WHITE);
    line.position.set(0, 0.012, z);
    line.userData.paintable = false;
    addObject(ctx, line);
  }

  const makeSpawns = (side: -1 | 1) => {
    const points: THREE.Vector3[] = [];
    const zRows = [-18, -9, 0, 9, 18];
    for (let row = 0; row < zRows.length; row++) {
      points.push(new THREE.Vector3(side * 29, 0, zRows[row] - 2.2));
      points.push(new THREE.Vector3(side * 25.5, 0, zRows[row] + 2.2));
    }
    return points;
  };

  return {
    cyan: makeSpawns(-1),
    orange: makeSpawns(1)
  };
}

function addWorldLighting(scene: THREE.Scene, root: THREE.Group, id: ArenaId, customMode?: CustomModeConfig) {
  const isBlank = id === 'blank-expanse';
  const customSize = id === 'custom' ? (customMode?.worldSize ?? 72) : 72;
  scene.background = new THREE.Color(isBlank ? 0xb9e4ef : 0xd4edf2);
  scene.fog = new THREE.FogExp2(isBlank ? 0xc5e9f0 : 0xdff3f4, isBlank ? 0.006 : 0.007);
  const hemi = new THREE.HemisphereLight(0xe2f5ff, 0xe6d7bd, 2.1);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe8bd, 3.15);
  sun.position.set(-18, 35, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const shadowExtent = customSize * 0.62;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.bias = -0.0004;
  root.add(sun);
  const fill = new THREE.DirectionalLight(0x83aee8, 0.75);
  fill.position.set(18, 20, -20);
  root.add(fill);

  const underlaySize = id === 'custom' ? customSize + 20 : isBlank ? 92 : 72;
  const underlay = meshBox(underlaySize, 0.18, underlaySize, id === 'skyline-market' ? CONCRETE : isBlank ? 0xd7dfe3 : 0x899ba4);
  underlay.position.y = -0.14;
  underlay.receiveShadow = true;
  scene.add(underlay);
}

function buildCustomArena(ctx: BuildContext, config: CustomModeConfig) {
  const half = config.worldSize * 0.5;
  addPerimeter(ctx, config.worldSize);
  const grid = Math.max(4, config.gridSize);
  const cell = config.worldSize / grid;
  for (const block of config.blocks) {
    const height = block.kind === 'tower' ? 6 : block.kind === 'high' ? 3.2 : 1.5;
    const width = cell * 0.84;
    placeBox(ctx, [width, height, width], [block.x, height * 0.5, block.z], WHITE, { solid: true, walkable: true, gloss: true });
  }
  const spawns: Partial<Record<Team, THREE.Vector3[]>> = {};
  const ringRadius = Math.max(half * 0.72, 8);
  for (let i = 0; i < config.teamCount; i++) {
    const team = TEAM_ORDER[i];
    const center = new THREE.Vector3(Math.cos(i / config.teamCount * Math.PI * 2) * ringRadius, 0, Math.sin(i / config.teamCount * Math.PI * 2) * ringRadius);
    const points: THREE.Vector3[] = [];
    for (let j = 0; j < config.teamSize; j++) {
      const spread = (j - (config.teamSize - 1) * 0.5) * Math.min(1.4, config.worldSize / 70);
      points.push(new THREE.Vector3(THREE.MathUtils.clamp(center.x + Math.cos(i / config.teamCount * Math.PI * 2 + Math.PI / 2) * spread, -half + 2, half - 2), 0, THREE.MathUtils.clamp(center.z + Math.sin(i / config.teamCount * Math.PI * 2 + Math.PI / 2) * spread, -half + 2, half - 2)));
    }
    spawns[team] = points;
  }
  return spawns;
}

export function createArena(scene: THREE.Scene, id: ArenaId, customMode?: CustomModeConfig): ArenaBuild {
  const root = new THREE.Group();
  root.name = `arena-${id}`;
  scene.add(root);
  addWorldLighting(scene, root, id, customMode);
  const ctx: BuildContext = { root, obstacles: [], walkables: [] };
  const isBlank = id === 'blank-expanse';
  const isCustom = id === 'custom' && Boolean(customMode);
  if (isCustom) scene.fog = new THREE.FogExp2(0xdff3f4, Math.max(0.003, 0.5 / customMode!.worldSize));
  const spawns = isCustom
    ? buildCustomArena(ctx, customMode!)
    : isBlank
      ? buildBlankExpanse(ctx)
      : id === 'canal-foundry'
        ? buildCanalFoundry(ctx)
        : buildSkylineMarket(ctx);
  root.updateMatrixWorld(true);
  const paintables: THREE.Mesh[] = [];
  root.traverse(object => {
    if (object instanceof THREE.Mesh && object.material && object.visible && object.userData.paintable !== false) {
      paintables.push(object);
    }
  });
  const teamSize = isCustom ? customMode!.teamSize : isBlank ? 10 : 4;
  const teams = isCustom ? TEAM_ORDER.slice(0, customMode!.teamCount) : ['cyan', 'orange'] as Team[];
  return {
    id,
    root,
    obstacles: ctx.obstacles,
    paintables,
    walkables: ctx.walkables,
    spawns,
    teams,
    worldSize: isCustom ? customMode!.worldSize : 72,
    teamSize
  };
}
