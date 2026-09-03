import * as THREE from 'three';
import { HairstyleId, OutfitSpec, Team, TEAM_COLORS, WeaponSpec } from './config';

export interface Fighter {
  id: number;
  team: Team;
  isPlayer: boolean;
  group: THREE.Group;
  velocity: THREE.Vector3;
  health: number;
  ammo: number;
  alive: boolean;
  respawnAt: number;
  spawn: THREE.Vector3;
  fireCooldown: number;
  thinkCooldown: number;
  aiTarget: THREE.Vector3;
  aiMode: 'paint' | 'fight' | 'retreat';
  weapon: WeaponSpec;
  score: number;
  hitFlash: number;
  recoil: number;
  spawnPulse: number;
  verticalVelocity: number;
  grounded: boolean;
  landingPulse: number;
  previousGrounded: boolean;
  swim: boolean;
  swimLevel: number;
  surfaceClimbing: boolean;
  surfaceNormal: THREE.Vector3;
  surfacePoint: THREE.Vector3;
  aiCommitUntil: number;
  aiLastProductivePaintAt: number;
  aiNextPaintShotAt: number;
  aiPaintShots: number;
  aiFightShots: number;
  aiProductivePaintCells: number;
  aiStuckTime: number;
  aiLastPosX: number;
  aiLastPosZ: number;
  aiSteerBias: number;
  aiSteerUntil: number;
  aiJumpCooldown: number;
  aiJumpCount: number;
  lastDamagedAt: number;
  inkStain: number;
  inkStainTeam: Team | null;
  rollerHitCooldown: number;
  aimPitch: number;
  lastRollerPaintX: number;
  lastRollerPaintZ: number;
  livePower: number;
  liveUserId?: string;
}

interface FighterRig {
  visual: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  hair: THREE.Group;
  leftEye: THREE.Group;
  rightEye: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  weapon: THREE.Group;
  backpack: THREE.Group;
  tankInk: THREE.Mesh;
  blobShadow: THREE.Mesh;
  ring: THREE.Mesh;
  inkStain: THREE.Mesh;
  nameplate?: THREE.Sprite;
}

const BASE_VISUAL_SCALE_XZ = 0.78;
const BASE_VISUAL_SCALE_Y = 1.05;
const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x18303d, side: THREE.BackSide });
const localVelocityScratch = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const toonRamp = (() => {
  const data = new Uint8Array([
    58, 62, 76,
    138, 144, 158,
    222, 226, 234,
    255, 255, 255
  ]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RGBFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  return texture;
})();

function toonMaterial(color: number) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp });
}

function glossMaterial(color: number) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.07 });
}

function createNameplate(name: string, team: Team) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 72;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgba(7, 19, 31, 0.84)';
  context.fillRect(6, 8, 308, 56);
  context.strokeStyle = `#${TEAM_COLORS[team].main.toString(16).padStart(6, '0')}`;
  context.lineWidth = 5;
  context.strokeRect(6, 8, 308, 56);
  context.font = 'bold 28px Microsoft YaHei, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#f4fbff';
  context.fillText(name.slice(0, 18), 160, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(2.05, 0.46, 1);
  sprite.position.set(0, 2.62, 0);
  sprite.renderOrder = 20;
  return sprite;
}

function outlinedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, outlineScale = 1.04) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const outline = new THREE.Mesh(geometry, outlineMaterial);
  outline.scale.setScalar(outlineScale);
  mesh.add(outline);
  return mesh;
}

function roundedBox(width: number, height: number, depth: number, material: THREE.Material) {
  const mesh = outlinedMesh(new THREE.BoxGeometry(width, height, depth, 2, 2, 2), material, 1.035);
  mesh.geometry.computeVertexNormals();
  return mesh;
}

function makeLimb(length: number, radius: number, material: THREE.Material) {
  const pivot = new THREE.Group();
  const limb = outlinedMesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
  limb.position.y = -length * 0.5;
  pivot.add(limb);
  return pivot;
}

