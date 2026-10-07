import { open, stat } from 'node:fs/promises';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = Buffer.from('IHDR');
/** A zero-length IEND chunk including its fixed CRC. */
const IEND_CHUNK = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
/** signature (8) + IHDR chunk (25) + IEND chunk (12) */
export const MIN_PNG_BYTES = 45;

/** Checks the signature, the IHDR chunk header and the trailing IEND chunk. */
export function isValidPngHeadTail(head: Buffer, tail: Buffer, size: number): boolean {
  if (size < MIN_PNG_BYTES || head.length < 16 || tail.length < 12) return false;
  if (!head.subarray(0, 8).equals(SIGNATURE)) return false;
  if (!head.subarray(12, 16).equals(IHDR)) return false;
  return tail.subarray(tail.length - 12).equals(IEND_CHUNK);
}

export function isValidPngBuffer(buf: Buffer): boolean {
  return isValidPngHeadTail(buf.subarray(0, 16), buf.subarray(Math.max(0, buf.length - 12)), buf.length);
}

/** Cheap validity check used for resume: reads only the first 16 and last 12 bytes. */
export async function isValidPngFile(file: string): Promise<boolean> {
  try {
    const st = await stat(file);
    if (!st.isFile() || st.size < MIN_PNG_BYTES) return false;
    const fh = await open(file, 'r');
    try {
      const head = Buffer.alloc(16);
      const tail = Buffer.alloc(12);
      await fh.read(head, 0, 16, 0);
      await fh.read(tail, 0, 12, st.size - 12);
      return isValidPngHeadTail(head, tail, st.size);
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}
