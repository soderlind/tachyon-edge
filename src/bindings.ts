/**
 * The binding surface Tachyon Edge uses. Structural subsets of the Workers
 * types, so tests can supply fakes without the Workers runtime.
 */
import type { OutputFormat, Transform } from './geometry.js';

export interface Bucket {
	get( key: string ): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
}

export interface ImagesTransformer {
	transform( transform: Transform ): ImagesTransformer;
	output( options: { format: OutputFormat; quality?: number; anim?: boolean } ): Promise<{
		contentType(): string;
		image(): ReadableStream<Uint8Array>;
	}>;
}

export interface Images {
	info( stream: ReadableStream<Uint8Array> ): Promise<{ format: string; width?: number; height?: number }>;
	input( stream: ReadableStream<Uint8Array> ): ImagesTransformer;
}

export interface Context {
	waitUntil( promise: Promise<unknown> ): void;
}
