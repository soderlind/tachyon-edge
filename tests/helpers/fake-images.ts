/**
 * A Sharp-backed stand-in for the Cloudflare Images binding, implementing the
 * documented semantics of the operations the planner emits. Local `wrangler dev`
 * only simulates width/height, so contract tests run against this fake; the
 * remote smoke test (ADR 0011) checks the real binding.
 */
import sharp from 'sharp';

import type { Images, ImagesTransformer } from '../../src/bindings';
import type { OutputFormat, Transform } from '../../src/geometry';

export interface FakeImages extends Images {
	calls: { transforms: Transform[]; output: { format: OutputFormat; quality?: number; anim?: boolean } }[];
	infoCalls: number;
}

/**
 *
 */
async function read( stream: ReadableStream<Uint8Array> ): Promise<Buffer> {
	return Buffer.from( await new Response( stream ).arrayBuffer() );
}

/** Apply one transform to a single-frame or animated image. */
async function apply( input: Buffer, step: Transform ): Promise<Buffer> {
	const image = sharp( input, { animated: true } );
	const meta = await image.metadata();
	const width = meta.width!;
	const height = meta.pageHeight || meta.height!;
	if ( step.trim ) {
		const { top, right, bottom, left } = step.trim;
		return image.extract( {
			left,
			top,
			width: width - left - right,
			height: height - top - bottom,
		} ).toBuffer();
	}
	if ( step.border ) {
		const { top, right, bottom, left, color } = step.border;
		return image.extend( {
			top,
			right,
			bottom,
			left,
			background: color,
		} ).toBuffer();
	}
	if ( step.fit === 'squeeze' ) {
		return image.resize( {
			width: step.width,
			height: step.height,
			fit: 'fill',
		} ).toBuffer();
	}
	if ( step.fit === 'cover' ) {
		const gravity = step.gravity!;
		if ( gravity === 'auto' ) {
			return image.resize( {
				width: step.width,
				height: step.height,
				fit: 'cover',
				position: 'attention',
			} ).toBuffer();
		}
		// Cover scales to fill the box, then crops; `remainder` places the remaining space by x/y.
		const scale = Math.max( step.width! / width, step.height! / height );
		const sw = Math.max( step.width!, Math.round( width * scale ) );
		const sh = Math.max( step.height!, Math.round( height * scale ) );
		const scaled = await image.resize( {
			width: sw,
			height: sh,
			fit: 'fill',
		} ).toBuffer();
		return sharp( scaled, { animated: true } ).extract( {
			left: Math.round( ( sw - step.width! ) * gravity.x ),
			top: Math.round( ( sh - step.height! ) * gravity.y ),
			width: step.width!,
			height: step.height!,
		} ).toBuffer();
	}
	throw new Error( `Fake Images binding does not implement ${ JSON.stringify( step ) }` );
}

/**
 *
 */
export function fakeImages(): FakeImages {
	const binding: FakeImages = {
		calls: [],
		infoCalls: 0,
		/**
		 *
		 */
		async info( stream ) {
			binding.infoCalls++;
			const meta = await sharp( await read( stream ) ).metadata();
			return {
				format: `image/${ meta.format === 'heif' ? 'avif' : meta.format }`,
				width: meta.width,
				height: meta.pageHeight || meta.height,
			};
		},
		/**
		 *
		 */
		input( stream ) {
			const transforms: Transform[] = [];
			const transformer: ImagesTransformer = {
				/**
				 *
				 */
				transform( step ) {
					transforms.push( step );
					return transformer;
				},
				/**
				 *
				 */
				async output( options ) {
					binding.calls.push( {
						transforms,
						output: options,
					} );
					if ( options.anim && options.format !== 'image/gif' && options.format !== 'image/webp' ) {
						throw Object.assign( new Error( 'IMAGES_TRANSFORM_ERROR 9401: Animated output is only supported for GIF or WebP' ), { code: 9401 } );
					}
					// The binding applies EXIF orientation automatically.
					let data = await sharp( await read( stream ), { animated: true } ).rotate().toBuffer();
					for ( const step of transforms ) {
						data = await apply( data, step );
					}
					const image = sharp( data, { animated: true } );
					const encoded = await {
						/**
						 *
						 */
						'image/jpeg': () => image.jpeg( { quality: options.quality } ),
						/**
						 *
						 */
						'image/png': () => image.png(),
						/**
						 *
						 */
						'image/gif': () => image.gif(),
						/**
						 *
						 */
						'image/webp': () => image.webp( { quality: options.quality } ),
						/**
						 *
						 */
						'image/avif': () => image.avif( { quality: options.quality } ),
					}[options.format]().toBuffer();
					return {
						/**
						 *
						 */
						contentType: () => options.format,
						/**
						 *
						 */
						image: () => new Response( encoded ).body!,
					};
				},
			};
			return transformer;
		},
	};
	return binding;
}
