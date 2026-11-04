/**
 * Compile-time proof (via `npm run check:worker`) that the real Cloudflare
 * bindings satisfy the structural interfaces in bindings.ts.
 */
import type { Bucket, Context, Images } from './bindings.js';
import type { OutputFormat, Transform } from './geometry.js';

export type BindingsSatisfied = [
	ImagesBinding extends Images ? true : never,
	R2Bucket extends Bucket ? true : never,
	ExecutionContext extends Context ? true : never,
	Transform extends ImageTransform ? true : never,
	OutputFormat extends ImageOutputOptions['format'] ? true : never,
];

export const bindingsSatisfied: BindingsSatisfied = [ true, true, true, true, true ];
