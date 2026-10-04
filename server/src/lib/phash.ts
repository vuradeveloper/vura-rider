// server/src/lib/phash.ts
// Lightweight image similarity for driver face verification.
//
// Decodes JPEG/PNG buffers (pure-JS decoders, no native deps), downscales to
// 32x32 grayscale and computes a 64-bit DCT perceptual hash. Two photos of
// the same face produce hashes with a small Hamming distance; different
// people produce a large one. This is deliberately a local, privacy-friendly
// gate — the face photos never leave our S3 bucket. Swap in a proper face
// matcher (e.g. AWS Rekognition CompareFaces) behind the same
// `compareFaceImages` seam if stricter 1:1 face matching is needed.

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

function decodeImage(buffer: Buffer): { width: number; height: number; data: Uint8Array | Buffer } {
  const isPng =
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;

  if (isPng) {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, data: png.data };
  }

  // Fall back to JPEG (jpeg-js also tolerates raw JPEG streams).
  const raw = jpeg.decode(buffer, { useTArray: true });
  return { width: raw.width, height: raw.height, data: raw.data };
}

/** Converts any base64 / data-URL string into a raw byte Buffer. */
export function toImageBuffer(data: string): Buffer {
  const cleaned = data.includes(",") ? data.split(",")[1] : data;
  return Buffer.from(cleaned, "base64");
}

function toGrayscale32(buf: Buffer): number[] {
  const { width, height, data } = decodeImage(buf);
  const size = 32;
  const gray: number[] = new Array(size * size);
  const wStep = width / size;
  const hStep = height / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = Math.min(width - 1, Math.floor((x + 0.5) * wStep));
      const py = Math.min(height - 1, Math.floor((y + 0.5) * hStep));
      const idx = (py * width + px) * 4;
      // Rec. 601 luma from RGBA
      const lum =
        0.299 * data[idx] +
        0.587 * data[idx + 1] +
        0.114 * data[idx + 2];
      gray[y * size + x] = lum;
    }
  }
  return gray;
}

const DCT_MATRIX = (() => {
  const n = 32;
  const m: number[][] = [];
  const c = new Array(n).fill(0).map((_, i) => (i === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n)));
  for (let u = 0; u < n; u++) {
    m.push([]);
    for (let x = 0; x < n; x++) {
      m[u][x] = c[u] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
    }
  }
  return m;
})();

/** 64-bit DCT perceptual hash of an image buffer, as a 16-char hex string. */
export function phash(buffer: Buffer): string {
  return hashImage(buffer).hash;
}

export function hammingDistance(a: string, b: string): number {
  const ha = BigInt(`0x${a}`);
  const hb = BigInt(`0x${b}`);
  let diff = ha ^ hb;
  let count = 0;
  while (diff > 0n) {
    diff &= diff - 1n;
    count++;
  }
  return count;
}

export interface FaceComparison {
  verified: boolean;
  /** Similarity in 0..1 (1 = identical). */
  score: number;
  hammingDistance: number;
  /** True when either image has too little detail for a reliable hash. */
  degenerate?: boolean;
}

const MAX_HAMMING_FOR_MATCH = 16; // similarity >= 0.75

interface HashedImage {
  hash: string;
  degenerate: boolean;
}

function hashImage(buffer: Buffer): HashedImage {
  const size = 32;
  const gray = toGrayscale32(buffer);

  // Reject near-flat images (solid colours, blown-out frames) — pHash has no
  // meaningful texture to compare there and would report false matches.
  let min = 255;
  let max = 0;
  for (const g of gray) {
    if (g < min) min = g;
    if (g > max) max = g;
  }
  if (max - min < 8) {
    return { hash: "0000000000000000", degenerate: true };
  }

  return { hash: phashFromGray(gray), degenerate: false };
}

function phashFromGray(gray: number[]): string {
  const size = 32;
  // 2D DCT (separable)
  const dct: number[] = new Array(8 * 8).fill(0);
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < size; y++) {
        const rowSum = gray
          .slice(y * size, y * size + size)
          .reduce((acc, g, x) => acc + g * DCT_MATRIX[u][x], 0);
        sum += rowSum * DCT_MATRIX[v][y];
      }
      dct[v * 8 + u] = sum;
    }
  }

  // Ignore the DC coefficient when computing the median threshold.
  const ac = dct.slice(1);
  const sorted = [...ac].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (dct[i] > median) hash |= 1n << BigInt(63 - i);
  }
  return hash.toString(16).padStart(16, "0");
}

export function compareFaceImages(enrolled: Buffer, selfie: Buffer): FaceComparison {
  const h1 = hashImage(enrolled);
  const h2 = hashImage(selfie);

  if (h1.degenerate || h2.degenerate) {
    // Fail closed — a blank/blurry frame proves nothing about identity.
    return { verified: false, score: 0, hammingDistance: 64, degenerate: true };
  }

  const hamming = hammingDistance(h1.hash, h2.hash);
  const score = Math.max(0, 1 - hamming / 64);
  return { verified: hamming <= MAX_HAMMING_FOR_MATCH, score, hammingDistance: hamming };
}
