import type { MaterialFields } from '../doc/Materials';

/**
 * Ready-made materials: plain colours, and textures drawn here on a canvas (our own artwork, made
 * when the library is first shown). Texture sizes are real-world millimetres per tile.
 */
export interface LibraryEntry {
  key: string;
  fields: () => MaterialFields;
}

const colour = (name: string, color: string, opacity = 1): LibraryEntry => ({ key: `colour:${name}`, fields: () => ({ name, color, opacity }) });

const COLOURS: LibraryEntry[] = [
  colour('White', '#f4f3ef'),
  colour('Light Grey', '#c4c5c7'),
  colour('Charcoal', '#3b3d41'),
  colour('Black', '#151515'),
  colour('Red', '#c0392b'),
  colour('Orange', '#e07b25'),
  colour('Yellow', '#efc23a'),
  colour('Green', '#3f8f4a'),
  colour('Teal', '#1f8a8a'),
  colour('Blue', '#2d6cc0'),
  colour('Navy', '#1f2f5a'),
  colour('Purple', '#7d4fa0'),
  colour('Pink', '#e591b2'),
  colour('Sand', '#d8c39a'),
  colour('Brown', '#7b4a2a'),
  colour('Glass', '#9fd0e6', 0.35),
];

/** A small seeded random generator, so the textures are the same every time. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Speckle the whole canvas with small light and dark dots (grain, grit). */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, rnd: () => number): void {
  for (let i = 0; i < count; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

function shade(base: [number, number, number], d: number): string {
  return `rgb(${base.map((c) => Math.max(0, Math.min(255, Math.round(c + d)))).join(',')})`;
}

/** Running-bond brick: two courses per tile (440 × 150 mm), 10 mm mortar joints. */
function brick(): string {
  const [c, ctx] = canvas(440, 150);
  const rnd = random(7);
  ctx.fillStyle = '#c9c1b4';
  ctx.fillRect(0, 0, 440, 150);
  for (let row = 0; row < 2; row++) {
    const y = row * 75 + 5;
    for (let i = -1; i < 3; i++) {
      const x = i * 220 + (row ? 110 : 0) + 5;
      ctx.fillStyle = shade([150, 72, 52], (rnd() - 0.5) * 36);
      ctx.fillRect(x, y, 210, 65);
    }
  }
  speckle(ctx, 440, 150, 2500, 0.18, rnd);
  return c.toDataURL('image/jpeg', 0.88);
}

/** Wood planks running along u: four boards per tile (1200 × 600 mm). */
function wood(): string {
  const [c, ctx] = canvas(480, 240);
  const rnd = random(11);
  for (let b = 0; b < 4; b++) {
    const base: [number, number, number] = [176 + (rnd() - 0.5) * 24, 128 + (rnd() - 0.5) * 20, 82 + (rnd() - 0.5) * 16];
    ctx.fillStyle = shade(base, 0);
    ctx.fillRect(0, b * 60, 480, 60);
    for (let g = 0; g < 18; g++) {
      ctx.strokeStyle = shade(base, -18 - rnd() * 22);
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      ctx.beginPath();
      const y0 = b * 60 + rnd() * 60;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= 480; x += 40) ctx.lineTo(x, y0 + Math.sin(x / 70 + g) * 2.5 * rnd());
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60,35,20,0.55)';
    ctx.fillRect(0, b * 60, 480, 1.5);
    const joint = rnd() * 480;
    ctx.fillRect(joint, b * 60, 1.5, 60);
  }
  return c.toDataURL('image/jpeg', 0.88);
}

/** Square ceramic tiles, 300 mm with 4 mm grout (one tile per image). */
function tiles(): string {
  const [c, ctx] = canvas(300, 300);
  const rnd = random(5);
  ctx.fillStyle = '#b9b6ae';
  ctx.fillRect(0, 0, 300, 300);
  const g = ctx.createLinearGradient(0, 0, 300, 300);
  g.addColorStop(0, '#eceae4');
  g.addColorStop(1, '#dedbd3');
  ctx.fillStyle = g;
  ctx.fillRect(2, 2, 296, 296);
  speckle(ctx, 300, 300, 600, 0.06, rnd);
  return c.toDataURL('image/jpeg', 0.9);
}

/** Smooth concrete with a fine grit and soft blotches (1000 mm square). */
function concrete(): string {
  const [c, ctx] = canvas(256, 256);
  const rnd = random(3);
  ctx.fillStyle = '#a7a6a2';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 10 + rnd() * 40;
    const v = rnd() < 0.5 ? 0 : 255;
    // Blotches wrap round the edges so the tile repeats without seams.
    for (const dx of [-256, 0, 256]) {
      for (const dy of [-256, 0, 256]) {
        const grad = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, `rgba(${v},${v},${v},0.07)`);
        grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  speckle(ctx, 256, 256, 5000, 0.2, rnd);
  return c.toDataURL('image/jpeg', 0.88);
}

/** Short grass blades (1000 mm square). */
function grass(): string {
  const [c, ctx] = canvas(256, 256);
  const rnd = random(13);
  ctx.fillStyle = '#4f7d33';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    ctx.strokeStyle = shade([84, 130, 52], (rnd() - 0.5) * 60);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 5);
    ctx.stroke();
  }
  return c.toDataURL('image/jpeg', 0.85);
}

const texture = (name: string, color: string, draw: () => string, width: number, height: number): LibraryEntry => {
  let image: string | null = null;
  return {
    key: `texture:${name}`,
    fields: () => ({ name, color, opacity: 1, texture: { image: (image ??= draw()), width, height } }),
  };
};

const TEXTURES: LibraryEntry[] = [
  texture('Brick', '#96483a', brick, 440, 150),
  texture('Wood Planks', '#b0805a', wood, 1200, 600),
  texture('Tiles', '#e6e3dc', tiles, 300, 300),
  texture('Concrete', '#a7a6a2', concrete, 1000, 1000),
  texture('Grass', '#4f7d33', grass, 1000, 1000),
];

export const LIBRARY = { colours: COLOURS, textures: TEXTURES };

/**
 * An image file as a texture: scaled down to at most 1024 pixels (to keep documents small) and
 * sized 1 m across by default, keeping the picture's proportions.
 */
export async function textureFromFile(file: File): Promise<{ name: string; image: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const [c, ctx] = canvas(w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const image = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
    return { name: file.name.replace(/\.[^.]+$/, '') || 'Texture', image, width: 1000, height: (1000 * h) / w };
  } catch {
    throw new Error(`Could not read "${file.name}" as an image`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