function makeWeapon(spec: WeaponSpec, accent: THREE.Material, dark: THREE.Material, teamColor: number) {
  const root = new THREE.Group();
  const paintMat = glossMaterial(teamColor);

  if (spec.id === 'roller') {
    const handle = outlinedMesh(new THREE.CylinderGeometry(0.05, 0.065, 0.85, 8), dark);
    handle.rotation.x = Math.PI / 2.8;
    handle.position.set(0, 0.02, 0.18);
    root.add(handle);
    const roller = outlinedMesh(new THREE.CylinderGeometry(0.26, 0.26, 0.8, 12), paintMat);
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, -0.28, 0.82);
    root.add(roller);
    for (const x of [-0.44, 0.44]) {
      const cap = outlinedMesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 12), accent);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(x, -0.28, 0.82);
      root.add(cap);
    }
  } else if (spec.id === 'bucket') {
    const bowl = outlinedMesh(new THREE.CylinderGeometry(0.36, 0.27, 0.44, 12, 1, true), accent);
    bowl.position.set(0, -0.04, 0.38);
    bowl.rotation.x = -0.18;
    root.add(bowl);
    const paint = new THREE.Mesh(new THREE.CircleGeometry(0.28, 12), paintMat);
    paint.rotation.x = -Math.PI / 2 - 0.18;
    paint.position.set(0, 0.19, 0.45);
    root.add(paint);
    const handle = outlinedMesh(new THREE.TorusGeometry(0.32, 0.045, 7, 14, Math.PI), dark);
    handle.position.set(0, 0.24, 0.3);
    root.add(handle);
    const strap = roundedBox(0.5, 0.07, 0.07, dark);
    strap.position.set(0, -0.02, 0.12);
    root.add(strap);
  } else if (spec.id === 'charger') {
    const body = outlinedMesh(new THREE.CapsuleGeometry(0.14, 1.15, 4, 9), accent);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.42;
    root.add(body);
    const barrel = outlinedMesh(new THREE.CylinderGeometry(0.055, 0.07, 1.05, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 1.42;
    root.add(barrel);
    const scope = outlinedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.4), paintMat);
    scope.position.set(0, 0.2, 0.5);
    root.add(scope);
    const grip = roundedBox(0.12, 0.26, 0.12, dark);
    grip.position.set(0, -0.22, 0.24);
    grip.rotation.x = 0.28;
    root.add(grip);
  } else if (spec.id === 'scatter') {
    for (const side of [-1, 1]) {
      const barrel = outlinedMesh(new THREE.CylinderGeometry(0.1, 0.13, 0.62, 8), accent);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(side * 0.24, side * -0.05, 0.62);
      root.add(barrel);
      const muzzle = outlinedMesh(new THREE.TorusGeometry(0.11, 0.035, 6, 10), paintMat);
      muzzle.position.set(side * 0.24, side * -0.05, 0.93);
      root.add(muzzle);
      const trigger = roundedBox(0.1, 0.2, 0.1, dark);
      trigger.position.set(side * 0.24, -0.24, 0.28);
      root.add(trigger);
    }
    const spine = roundedBox(0.26, 0.14, 0.4, dark);
    spine.position.z = 0.16;
    root.add(spine);
  } else if (spec.id === 'brush') {
    const handle = outlinedMesh(new THREE.CylinderGeometry(0.055, 0.07, 0.95, 8), dark);
    handle.rotation.x = Math.PI / 1.9;
    handle.position.set(0, 0.04, 0.26);
    root.add(handle);
    const head = outlinedMesh(new THREE.BoxGeometry(0.92, 0.12, 0.3), paintMat);
    head.position.set(0, -0.3, 0.78);
    head.rotation.z = 0.12;
    root.add(head);
    const collar = outlinedMesh(new THREE.TorusGeometry(0.13, 0.045, 6, 10), accent);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 0.34, 0.46);
    root.add(collar);
  } else if (spec.id === 'umbrella') {
    const shaft = outlinedMesh(new THREE.CylinderGeometry(0.06, 0.075, 1.0, 8), dark);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.34;
    root.add(shaft);
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.56, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42),
      new THREE.MeshToonMaterial({ color: teamColor, side: THREE.DoubleSide })
    );
    canopy.rotation.x = -Math.PI / 2;
    canopy.position.z = 0.58;
    root.add(canopy);
    const canopyRim = outlinedMesh(new THREE.TorusGeometry(0.5, 0.06, 6, 16), paintMat);
    canopyRim.position.z = 0.92;
    root.add(canopyRim);
    const nozzle = outlinedMesh(new THREE.CylinderGeometry(0.12, 0.17, 0.24, 9), accent);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 0.92;
    root.add(nozzle);
  } else if (spec.id === 'burst') {
    const body = outlinedMesh(new THREE.SphereGeometry(0.3, 12, 8), accent);
    body.scale.set(1, 0.84, 1.24);
    body.position.z = 0.3;
    root.add(body);
    const chamber = outlinedMesh(new THREE.SphereGeometry(0.21, 12, 8), paintMat);
    chamber.position.set(0, 0.06, 0.66);
    root.add(chamber);
    const nozzle = outlinedMesh(new THREE.CylinderGeometry(0.09, 0.14, 0.25, 9), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 0.95;
    root.add(nozzle);
    const fin = roundedBox(0.1, 0.24, 0.3, accent);
    fin.position.set(0, 0.3, 0.22);
    root.add(fin);
  } else {
    const body = outlinedMesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 9), accent);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.36;
    root.add(body);
    const tank = outlinedMesh(new THREE.SphereGeometry(0.21, 10, 7), paintMat);
    tank.scale.set(0.9, 1.05, 1.3);
    tank.position.set(0, 0.13, 0.22);
    root.add(tank);
    const nozzle = outlinedMesh(new THREE.CylinderGeometry(0.085, 0.125, 0.32, 9), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 0.84;
    root.add(nozzle);
    const grip = roundedBox(0.12, 0.24, 0.12, dark);
    grip.position.set(0, -0.2, 0.3);
    grip.rotation.x = 0.3;
    root.add(grip);
  }
  return root;
}

