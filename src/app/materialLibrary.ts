import type { MaterialFields } from '../doc/Materials';

/**
 * Ready-made materials: plain colours, and textures drawn here on a canvas (our own artwork, made
 * when the library is first shown). Texture sizes are real-world millimetres per tile.
 */
export interface LibraryEntry {
  key: string;
  /** The heading it is shown under (Neutrals, Warm…; Wood, Stone…). */
  group: string;
  fields: () => MaterialFields;
}

const colour = (group: string, name: string, color: string, opacity = 1): LibraryEntry => ({ key: `colour:${name}`, group, fields: () => ({ name, color, opacity }) });

const COLOURS: LibraryEntry[] = [
  colour('Neutrals', 'White', '#f4f3ef'),
  colour('Neutrals', 'Cream', '#ece3cf'),
  colour('Neutrals', 'Light Grey', '#c4c5c7'),
  colour('Neutrals', 'Grey', '#86888c'),
  colour('Neutrals', 'Charcoal', '#3b3d41'),
  colour('Neutrals', 'Black', '#151515'),
  colour('Neutrals', 'Sand', '#d8c39a'),
  colour('Neutrals', 'Brown', '#7b4a2a'),
  colour('Warm', 'Red', '#c0392b'),
  colour('Warm', 'Maroon', '#7a2430'),
  colour('Warm', 'Orange', '#e07b25'),
  colour('Warm', 'Terracotta', '#b8653f'),
  colour('Warm', 'Yellow', '#efc23a'),
  colour('Warm', 'Pink', '#e591b2'),
  colour('Cool', 'Olive', '#7a7d3a'),
  colour('Cool', 'Green', '#3f8f4a'),
  colour('Cool', 'Mint', '#9fd8b8'),
  colour('Cool', 'Teal', '#1f8a8a'),
  colour('Cool', 'Sky Blue', '#8cc4ea'),
  colour('Cool', 'Blue', '#2d6cc0'),
  colour('Cool', 'Navy', '#1f2f5a'),
  colour('Cool', 'Purple', '#7d4fa0'),
  colour('See-through', 'Glass', '#9fd0e6', 0.35),
  colour('See-through', 'Frosted Glass', '#e4eef2', 0.6),
  colour('See-through', 'Tinted Glass', '#4d5a62', 0.45),
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

/** Dark wood planks (walnut), like Wood Planks but narrower boards (1200 × 480 mm). */
function darkWood(): string {
  const [c, ctx] = canvas(480, 192);
  const rnd = random(17);
  for (let b = 0; b < 4; b++) {
    const base: [number, number, number] = [104 + (rnd() - 0.5) * 18, 70 + (rnd() - 0.5) * 14, 48 + (rnd() - 0.5) * 10];
    ctx.fillStyle = shade(base, 0);
    ctx.fillRect(0, b * 48, 480, 48);
    for (let g = 0; g < 16; g++) {
      ctx.strokeStyle = shade(base, -14 - rnd() * 18);
      ctx.lineWidth = 0.5 + rnd();
      ctx.beginPath();
      const y0 = b * 48 + rnd() * 48;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= 480; x += 40) ctx.lineTo(x, y0 + Math.sin(x / 60 + g) * 2 * rnd());
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,18,10,0.6)';
    ctx.fillRect(0, b * 48, 480, 1.5);
    ctx.fillRect(rnd() * 480, b * 48, 1.5, 48);
  }
  return c.toDataURL('image/jpeg', 0.88);
}

/** White marble with soft grey veins (600 mm square). */
function marble(): string {
  const [c, ctx] = canvas(256, 256);
  const rnd = random(23);
  ctx.fillStyle = '#eeece8';
  ctx.fillRect(0, 0, 256, 256);
  for (let v = 0; v < 7; v++) {
    ctx.strokeStyle = `rgba(110,112,118,${0.15 + rnd() * 0.25})`;
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    let x = rnd() * 256;
    let y = 0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (y < 256) {
      x += (rnd() - 0.45) * 18;
      y += 6 + rnd() * 10;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  speckle(ctx, 256, 256, 800, 0.05, rnd);
  return c.toDataURL('image/jpeg', 0.9);
}

/** Square stone paving slabs, 600 mm with 10 mm joints (four slabs per 1200 mm tile). */
function paving(): string {
  const [c, ctx] = canvas(240, 240);
  const rnd = random(29);
  ctx.fillStyle = '#7d7a73';
  ctx.fillRect(0, 0, 240, 240);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = shade([168, 163, 152], (rnd() - 0.5) * 22);
      ctx.fillRect(i * 120 + 1, j * 120 + 1, 118, 118);
    }
  }
  speckle(ctx, 240, 240, 3000, 0.16, rnd);
  return c.toDataURL('image/jpeg', 0.88);
}

