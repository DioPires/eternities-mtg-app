/**
 * Types for `png-sample.mjs`.
 */

export interface DecodedPng {
  readonly width: number
  readonly height: number
  /** RGBA, 4 bytes per pixel, row-major. Alpha is 255 throughout for a colour-type-2 source. */
  readonly data: Buffer
}

export declare function decodePng(png: Buffer): DecodedPng

export declare function samplePixel(
  image: DecodedPng,
  x: number,
  y: number,
  scale?: number,
): [number, number, number]
