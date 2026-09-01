import * as THREE from 'three';
import { ArenaId, Team } from './config';

const INK = 0x17303e;
const WHITE = 0xf5f0df;
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
  spawns: Record<Team, THREE.Vector3[]>;
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
  addPerimeter(ctx);

  // A stepped central bazaar with two accessible roof levels.
  placeBox(ctx, [8.2, 2.2, 7.2], [0, 1.1, 0], SAND, { solid: true, walkable: true, gloss: true });
  placeBox(ctx, [4.8, 1.8, 4.4], [0, 3.1, 0], PINK, { solid: true, walkable: true, gloss: true });
  placeRamp(ctx, new THREE.Vector3(0, 0, 6.2), 3.2, 5.8, 2.35, 0, BLUE);
  placeRamp(ctx, new THREE.Vector3(0, 2.2, -4.3), 2.6, 3.5, 1.95, Math.PI, PURPLE);

  const nw = building(ctx, -13.3, -9, 7, 6.4, 3.4, PINK, PURPLE);
  const se = building(ctx, 13.3, 9, 7, 6.4, 3.4, BLUE, CYAN);
  const ne = building(ctx, 13.6, -10.5, 6, 5.4, 4.6, SAND, ORANGE);
  const sw = building(ctx, -13.6, 10.5, 6, 5.4, 4.6, 0x9bd7bd, CYAN);

  // Exterior ramps and roof-to-roof bridges create flanking routes.
  placeRamp(ctx, new THREE.Vector3(-13.3, 0, -3.1), 3.8, 7.4, 3.55, 0, PINK);
  placeRamp(ctx, new THREE.Vector3(13.3, 0, 3.1), 3.8, 7.4, 3.55, Math.PI, BLUE);
  placeRamp(ctx, new THREE.Vector3(8.4, 0, -10.5), 3.6, 8.2, 4.75, Math.PI / 2, SAND);
  placeRamp(ctx, new THREE.Vector3(-8.4, 0, 10.5), 3.6, 8.2, 4.75, -Math.PI / 2, 0x9bd7bd);
  placeBox(ctx, [6.2, 0.35, 2.3], [-7, 3.6, -5], WHITE, { walkable: true, gloss: true, rotationY: 0.55 });
  placeBox(ctx, [6.2, 0.35, 2.3], [7, 3.6, 5], WHITE, { walkable: true, gloss: true, rotationY: 0.55 });
  placeBox(ctx, [6.5, 0.34, 1.9], [0, 4.35, -7.5], PURPLE, { walkable: true, gloss: true });
  placeBox(ctx, [6.5, 0.34, 1.9], [0, 4.35, 7.5], CYAN, { walkable: true, gloss: true });

  arch(ctx, 0, -14.5, 0, PURPLE);
  arch(ctx, 0, 14.5, Math.PI, CYAN);
  crateStack(ctx, -8.5, 4.5, ORANGE, 2);
  crateStack(ctx, 8.5, -4.5, CYAN, 2);
  crateStack(ctx, -18, -4, PURPLE, 1);
  crateStack(ctx, 18, 4, PINK, 1);

  // Neon canopy ribs over the middle lane.
  for (const z of [-4.8, 0, 4.8]) {
    pipe(ctx, new THREE.Vector3(-5.3, 5.4, z), new THREE.Vector3(5.3, 5.4, z), 0.16, z === 0 ? LIME : INK);
  }

  // Keep referenced roots active for matrix updates and clarify deliberate symmetry.
  nw.userData.route = 'cyan-roof';
  se.userData.route = 'orange-roof';
  ne.userData.route = 'high-flank';
  sw.userData.route = 'high-flank';

  return {
    cyan: [new THREE.Vector3(-17, 0, 16), new THREE.Vector3(-14, 0, 18), new THREE.Vector3(-19, 0, 12), new THREE.Vector3(-11, 0, 14)],
    orange: [new THREE.Vector3(17, 0, -16), new THREE.Vector3(14, 0, -18), new THREE.Vector3(19, 0, -12), new THREE.Vector3(11, 0, -14)]
  };
}