/** Loose gravel (500 mm square). */
function gravel(): string {
  const [c, ctx] = canvas(256, 256);
  const rnd = random(31);
  ctx.fillStyle = '#8c857a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = shade([150, 142, 130], (rnd() - 0.5) * 80);
    ctx.beginPath();
    ctx.ellipse(rnd() * 256, rnd() * 256, 1.5 + rnd() * 3, 1 + rnd() * 2.5, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return c.toDataURL('image/jpeg', 0.85);
}

/** Brushed metal: fine streaks along u (500 mm square). */
function brushedMetal(): string {
  const [c, ctx] = canvas(256, 256);
  const rnd = random(37);
  ctx.fillStyle = '#b4b8bc';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + rnd() * 0.08})`;
    ctx.fillRect(rnd() * 256 - 60, rnd() * 256, 40 + rnd() * 160, 1);
  }
  return c.toDataURL('image/jpeg', 0.9);
}

/** A plain-weave fabric (100 mm square). */
function fabric(): string {
  const [c, ctx] = canvas(128, 128);
  const rnd = random(41);
  ctx.fillStyle = '#8d8f95';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 4) {
    for (let x = 0; x < 128; x += 4) {
      const over = ((x + y) / 4) % 2 === 0;
      ctx.fillStyle = shade([141, 143, 149], (over ? 10 : -10) + (rnd() - 0.5) * 8);
      ctx.fillRect(x, y, over ? 4 : 3, over ? 3 : 4);
    }
  }
  return c.toDataURL('image/jpeg', 0.9);
}

const texture = (group: string, name: string, color: string, draw: () => string, width: number, height: number): LibraryEntry => {
  let image: string | null = null;
  return {
    key: `texture:${name}`,
    group,
    fields: () => ({ name, color, opacity: 1, texture: { image: (image ??= draw()), width, height } }),
  };
};

const TEXTURES: LibraryEntry[] = [
  texture('Wood', 'Wood Planks', '#b0805a', wood, 1200, 600),
  texture('Wood', 'Dark Wood', '#684632', darkWood, 1200, 480),
  texture('Stone and brick', 'Brick', '#96483a', brick, 440, 150),
  texture('Stone and brick', 'Concrete', '#a7a6a2', concrete, 1000, 1000),
  texture('Stone and brick', 'Tiles', '#e6e3dc', tiles, 300, 300),
  texture('Stone and brick', 'Marble', '#eeece8', marble, 600, 600),
  texture('Stone and brick', 'Paving', '#a8a398', paving, 1200, 1200),
  texture('Ground', 'Grass', '#4f7d33', grass, 1000, 1000),
  texture('Ground', 'Gravel', '#8c857a', gravel, 500, 500),
  texture('Metal and fabric', 'Brushed Metal', '#b4b8bc', brushedMetal, 500, 500),
  texture('Metal and fabric', 'Fabric', '#8d8f95', fabric, 100, 100),
];

export const LIBRARY = { colours: COLOURS, textures: TEXTURES };

/**
 * An image file as a texture: scaled down to at most 1024 pixels (to keep documents small) and
 * sized 1 m across by default, keeping the picture's proportions.
 */
/** An image (data URL) scaled down to at most 1024 pixels, to keep documents small; unchanged if smaller or unreadable. */
export async function shrinkImage(dataUrl: string): Promise<string> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const k = 1024 / Math.max(img.naturalWidth, img.naturalHeight);
    if (k >= 1) return dataUrl;
    const [c, ctx] = canvas(Math.max(1, Math.round(img.naturalWidth * k)), Math.max(1, Math.round(img.naturalHeight * k)));
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return dataUrl.startsWith('data:image/png') ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
  } catch {
    return dataUrl;
  }
}

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