export function createFighter(
  id: number,
  team: Team,
  isPlayer: boolean,
  weaponSpec: WeaponSpec,
  spawn: THREE.Vector3,
  outfit?: OutfitSpec,
  selectedHairstyle?: HairstyleId,
  displayName?: string,
  displayUserId?: string
): Fighter {
  const group = new THREE.Group();
  const visual = new THREE.Group();
  group.add(visual);
  visual.scale.set(BASE_VISUAL_SCALE_XZ, BASE_VISUAL_SCALE_Y, BASE_VISUAL_SCALE_XZ);

  const colors = TEAM_COLORS[team];
  const primary = outfit ? new THREE.Color(outfit.primary).getHex() : team === 'cyan' ? 0x27475c : 0x5e3a4c;
  const accentColor = outfit ? new THREE.Color(outfit.accent).getHex() : colors.main;
  const jacketMat = toonMaterial(primary);
  const accentMat = toonMaterial(accentColor);
  const darkMat = toonMaterial(0x232f40);
  const shortsMat = toonMaterial(outfit?.bottoms === 'skirt' ? accentColor : outfit?.bottoms === 'pants' ? 0x1d2a3a : 0x2e3a50);
  const skinMat = toonMaterial(team === 'cyan' ? 0xffcfae : 0xe9ad84);
  const whiteMat = toonMaterial(0xf7fcff);
  const irisMat = new THREE.MeshBasicMaterial({ color: team === 'cyan' ? 0x123c46 : 0x4a1c24 });
  const glossWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  // Puffy glossy "ink-blob" hair liquid: original, but reads wet like Splatoon hair.
  const hairMat = glossMaterial(colors.main);

  // Modular anime mannequin: a clean cylindrical torso is the common clothing mount.
  const torso = new THREE.Group();
  torso.position.y = 1.08;
  visual.add(torso);

  const torsoHeight = outfit?.style === 'coat' ? 0.92 : outfit?.style === 'hoodie' ? 0.72 : 0.68;
  const torsoRadius = outfit?.style === 'hoodie' ? 0.36 : outfit?.style === 'coat' ? 0.32 : 0.3;
  const hoodie = outlinedMesh(new THREE.CylinderGeometry(torsoRadius * 0.82, torsoRadius, torsoHeight, 14), jacketMat);
  hoodie.position.y = outfit?.style === 'coat' ? -0.08 : 0;
  torso.add(hoodie);
  const collar = outlinedMesh(new THREE.CylinderGeometry(0.19, 0.22, 0.12, 12), accentMat);
  collar.position.y = torsoHeight * 0.48;
  torso.add(collar);
  const zipper = roundedBox(outfit?.style === 'jersey' ? 0.22 : 0.035, torsoHeight * 0.74, 0.025, accentMat);
  zipper.position.set(0, -0.03, torsoRadius + 0.015);
  torso.add(zipper);
  if (outfit?.style === 'hoodie') {
    const pocket = roundedBox(0.32, 0.11, 0.045, accentMat);
    pocket.position.set(0, -0.2, torsoRadius + 0.02);
    torso.add(pocket);
  }
  if (outfit?.style === 'coat') {
    for (const side of [-1, 1]) {
      const tail = roundedBox(0.25, 0.46, 0.08, jacketMat);
      tail.position.set(side * 0.14, -0.54, -0.02);
      tail.rotation.z = side * 0.05;
      torso.add(tail);
    }
  }

  const bottomHeight = outfit?.bottoms === 'pants' ? 0.42 : outfit?.bottoms === 'skirt' ? 0.3 : 0.24;
  const shorts = outlinedMesh(new THREE.CylinderGeometry(outfit?.bottoms === 'skirt' ? 0.34 : 0.28, outfit?.bottoms === 'skirt' ? 0.42 : 0.31, bottomHeight, 12), shortsMat);
  shorts.position.y = -0.48;
  torso.add(shorts);

  // Slightly smaller head keeps the expressive style while improving the head-to-body ratio.
  const head = new THREE.Group();
  head.position.y = 1.82;
  head.scale.setScalar(0.92);
  visual.add(head);

  const face = outlinedMesh(new THREE.SphereGeometry(0.55, 16, 12), skinMat, 1.045);
  face.scale.set(0.94, 0.9, 0.9);
  head.add(face);

  // Big oval eyes with sclera, dark iris and double catchlight.
  const makeEye = (side: number) => {
    const eye = new THREE.Group();
    const sclera = outlinedMesh(new THREE.SphereGeometry(0.13, 12, 9), glossWhite, 1.02);
    sclera.scale.set(0.82, 1, 0.36);
    eye.add(sclera);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), irisMat);
    iris.scale.set(0.78, 1, 0.3);
    iris.position.z = 0.028;
    eye.add(iris);
    const spark1 = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), glossWhite);
    spark1.position.set(-0.014, 0.045, 0.05);
    eye.add(spark1);
    const spark2 = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 5), glossWhite);
    spark2.position.set(0.03, -0.015, 0.05);
    eye.add(spark2);
    const brow = roundedBox(0.14, 0.035, 0.03, darkMat);
    brow.position.set(side * 0.01, 0.16, 0.02);
    brow.rotation.z = -side * 0.12;
    eye.add(brow);
    eye.position.set(side * 0.2, 0.08, 0.45);
    return eye;
  };
  const leftEye = makeEye(-1);
  const rightEye = makeEye(1);
  head.add(leftEye, rightEye);

  // Original two-stripe face paint under the eyes.
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.1, 3, 6), new THREE.MeshBasicMaterial({ color: colors.main }));
    stripe.position.set(side * 0.28, -0.05, 0.47);
    stripe.rotation.z = side * 1.2;
    stripe.rotation.x = 0.25;
    head.add(stripe);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 5), new THREE.MeshBasicMaterial({ color: 0xff8d9b, transparent: true, opacity: 0.5 }));
    cheek.scale.set(1, 0.45, 0.25);
    cheek.position.set(side * 0.36, -0.14, 0.44);
    head.add(cheek);
  }
  // Open happy smile.
  const smile = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 6), darkMat);
  smile.scale.set(1.15, 0.55, 0.3);
  smile.position.set(0, -0.13, 0.475);
  head.add(smile);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 5), new THREE.MeshBasicMaterial({ color: 0xff8fa0 }));
  tongue.scale.set(1.1, 0.5, 0.3);
  tongue.position.set(0, -0.155, 0.485);
  head.add(tongue);

  // Team-ink anime hair: every hairstyle uses the fighter's current team color.
  const hair = new THREE.Group();
  head.add(hair);
  const hairstyle = selectedHairstyle ?? 'short';
  const hairCap = outlinedMesh(new THREE.SphereGeometry(0.56, 14, 10, 0, Math.PI * 2, 0, Math.PI * (hairstyle === 'bob' || hairstyle === 'long' ? 0.68 : 0.56)), hairMat);
  hairCap.scale.set(0.99, hairstyle === 'spiky' ? 0.68 : 0.78, 0.99);
  hairCap.position.y = 0.13;
  hair.add(hairCap);
  for (const x of [-0.28, -0.09, 0.1, 0.29]) {
    const bang = outlinedMesh(new THREE.ConeGeometry(hairstyle === 'spiky' ? 0.14 : 0.11, hairstyle === 'spiky' ? 0.46 : 0.34, 7), hairMat);
    bang.position.set(x, hairstyle === 'spiky' ? 0.34 + Math.abs(x) * 0.1 : 0.17 - Math.abs(x) * 0.12, hairstyle === 'spiky' ? 0.25 : 0.43);
    bang.rotation.x = hairstyle === 'spiky' ? -0.55 : 0.34;
    bang.rotation.z = -x * (hairstyle === 'spiky' ? 1.1 : 0.65);
    hair.add(bang);
  }
  const addHairTail = (x: number, y: number, z: number, length: number, rotationZ: number) => {
    const tail = outlinedMesh(new THREE.CapsuleGeometry(0.1, length, 3, 8), hairMat);
    tail.position.set(x, y, z);
    tail.rotation.z = rotationZ;
    hair.add(tail);
  };
  if (hairstyle === 'ponytail') addHairTail(-0.36, -0.05, -0.32, 0.55, 0.46);
  else if (hairstyle === 'twin-tail') {
    addHairTail(-0.42, -0.08, -0.22, 0.56, 0.62);
    addHairTail(0.42, -0.08, -0.22, 0.56, -0.62);
  } else if (hairstyle === 'long') {
    for (const x of [-0.3, -0.1, 0.1, 0.3]) addHairTail(x, -0.22, -0.35, 0.72, x * -0.35);
  } else if (hairstyle === 'bun') {
    const bun = outlinedMesh(new THREE.SphereGeometry(0.25, 11, 8), hairMat);
    bun.position.set(0, 0.6, -0.12);
    hair.add(bun);
  } else if (hairstyle === 'braid') {
    for (let i = 0; i < 4; i++) {
      const bead = outlinedMesh(new THREE.SphereGeometry(0.11 - i * 0.012, 8, 6), hairMat);
      bead.position.set(0.34, -0.06 - i * 0.18, -0.28);
      hair.add(bead);
    }
  } else if (hairstyle === 'side-tail') addHairTail(0.44, -0.1, -0.2, 0.7, -0.5);
  else if (hairstyle === 'wolf') {
    addHairTail(-0.22, -0.22, -0.38, 0.48, 0.16);
    addHairTail(0.22, -0.22, -0.38, 0.48, -0.16);
  } else if (hairstyle === 'hime') {
    for (const x of [-0.36, -0.18, 0, 0.18, 0.36]) addHairTail(x, -0.22, -0.34, 0.78, x * -0.18);
  } else if (hairstyle === 'curly') {
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const curl = outlinedMesh(new THREE.TorusGeometry(0.13 + i * 0.015, 0.045, 6, 11, Math.PI * 1.55), hairMat);
      curl.position.set(side * (0.38 + i * 0.025), 0.05 - i * 0.18, -0.14);
      curl.rotation.z = side * 0.28;
      hair.add(curl);
    }
  }

  const accessory = outfit?.accessory ?? 'none';
  if (accessory === 'headphones') {
    const band = outlinedMesh(new THREE.TorusGeometry(0.48, 0.045, 7, 16, Math.PI), accentMat);
    band.rotation.z = Math.PI;
    band.position.y = 0.13;
    hair.add(band);
    for (const side of [-1, 1]) {
      const ear = outlinedMesh(new THREE.CylinderGeometry(0.13, 0.13, 0.09, 10), accentMat);
      ear.rotation.z = Math.PI / 2;
      ear.position.set(side * 0.5, 0.03, 0);
      hair.add(ear);
    }
  } else if (accessory === 'visor') {
    const visor = outlinedMesh(new THREE.BoxGeometry(0.7, 0.16, 0.08), accentMat);
    visor.position.set(0, 0.1, 0.5);
    visor.rotation.x = -0.08;
    head.add(visor);
  }

  // Long, slim limbs make lateral movement and airborne poses read more precisely.
  const armMat = outfit?.style === 'jersey' ? skinMat : jacketMat;
  const leftArm = makeLimb(0.58, 0.078, armMat);
  leftArm.position.set(-0.35, 1.38, 0.02);
  visual.add(leftArm);
  const rightArm = makeLimb(0.58, 0.078, armMat);
  rightArm.position.set(0.35, 1.38, 0.02);
  visual.add(rightArm);
  for (const arm of [leftArm, rightArm]) {
    const hand = outlinedMesh(new THREE.SphereGeometry(0.105, 9, 7), skinMat);
    hand.position.y = -0.58;
    arm.add(hand);
  }

  // Longer legs, slimmer ankles and compact sneakers.
  const leftLeg = makeLimb(0.64, 0.082, skinMat);
  leftLeg.position.set(-0.145, 0.59, 0);
  visual.add(leftLeg);
  const rightLeg = makeLimb(0.64, 0.082, skinMat);
  rightLeg.position.set(0.145, 0.59, 0);
  visual.add(rightLeg);
  for (const [leg, side] of [[leftLeg, -1], [rightLeg, 1]] as const) {
    const sock = roundedBox(0.17, 0.2, 0.18, whiteMat);
    sock.position.y = -0.55;
    leg.add(sock);
    const shoeRadius = outfit?.footwear === 'boots' ? 0.17 : outfit?.footwear === 'high-tops' ? 0.16 : 0.145;
    const shoe = outlinedMesh(new THREE.CapsuleGeometry(shoeRadius, outfit?.footwear === 'boots' ? 0.34 : 0.24, 4, 8), whiteMat);
    shoe.rotation.x = Math.PI / 2;
    shoe.position.set(side * 0.01, -0.66, 0.16);
    leg.add(shoe);
    const sole = roundedBox(0.23, 0.09, 0.35, accentMat);
    sole.position.set(side * 0.01, -0.72, 0.15);
    leg.add(sole);
    const toe = roundedBox(0.21, 0.11, 0.16, accentMat);
    toe.position.set(side * 0.01, -0.67, 0.3);
    leg.add(toe);
    const lace = roundedBox(0.13, 0.035, 0.18, darkMat);
    lace.position.set(side * 0.01, -0.58, 0.17);
    leg.add(lace);
  }

  // Backpack ink tank with a visible liquid level.
  const backpack = new THREE.Group();
  backpack.position.set(0, 1.18, -0.34);
  visual.add(backpack);
  const packBody = outlinedMesh(new THREE.CapsuleGeometry(0.23, 0.42, 4, 9), darkMat);
  packBody.rotation.x = 0.1;
  backpack.add(packBody);
  const tankShell = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.145, 0.34, 4, 10),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 })
  );
  tankShell.position.z = -0.14;
  backpack.add(tankShell);
  const tankInk = new THREE.Mesh(new THREE.CapsuleGeometry(0.118, 0.29, 4, 10), glossMaterial(colors.main));
  tankInk.position.z = -0.14;
  backpack.add(tankInk);
  const cap = outlinedMesh(new THREE.CylinderGeometry(0.09, 0.11, 0.13, 8), accentMat);
  cap.position.set(0, 0.36, -0.13);
  backpack.add(cap);

  // Weapon held in the right hand, aimed forward.
  const weapon = makeWeapon(weaponSpec, accentMat, darkMat, colors.main);
  weapon.position.set(0.42, 1.04, 0.48);
  weapon.rotation.set(-0.12, -0.12, 0);
  visual.add(weapon);
  rightArm.rotation.set(-1.18, 0, -0.22);
  leftArm.rotation.set(-0.95, 0, 0.42);

  const inkStain = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 12, 8),
    new THREE.MeshPhysicalMaterial({ color: colors.main, transparent: true, opacity: 0, roughness: 0.12, clearcoat: 1, depthWrite: false })
  );
  inkStain.scale.set(1.05, 1.35, 0.72);
  inkStain.position.set(0, 1.22, 0.08);
  inkStain.renderOrder = 9;
  visual.add(inkStain);

  // Team ring + soft blob shadow.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.58, 0.7, 28),
    new THREE.MeshBasicMaterial({ color: colors.main, transparent: true, opacity: isPlayer ? 0.75 : 0.3, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);
  const blobShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x132530, transparent: true, opacity: 0.34, depthWrite: false })
  );
  blobShadow.rotation.x = -Math.PI / 2;
  blobShadow.position.y = 0.03;
  group.add(blobShadow);

  group.position.copy(spawn);
  if (displayName) {
    group.userData.displayName = displayName;
    group.add(createNameplate(displayName, team));
  }
  group.userData.fighterId = id;
  group.userData.rig = { visual, torso, head, hair, leftEye, rightEye, leftArm, rightArm, leftLeg, rightLeg, weapon, backpack, tankInk, blobShadow, ring, inkStain } satisfies FighterRig;

  return {
    id,
    team,
    isPlayer,
    group,
    velocity: new THREE.Vector3(),
    health: 100,
    ammo: 100,
    alive: true,
    respawnAt: 0,
    spawn: spawn.clone(),
    fireCooldown: Math.random() * 0.4,
    thinkCooldown: 0,
    aiTarget: spawn.clone(),
    aiMode: 'paint',
    weapon: weaponSpec,
    score: 0,
    hitFlash: 0,
    recoil: 0,
    spawnPulse: 1,
    verticalVelocity: 0,
    grounded: true,
    landingPulse: 0,
    previousGrounded: true,
    swim: false,
    swimLevel: 0,
    surfaceClimbing: false,
    surfaceNormal: new THREE.Vector3(0, 1, 0),
    surfacePoint: new THREE.Vector3(),
    aiCommitUntil: 0,
    aiLastProductivePaintAt: 0,
    aiNextPaintShotAt: Math.random() * 0.3,
    aiPaintShots: 0,
    aiFightShots: 0,
    aiProductivePaintCells: 0,
    aiStuckTime: 0,
    aiLastPosX: spawn.x,
    aiLastPosZ: spawn.z,
    aiSteerBias: 0,
    aiSteerUntil: 0,
    aiJumpCooldown: 0,
    aiJumpCount: 0,
    lastDamagedAt: -Infinity,
    inkStain: 0,
    inkStainTeam: null,
    rollerHitCooldown: 0,
    aimPitch: 0,
    lastRollerPaintX: spawn.x,
    lastRollerPaintZ: spawn.z,
    livePower: 0,
    liveUserId: displayUserId
  };
}

