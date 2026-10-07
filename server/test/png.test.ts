import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isValidPngBuffer, isValidPngFile } from '../src/png';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function makePng(extra = 20): Buffer {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const ihdr = Buffer.concat([len, Buffer.from('IHDR'), ihdrData, Buffer.alloc(4)]);
  return Buffer.concat([SIG, ihdr, Buffer.alloc(extra, 1), IEND]);
}

describe('PNG validity', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'png-test-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts a well-formed PNG', async () => {
    const png = makePng();
    expect(isValidPngBuffer(png)).toBe(true);
    const file = path.join(dir, 'ok.png');
    await writeFile(file, png);
    expect(await isValidPngFile(file)).toBe(true);
  });

  it('rejects empty, truncated and wrong-signature files', async () => {
    const png = makePng();
    const cases: Record<string, Buffer> = {
      empty: Buffer.alloc(0),
      truncated: png.subarray(0, png.length - 5),
      noSignature: Buffer.concat([Buffer.alloc(8), png.subarray(8)]),
      noIend: Buffer.concat([png.subarray(0, png.length - 12), Buffer.alloc(12)]),
    };
    for (const [name, buf] of Object.entries(cases)) {
      expect(isValidPngBuffer(buf), name).toBe(false);
      const file = path.join(dir, `${name}.png`);
      await writeFile(file, buf);
      expect(await isValidPngFile(file), name).toBe(false);
    }
  });

  it('returns false for missing files', async () => {
    expect(await isValidPngFile(path.join(dir, 'nope.png'))).toBe(false);
  });
});
