// Front pictures (a Pokémon, the player) read from the player's own ROM while the app runs.
// Nothing here is stored: pictures are decoded on request and kept in memory only.
import { toPng } from '../emu/png.js';
import type { Rom } from './rom.js';
import { sym } from './symbols.js';

/** A picture on the game's 7×7-tile canvas: 56×56 shades, 0 = lightest (background) … 3 = darkest. */
export interface Pic { w: 56; h: 56; pixels: Uint8Array }

const SIDE = 56;
/** Shades 1–3 as RGB; shade 0 is transparent so the page's tile colour shows through. */
const SHADES = [[0, 0, 0], [0xa8, 0xc0, 0x70], [0x50, 0x78, 0x48], [0x22, 0x36, 0x1f]];

/** Reads the picture stream one bit at a time, most significant bit first. */
class Bits {
  private bit = 0;
  constructor(private b: Uint8Array, private at: number) {}
  byte(): number { return this.b[this.at++]; }
  next(): number {
    const v = (this.b[this.at] >> (7 - this.bit)) & 1;
    if (++this.bit === 8) { this.bit = 0; this.at++; }
    return v;
  }
}

/**
 * The game's picture decompression (its UncompressSpriteData routine), returning the two bit planes.
 * A plane is stored column by column: byte (xByte * heightPx + y) holds 8 pixels of row y.
 */
function unpack(b: Uint8Array, at: number): { wTiles: number; hTiles: number; planes: [Uint8Array, Uint8Array] } {
  const bits = new Bits(b, at);
  const dims = bits.byte();
  const wTiles = dims >> 4, hTiles = dims & 15;
  if (!wTiles || !hTiles || wTiles > 7 || hTiles > 7) throw new Error('not a picture');
  const H = hTiles * 8, size = wTiles * H;
  const planes: [Uint8Array, Uint8Array] = [new Uint8Array(size), new Uint8Array(size)];

  /** One plane: pairs of bits, either literal or runs of zero pairs, written down each quarter-byte column. */
  const chunk = (out: Uint8Array) => {
    const total = wTiles * 4 * H; // pairs in the plane
    let n = 0;
    const put = (pair: number) => {
      const col = Math.floor(n / H), y = n % H;
      out[(col >> 2) * H + y] |= pair << (6 - 2 * (col & 3));
      n++;
    };
    let zeros = bits.next() === 0;
    while (n < total) {
      if (zeros) {
        let len = 0;
        while (bits.next()) len++;
        let extra = 0;
        for (let i = 0; i <= len; i++) extra = (extra << 1) | bits.next();
        for (let run = (2 << len) - 1 + extra; run > 0 && n < total; run--) put(0);
        zeros = false;
      } else {
        const pair = (bits.next() << 1) | bits.next();
        if (pair === 0) zeros = true; else put(pair);
      }
    }
  };

  /** Along each row, a 1 bit means "different from the pixel to the left". */
  const undelta = (p: Uint8Array) => {
    for (let y = 0; y < H; y++) {
      let state = 0;
      for (let x = 0; x < wTiles; x++) {
        const i = x * H + y;
        let v = 0;
        for (let k = 7; k >= 0; k--) { state ^= (p[i] >> k) & 1; v |= state << k; }
        p[i] = v;
      }
    }
  };

  const first = bits.next();            // which plane comes first in the stream
  chunk(planes[first]);
  const mode = bits.next() === 0 ? 0 : 1 + bits.next();
  const second = first ^ 1;
  chunk(planes[second]);
  undelta(planes[first]);
  if (mode !== 1) undelta(planes[second]);
  if (mode !== 0) for (let i = 0; i < size; i++) planes[second][i] ^= planes[first][i];
  return { wTiles, hTiles, planes };
}

/** Place a decoded picture on the 7×7-tile canvas the way the game does: centred, standing on the bottom edge. */
function place(b: Uint8Array, at: number): Pic {
  const { wTiles, hTiles, planes } = unpack(b, at);
  const H = hTiles * 8;
  const pixels = new Uint8Array(SIDE * SIDE);
  const ox = ((8 - wTiles) >> 1) * 8, oy = (7 - hTiles) * 8;
  for (let xb = 0; xb < wTiles; xb++) for (let y = 0; y < H; y++) {
    const lo = planes[0][xb * H + y], hi = planes[1][xb * H + y];
    for (let k = 0; k < 8; k++) {
      const x = ox + xb * 8 + k;
      if (x < SIDE) pixels[(oy + y) * SIDE + x] = ((lo >> (7 - k)) & 1) | (((hi >> (7 - k)) & 1) << 1);
    }
  }
  return { w: 56, h: 56, pixels };
}

function png(p: Pic): Buffer {
  const rgba = new Uint8Array(SIDE * SIDE * 4);
  for (let i = 0; i < p.pixels.length; i++) {
    const s = p.pixels[i];
    rgba.set([...SHADES[s], s === 0 ? 0 : 255], i * 4);
  }
  return toPng(rgba, SIDE, SIDE, 2, true);
}

export class Pics {
  private byName = new Map<string, number>();
  private pngs = new Map<string, Buffer>();

  constructor(private rom: Rom) {
    for (const s of rom.species.values()) this.byName.set(s.name, s.id);
  }

  /** Where a species' front picture starts in the ROM, from its base-stats header and the game's own bank rule. */
  frontAddress(speciesId: number): number {
    const sp = this.rom.species.get(speciesId);
    if (!sp) throw new Error(`unknown species ${speciesId}`);
    const header = sp.dex === 151 ? sym('MewBaseStats') : sym('BaseStats') + (sp.dex - 1) * 28;
    const ptr = this.rom.b[header + 11] | (this.rom.b[header + 12] << 8);
    const bank = sp.dex === 151 ? 0x01 : speciesId < 0x1f ? 0x09 : speciesId < 0x4a ? 0x0a : speciesId < 0x74 ? 0x0b : speciesId < 0x99 ? 0x0c : 0x0d;
    return this.rom.flat(bank, ptr);
  }

  mon(speciesId: number): Pic { return place(this.rom.b, this.frontAddress(speciesId)); }
  trainer(): Pic { return place(this.rom.b, sym('RedPicFront')); }

  /** PNG for a species by the name the snapshot uses, or null if there is no such species. */
  monPng(speciesName: string): Buffer | null {
    const id = this.byName.get(speciesName);
    if (id === undefined) return null;
    let out = this.pngs.get(speciesName);
    if (!out) { out = png(this.mon(id)); this.pngs.set(speciesName, out); }
    return out;
  }

  trainerPng(): Buffer {
    let out = this.pngs.get('\0trainer');
    if (!out) { out = png(this.trainer()); this.pngs.set('\0trainer', out); }
    return out;
  }
}