function buildCanalFoundry(ctx: BuildContext) {
  addPerimeter(ctx);

  // Raised foundry banks leave a low central canal with multiple crossings.
  placeBox(ctx, [17, 1.7, 43], [-13.4, 0.85, 0], 0xaebbc1, { solid: true, walkable: true, gloss: true });
  placeBox(ctx, [17, 1.7, 43], [13.4, 0.85, 0], 0xaebbc1, { solid: true, walkable: true, gloss: true });
  for (const z of [-13, 0, 13]) {
    placeBox(ctx, [10.2, 0.38, 4.2], [0, 2.05, z], z === 0 ? ORANGE : WHITE, { walkable: true, gloss: true });
    // Short transition ramps connect the 1.7 m banks to the 2.24 m bridge deck.
    // Their high ends point toward the canal; the old ramps crossed deep into the
    // solid banks and could leave fighters grounded inside bank colliders.
    placeRamp(ctx, new THREE.Vector3(-5.9, 1.57, z), 4.1, 2, 0.54, Math.PI / 2, CYAN);
    placeRamp(ctx, new THREE.Vector3(5.9, 1.57, z), 4.1, 2, 0.54, -Math.PI / 2, ORANGE);
  }

  // Two asymmetric factories: one compact tower, one long processing hall.
  building(ctx, -14.4, -10.5, 7.2, 8, 5.1, BLUE, CYAN);
  building(ctx, 14.2, 10.2, 7.8, 9.2, 4.2, SAND, ORANGE);
  building(ctx, -14.6, 11.8, 5.6, 6.4, 3.2, PINK, PURPLE);
  building(ctx, 14.8, -12.2, 5.8, 6, 5.7, 0x9bd7bd, LIME);

  placeRamp(ctx, new THREE.Vector3(-14.2, 1.65, -3.4), 4, 8.2, 3.6, 0, BLUE);
  placeRamp(ctx, new THREE.Vector3(14.2, 1.65, 3), 4, 7.4, 2.7, Math.PI, SAND);
  placeRamp(ctx, new THREE.Vector3(14.7, 1.65, -6.8), 3.8, 8.8, 4.2, Math.PI, 0x9bd7bd);

  // Walkable overhead service lanes.
  placeBox(ctx, [3, 0.34, 16], [-8.2, 4.7, 4], CYAN, { walkable: true, gloss: true });
  placeBox(ctx, [3, 0.34, 16], [8.2, 4.7, -4], ORANGE, { walkable: true, gloss: true });
  placeBox(ctx, [13.6, 0.34, 2.5], [0, 4.7, 4], WHITE, { walkable: true, gloss: true });
  placeBox(ctx, [13.6, 0.34, 2.5], [0, 4.7, -4], WHITE, { walkable: true, gloss: true });

  // Pipes, tanks and cargo make the channels less linear.
  for (const x of [-18, 18]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 4.8, 16), glossy(x < 0 ? CYAN : ORANGE));
    tank.position.set(x, 4.1, x < 0 ? 2.5 : -2.5);
    addObject(ctx, tank, { solid: true });
  }
  pipe(ctx, new THREE.Vector3(-19, 6.6, -17), new THREE.Vector3(19, 6.6, -17), 0.38, PURPLE);
  pipe(ctx, new THREE.Vector3(-19, 7.5, 17), new THREE.Vector3(19, 7.5, 17), 0.3, LIME);
  crateStack(ctx, -6.8, -7.2, CYAN, 2);
  crateStack(ctx, 6.8, 7.2, ORANGE, 2);
  crateStack(ctx, -4.8, 15.8, PURPLE, 1);
  crateStack(ctx, 4.8, -15.8, SAND, 1);
  arch(ctx, 0, -19, 0, PURPLE);
  arch(ctx, 0, 19, Math.PI, LIME);

  return {
    cyan: [new THREE.Vector3(-8.5, 1.72, 18), new THREE.Vector3(-11, 1.72, 18), new THREE.Vector3(-8.5, 1.72, 13.5), new THREE.Vector3(-11, 1.72, 13.5)],
    orange: [new THREE.Vector3(8.5, 1.72, -18), new THREE.Vector3(11, 1.72, -18), new THREE.Vector3(8.5, 1.72, -13.5), new THREE.Vector3(11, 1.72, -13.5)]
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

function addWorldLighting(scene: THREE.Scene, root: THREE.Group, id: ArenaId) {
  const isBlank = id === 'blank-expanse';
  scene.background = new THREE.Color(id === 'skyline-market' ? 0x9ed6e8 : isBlank ? 0xb9e4ef : 0x89b9cf);
  scene.fog = new THREE.FogExp2(id === 'skyline-market' ? 0xaeddeb : isBlank ? 0xc5e9f0 : 0x9dc5d5, isBlank ? 0.006 : 0.01);
  const hemi = new THREE.HemisphereLight(0xe2f5ff, 0xe6d7bd, 2.1);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe8bd, 3.15);
  sun.position.set(-18, 35, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const shadowExtent = isBlank ? 42 : 30;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.bias = -0.0004;
  root.add(sun);
  const fill = new THREE.DirectionalLight(0x83aee8, 0.75);
  fill.position.set(18, 20, -20);
  root.add(fill);

  const underlaySize = isBlank ? 92 : 72;
  const underlay = meshBox(underlaySize, 0.18, underlaySize, id === 'skyline-market' ? CONCRETE : isBlank ? 0xd7dfe3 : 0x899ba4);
  underlay.position.y = -0.14;
  underlay.receiveShadow = true;
  scene.add(underlay);
}

export function createArena(scene: THREE.Scene, id: ArenaId): ArenaBuild {
  const root = new THREE.Group();
  root.name = `arena-${id}`;
  scene.add(root);
  addWorldLighting(scene, root, id);
  const ctx: BuildContext = { root, obstacles: [], walkables: [] };
  const isBlank = id === 'blank-expanse';
  const spawns = isBlank
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
  return {
    id,
    root,
    obstacles: ctx.obstacles,
    paintables,
    walkables: ctx.walkables,
    spawns,
    worldSize: isBlank ? 72 : 44,
    teamSize: isBlank ? 10 : 4
  };
}