export function resetFighterPose(fighter: Fighter) {
  const rig = fighter.group.userData.rig as FighterRig;
  fighter.group.rotation.x = 0;
  fighter.group.rotation.z = 0;
  fighter.swim = false;
  fighter.swimLevel = 0;
  fighter.surfaceClimbing = false;
  fighter.surfaceNormal.set(0, 1, 0);
  fighter.surfacePoint.copy(fighter.group.position);
  rig.visual.position.set(0, 0, 0);
  rig.visual.rotation.set(0, 0, 0);
  rig.visual.scale.set(BASE_VISUAL_SCALE_XZ, BASE_VISUAL_SCALE_Y, BASE_VISUAL_SCALE_XZ);
  rig.torso.rotation.set(0, 0, 0);
  rig.torso.scale.set(1, 1, 1);
  rig.head.rotation.set(0, 0, 0);
  rig.head.position.y = 1.82;
  rig.hair.rotation.set(0, 0, 0);
  rig.leftLeg.rotation.set(0, 0, -0.025);
  rig.rightLeg.rotation.set(0, 0, 0.025);
  rig.leftArm.rotation.set(-0.95, 0, 0.42);
  rig.rightArm.rotation.set(-1.18, 0, -0.22);
  rig.weapon.position.set(0.42, 1.04, 0.48);
  rig.weapon.rotation.set(-0.12, -0.12, 0);
  rig.backpack.rotation.set(0, 0, 0);
  fighter.inkStain = 0;
  fighter.inkStainTeam = null;
  (rig.inkStain.material as THREE.MeshPhysicalMaterial).opacity = 0;
}

