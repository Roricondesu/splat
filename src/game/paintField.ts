import * as THREE from 'three';
import { Team, WeaponId } from './config';

export const GRID_SIZE = 128;
export const DEFAULT_WORLD_SIZE = 44;
const CANVAS_SIZE = 1024;

export type PaintSplatStyle = WeaponId | 'spawn' | 'elimination';

interface PaintPalette {
  base: string;
}

const PALETTES: Record<Team, PaintPalette> = {
  cyan: { base: '#08d3c8' },
  orange: { base: '#ff641f' }
};

export class PaintField {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly data: Uint8Array;
  readonly floor: THREE.Mesh;
  private readonly inkFloor: THREE.Mesh;
  private stampSerial = 0;
  private cyanCells = 0;
  private orangeCells = 0;
  private textureDirty = false;
  private lastTextureUploadAt = -Infinity;

  constructor(scene: THREE.Scene, readonly worldSize = DEFAULT_WORLD_SIZE) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.data = new Uint8Array(GRID_SIZE * GRID_SIZE);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.anisotropy = 2;

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.worldSize, this.worldSize),
      new THREE.MeshToonMaterial({ color: 0xcbd4dc })
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    this.inkFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.worldSize, this.worldSize),
      new THREE.MeshPhysicalMaterial({
        map: this.texture,
        transparent: true,
        alphaTest: 0.015,
        depthWrite: false,
        roughness: 0.16,
        metalness: 0.01,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      })
    );
    this.inkFloor.rotation.x = -Math.PI / 2;
    this.inkFloor.position.y = 0.014;
    this.inkFloor.renderOrder = 2;
    scene.add(this.inkFloor);
    this.reset();
  }

  reset() {
    this.data.fill(0);
    this.cyanCells = 0;
    this.orangeCells = 0;
    this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    this.texture.needsUpdate = true;
    this.textureDirty = false;
    this.lastTextureUploadAt = -Infinity;
  }

  worldToGrid(x: number, z: number) {
    return {
      x: Math.floor((x / this.worldSize + 0.5) * GRID_SIZE),
      y: Math.floor((z / this.worldSize + 0.5) * GRID_SIZE)
    };
  }

  gridToWorld(x: number, y: number, out = new THREE.Vector3()) {
    return out.set((x / GRID_SIZE - 0.5) * this.worldSize, 0, (y / GRID_SIZE - 0.5) * this.worldSize);
  }

  paint(
    x: number,
    z: number,
    radius: number,
    team: Team,
    strength = 1,
    style: PaintSplatStyle = 'pulse',
    dirX = 0,
    dirZ = 1
  ) {
    return this.stamp(x, z, radius, team, strength, style, dirX, dirZ, 0);
  }

  paintImpact(
    x: number,
    z: number,
    radius: number,
    team: Team,
    dirX: number,
    dirZ: number,
    stretch: number,
    style: PaintSplatStyle = 'pulse'
  ) {
    return this.stamp(x, z, radius, team, 1, style, dirX, dirZ, stretch);
  }

  flushTexture(time: number) {
    if (!this.textureDirty || time - this.lastTextureUploadAt < 1 / 24) return;
    this.texture.needsUpdate = true;
    this.textureDirty = false;
    this.lastTextureUploadAt = time;
  }

  private stamp(
    x: number,
    z: number,
    radius: number,
    team: Team,
    strength: number,
    style: PaintSplatStyle,
    dirX: number,
    dirZ: number,
    stretch: number
  ) {
    const serial = ++this.stampSerial;
    const directionLength = Math.hypot(dirX, dirZ);
    const fallbackAngle = this.hash(serial * 2.37) * Math.PI * 2;
    const angle = directionLength > 0.001 ? Math.atan2(dirZ, dirX) : fallbackAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const g = this.worldToGrid(x, z);
    const pixelRadius = Math.max(1.5, radius / this.worldSize * GRID_SIZE * Math.max(0.55, strength));
    const extent = style === 'charger' ? 2.3
      : style === 'roller' ? 1.5
      : style === 'bucket' || style === 'umbrella' ? 1.3
      : style === 'brush' ? 1.25
      : style === 'elimination' ? 1.2
      : 1.08;
    const bound = Math.ceil(pixelRadius * extent);
    const value = team === 'cyan' ? 1 : 2;
    let changedCells = 0;

    for (let py = -bound; py <= bound; py++) {
      for (let px = -bound; px <= bound; px++) {
        const along = (px * cos + py * sin) / pixelRadius;
        const side = (-px * sin + py * cos) / pixelRadius;
        const noise = this.hash(px * 17.13 + py * 11.71 + serial * 0.97);
        if (!this.insideSplat(style, along, side, noise, stretch)) continue;
        const gx = g.x + px;
        const gy = g.y + py;
        if (gx < 0 || gy < 0 || gx >= GRID_SIZE || gy >= GRID_SIZE) continue;
        const index = gy * GRID_SIZE + gx;
        const previous = this.data[index];
        if (previous === value) continue;
        if (previous === 1) this.cyanCells--;
        else if (previous === 2) this.orangeCells--;
        this.data[index] = value;
        if (value === 1) this.cyanCells++;
        else this.orangeCells++;
        changedCells++;
      }
    }

    this.drawSplat(x, z, radius, team, style, angle, stretch, serial);
    this.textureDirty = true;
    return changedCells;
  }

  private insideSplat(style: PaintSplatStyle, along: number, side: number, noise: number, stretch: number) {
    if (style === 'roller' || style === 'brush') {
      const halfLength = style === 'brush' ? 0.85 : 1.18 + stretch * 0.5;
      const halfWidth = style === 'brush' ? 0.78 : 0.5 + noise * 0.08;
      const core = Math.max(Math.abs(along) - halfLength, 0);
      return core * core + side * side < halfWidth * halfWidth;
    }
    if (style === 'bucket' || style === 'umbrella') {
      const shifted = along - (style === 'umbrella' ? 0.1 : 0.18);
      const length = style === 'umbrella' ? 0.95 : 1.12;
      const width = style === 'umbrella' ? 1.05 : 0.9 - THREE.MathUtils.clamp(shifted, -0.8, 0.9) * 0.2;
      return (shifted / length) ** 2 + (side / width) ** 2 < (style === 'umbrella' ? 0.95 : 0.82 + noise * 0.2);
    }
    if (style === 'charger') {
      const shifted = along - 0.1;
      return (shifted / (1.9 + stretch * 0.8)) ** 2 + (side / 0.26) ** 2 < 0.9 + noise * 0.12;
    }
    if (style === 'burst' || style === 'elimination') {
      const distance = Math.hypot(along, side);
      const a = Math.atan2(side, along);
      const lobes = style === 'elimination' ? 9 : 7;
      const edge = 0.83 + Math.sin(a * lobes + noise * 0.4) * 0.14 + noise * 0.08;
      return distance < edge;
    }
    const distanceSq = along * along + side * side;
    const edge = style === 'spawn' ? 1.08 : 0.9 + noise * 0.12 + stretch * 0.1;
    return distanceSq < edge * edge;
  }

  private drawSplat(
    x: number,
    z: number,
    radius: number,
    team: Team,
    style: PaintSplatStyle,
    angle: number,
    stretch: number,
    serial: number
  ) {
    const scale = CANVAS_SIZE / this.worldSize;
    const cx = (x / this.worldSize + 0.5) * CANVAS_SIZE;
    const cy = (z / this.worldSize + 0.5) * CANVAS_SIZE;
    const r = radius * scale;
    const color = PALETTES[team].base;

    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(angle);
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 1;
    this.ctx.beginPath();

    if (style === 'roller' || style === 'brush') {
      const length = style === 'brush' ? r * 1.7 : r * (2.35 + stretch * 0.7);
      const width = style === 'brush' ? r * 1.55 : r * 0.95;
      this.ctx.roundRect(-length / 2, -width / 2, length, width, width / 2);
    } else if (style === 'bucket' || style === 'umbrella') {
      const fan = style === 'umbrella' ? 1.16 : 1;
      this.ctx.moveTo(-r * 0.88 * fan, 0);
      this.ctx.quadraticCurveTo(-r * 0.28, -r * 1.0 * fan, r * 1.08, -r * 0.62 * fan);
      this.ctx.quadraticCurveTo(r * 0.72, 0, r * 1.08, r * 0.62 * fan);
      this.ctx.quadraticCurveTo(-r * 0.28, r * 1.0 * fan, -r * 0.88 * fan, 0);
    } else if (style === 'charger') {
      this.ctx.roundRect(-r * 2.1, -r * 0.22, r * 4.2 * (1 + stretch * 0.5), r * 0.44, r * 0.2);
    } else {
      const lobes = style === 'elimination' ? 11 : style === 'burst' ? 8 : style === 'spawn' ? 12 : 10;
      const points = lobes * 2;
      for (let i = 0; i <= points; i++) {
        const a = i / points * Math.PI * 2;
        const alternating = i % 2 === 0 ? 1 : style === 'burst' || style === 'elimination' ? 0.68 : 0.86;
        const jitter = 0.94 + this.hash(serial * 5.31 + i * 2.17) * 0.12;
        const rr = r * alternating * jitter * (1 + stretch * Math.abs(Math.cos(a)) * 0.55);
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) this.ctx.moveTo(px, py);
        else this.ctx.lineTo(px, py);
      }
      this.ctx.closePath();
    }
    this.ctx.fill();

    const dropCount = style === 'burst' || style === 'elimination' ? 5 : style === 'bucket' ? 3 : style === 'roller' ? 2 : 2;
    for (let i = 0; i < dropCount; i++) {
      const a = this.hash(serial * 7.7 + i * 3.1) * Math.PI * 2;
      const distance = r * (style === 'burst' || style === 'elimination' ? 1.0 + this.hash(i + serial) * 0.75 : 0.72 + this.hash(i + serial) * 0.5);
      const size = r * (0.1 + this.hash(serial * 0.7 + i) * 0.12);
      this.ctx.beginPath();
      this.ctx.arc(Math.cos(a) * distance, Math.sin(a) * distance, size, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // The ink plane itself has clearcoat; this small glint only helps the wet surface read at a glance.
    this.ctx.strokeStyle = 'rgba(255,255,255,.2)';
    this.ctx.lineWidth = Math.max(1.5, r * 0.07);
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.arc(-r * 0.12, -r * 0.08, r * 0.48, Math.PI * 1.05, Math.PI * 1.42);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private hash(value: number) {
    const s = Math.sin(value * 91.3458) * 47453.5453;
    return s - Math.floor(s);
  }

  teamAt(x: number, z: number): Team | null {
    const gx = Math.floor((x / this.worldSize + 0.5) * GRID_SIZE);
    const gy = Math.floor((z / this.worldSize + 0.5) * GRID_SIZE);
    if (gx < 0 || gy < 0 || gx >= GRID_SIZE || gy >= GRID_SIZE) return null;
    const value = this.data[gy * GRID_SIZE + gx];
    return value === 1 ? 'cyan' : value === 2 ? 'orange' : null;
  }

  findTarget(team: Team, origin: THREE.Vector3, out = new THREE.Vector3(), maxTries = 36) {
    const wanted = team === 'cyan' ? 1 : 2;
    let bestX = origin.x;
    let bestZ = origin.z;
    let bestScore = -Infinity;

    for (let i = 0; i < maxTries; i++) {
      const local = i < maxTries - 6;
      const distance = local ? 3.5 + Math.random() * 10.5 : Math.random() * this.worldSize * 0.55;
      const angle = Math.random() * Math.PI * 2;
      const worldX = THREE.MathUtils.clamp(origin.x + Math.cos(angle) * distance, -this.worldSize / 2 + 1.2, this.worldSize / 2 - 1.2);
      const worldZ = THREE.MathUtils.clamp(origin.z + Math.sin(angle) * distance, -this.worldSize / 2 + 1.2, this.worldSize / 2 - 1.2);
      const gx = Math.floor((worldX / this.worldSize + 0.5) * GRID_SIZE);
      const gy = Math.floor((worldZ / this.worldSize + 0.5) * GRID_SIZE);
      const value = this.data[gy * GRID_SIZE + gx];
      let frontier = 0;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = gx + ox;
        const ny = gy + oy;
        if (nx >= 0 && ny >= 0 && nx < GRID_SIZE && ny < GRID_SIZE && this.data[ny * GRID_SIZE + nx] !== wanted) frontier++;
      }
      const paintValue = value === wanted ? -9 : value === 0 ? 6 : 8.5;
      const score = paintValue + frontier * 0.9 - distance * 0.12 + Math.random() * 1.2;
      if (score > bestScore) {
        bestScore = score;
        bestX = worldX;
        bestZ = worldZ;
      }
    }
    return out.set(bestX, 0, bestZ);
  }

  coverage() {
    const painted = this.cyanCells + this.orangeCells;
    const contestedTotal = painted || 1;
    const mapTotal = this.data.length;
    return {
      cyan: this.cyanCells,
      orange: this.orangeCells,
      cyanPercent: this.cyanCells / contestedTotal * 100,
      orangePercent: this.orangeCells / contestedTotal * 100,
      cyanMapPercent: this.cyanCells / mapTotal * 100,
      orangeMapPercent: this.orangeCells / mapTotal * 100,
      paintedPercent: painted / mapTotal * 100
    };
  }

  dispose() {
    this.texture.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    this.inkFloor.geometry.dispose();
    (this.inkFloor.material as THREE.Material).dispose();
  }
}
