/** Converts any base64 / data-URL string into a raw byte Buffer. */
export declare function toImageBuffer(data: string): Buffer;
/** 64-bit DCT perceptual hash of an image buffer, as a 16-char hex string. */
export declare function phash(buffer: Buffer): string;
export declare function hammingDistance(a: string, b: string): number;
export interface FaceComparison {
    verified: boolean;
    /** Similarity in 0..1 (1 = identical). */
    score: number;
    hammingDistance: number;
    /** True when either image has too little detail for a reliable hash. */
    degenerate?: boolean;
}
export declare function compareFaceImages(enrolled: Buffer, selfie: Buffer): FaceComparison;
//# sourceMappingURL=phash.d.ts.map