export function animateFighter(fighter: Fighter, time: number, speed: number, dt: number) {
  const rig = fighter.group.userData.rig as FighterRig;
  const phase = time * 10.5 + fighter.id * 0.9;
  const moveAmount = THREE.MathUtils.smoothstep(speed, 0.2, 7.5);
  const sprintAmount = THREE.MathUtils.smoothstep(speed, 6.6, 9.2);
  const stride = Math.sin(phase) * moveAmount;
  const bob = Math.abs(Math.sin(phase)) * 0.055 * moveAmount;
  const idleBreath = Math.sin(time * 2.4 + fighter.id) * 0.02 * (1 - moveAmount);

  const airborne = fighter.grounded ? 0 : 1;
  const rise = THREE.MathUtils.clamp(fighter.verticalVelocity / 8.6, -1, 1);
  const airTuck = airborne * (0.55 - rise * 0.12);
  fighter.landingPulse = Math.max(0, fighter.landingPulse - dt * 5.5);
  const landingSquash = Math.sin(fighter.landingPulse * Math.PI) * 0.13;

  // Ink-swim: the fighter deliberately dives into allied ink, becoming low and hydrodynamic.
  fighter.swimLevel = THREE.MathUtils.lerp(fighter.swimLevel, fighter.swim ? 1 : 0, 1 - Math.pow(0.0005, dt));
  const swim = fighter.swimLevel;
  const swimKick = Math.sin(phase * 1.6) * swim;

  rig.visual.position.y = bob + idleBreath - landingSquash * 0.12 - swim * 0.58;
  rig.visual.rotation.x = THREE.MathUtils.lerp(
    rig.visual.rotation.x,
    -0.1 * sprintAmount - rise * 0.08 * airborne - swim * 0.42,
    1 - Math.pow(0.001, dt)
  );
  rig.torso.rotation.y = Math.sin(phase) * 0.08 * moveAmount * (1 - airborne * 0.7) * (1 - swim);
  rig.torso.rotation.z = -stride * 0.04 * (1 - airborne) * (1 - swim);
  rig.torso.scale.y = 1 + idleBreath * 0.05 - landingSquash - swim * 0.14;
  rig.torso.rotation.x = swim * 0.3;
  rig.head.rotation.x = rise * 0.07 * airborne - swim * 0.42;
  rig.hair.rotation.x = -bob * 0.8 + Math.sin(time * 3.2 + fighter.id) * 0.012 - rise * 0.08 * airborne + swim * 0.14;

  if (swim > 0.08) {
    // Paddle kick while gliding through ink.
    rig.leftLeg.rotation.x = -0.35 + swimKick * 0.55;
    rig.rightLeg.rotation.x = -0.35 - swimKick * 0.55;
    rig.leftLeg.rotation.z = -0.18;
    rig.rightLeg.rotation.z = 0.18;
    rig.leftArm.rotation.x = -0.55 + swimKick * 0.3;
    rig.rightArm.rotation.x = -0.7 - swimKick * 0.3;
  } else {
    rig.leftLeg.rotation.x = stride * 0.68 * (1 - airborne) - airTuck;
    rig.rightLeg.rotation.x = -stride * 0.68 * (1 - airborne) - airTuck * 0.75;
    rig.leftLeg.rotation.z = -0.025 - airborne * 0.12;
    rig.rightLeg.rotation.z = 0.025 + airborne * 0.12;
    rig.leftArm.rotation.x = -0.95 - stride * 0.14 * (1 - airborne) + airborne * 0.2;
    rig.rightArm.rotation.x = -1.18 + stride * 0.1 * (1 - airborne) + airborne * 0.12;
  }
  rig.leftArm.rotation.z = 0.42;
  rig.rightArm.rotation.z = -0.22;

  const blink = Math.sin(time * 0.72 + fighter.id * 1.7) > 0.985 ? 0.12 : 1;
  rig.leftEye.scale.y = blink;
  rig.rightEye.scale.y = blink;

  fighter.recoil = Math.max(0, fighter.recoil - dt * 8.5);
  const kick = Math.sin(fighter.recoil * Math.PI) * 0.16;
  fighter.aimPitch = THREE.MathUtils.lerp(fighter.aimPitch, 0, 1 - Math.pow(0.02, dt));
  const aim = fighter.aimPitch;
  rig.head.position.y = 1.74 - bob * 0.22 - landingSquash * 0.2 - swim * 0.3;
  rig.hair.rotation.y = Math.sin(time * 2.6 + fighter.id) * 0.05 * (1 - swim);
  rig.weapon.position.z = 0.48 - kick;
  rig.weapon.position.y = 1.04 - aim * 0.14;
  rig.weapon.rotation.x = -0.12 - kick * 0.6 - aim * 1.15;
  rig.rightArm.rotation.x -= kick * 0.5 + aim * 0.9;
  rig.leftArm.rotation.x += aim * 0.28;
  rig.head.rotation.x -= aim * 0.32;
  rig.backpack.rotation.x = Math.sin(phase) * 0.035 * moveAmount + swim * 0.2;

  fighter.inkStain = Math.max(0, fighter.inkStain - dt * 0.24);
  const stainMaterial = rig.inkStain.material as THREE.MeshPhysicalMaterial;
  if (fighter.inkStainTeam) stainMaterial.color.setHex(TEAM_COLORS[fighter.inkStainTeam].main);
  stainMaterial.opacity = fighter.inkStain * 0.62;
  rig.inkStain.visible = fighter.inkStain > 0.01;
  rig.inkStain.rotation.y += dt * 0.32;

  // Backpack ink level tracks ammo.
  const inkRatio = THREE.MathUtils.clamp(fighter.ammo / 100, 0.12, 1);
  rig.tankInk.scale.y = inkRatio;
  rig.tankInk.position.y = -(1 - inkRatio) * 0.24;

  const localVelocity = localVelocityScratch.copy(fighter.velocity).applyAxisAngle(upAxis, -fighter.group.rotation.y);
  const sideStep = THREE.MathUtils.clamp(localVelocity.x / 7, -1, 1);
  const forwardStep = THREE.MathUtils.clamp(localVelocity.z / 7, -1, 1);
  const turnLean = THREE.MathUtils.clamp((fighter.group.rotation.y - rig.visual.rotation.y) * 0.12, -0.16, 0.16);
  fighter.group.rotation.z = THREE.MathUtils.lerp(fighter.group.rotation.z, -localVelocity.x * 0.016, 1 - Math.pow(0.002, dt));
  rig.head.rotation.y = THREE.MathUtils.lerp(rig.head.rotation.y, -sideStep * 0.16, 1 - Math.pow(0.01, dt));
  rig.torso.rotation.y += sideStep * 0.13 + turnLean;
  rig.weapon.rotation.y = -0.12 - sideStep * 0.08;
  if (!fighter.grounded) {
    const falling = fighter.verticalVelocity < 0;
    rig.leftArm.rotation.z = 0.42 + (falling ? -0.38 : 0.28);
    rig.rightArm.rotation.z = -0.22 + (falling ? 0.38 : -0.28);
    rig.leftLeg.rotation.z = -0.18 - forwardStep * 0.08;
    rig.rightLeg.rotation.z = 0.18 + forwardStep * 0.08;
  } else if (sprintAmount > 0.25) {
    rig.head.rotation.x -= sprintAmount * 0.08;
    rig.leftArm.rotation.x -= stride * 0.22;
    rig.rightArm.rotation.x += stride * 0.18;
  }

  // Blob shadow hugs the ground even mid-jump.
  rig.blobShadow.position.y = -fighter.group.position.y + 0.045;
  const shadowScale = THREE.MathUtils.clamp(1 - fighter.group.position.y * 0.22, 0.55, 1);
  rig.blobShadow.scale.setScalar(shadowScale * (1 + swim * 0.35));
  (rig.blobShadow.material as THREE.MeshBasicMaterial).opacity = 0.34 * shadowScale;

  const ringMaterial = rig.ring.material as THREE.MeshBasicMaterial;
  ringMaterial.opacity = (fighter.isPlayer ? 0.68 : 0.26) + Math.sin(time * 4 + fighter.id) * 0.07;
  rig.ring.position.y = -fighter.group.position.y + 0.05;
  rig.ring.scale.setScalar(1 + Math.sin(time * 4 + fighter.id) * 0.03 + swim * 0.22);

  if (fighter.hitFlash > 0) {
    fighter.hitFlash = Math.max(0, fighter.hitFlash - dt);
    rig.visual.scale.setScalar(1 + Math.sin(fighter.hitFlash * 52) * 0.045);
    rig.visual.rotation.z += Math.sin(fighter.hitFlash * 45) * 0.035;
  } else if (fighter.spawnPulse > 0) {
    fighter.spawnPulse = Math.max(0, fighter.spawnPulse - dt * 2.4);
    const pop = 1 + Math.sin((1 - fighter.spawnPulse) * Math.PI) * 0.12;
    rig.visual.scale.set(pop * BASE_VISUAL_SCALE_XZ, pop * BASE_VISUAL_SCALE_Y, pop * BASE_VISUAL_SCALE_XZ);
  } else {
    const squashX = BASE_VISUAL_SCALE_XZ * (1 + landingSquash * 0.5 + swim * 0.16);
    const squashY = BASE_VISUAL_SCALE_Y * (1 - landingSquash * 0.65 - swim * 0.42);
    rig.visual.scale.set(squashX, squashY, squashX);
  }
}
