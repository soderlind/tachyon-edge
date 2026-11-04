/**
 * Tachyon Edge: a Cloudflare Worker that serves the Tachyon WordPress plugin's
 * URL contract (ADR 0006) with the Cloudflare Images binding (ADR 0007).
 */
/* eslint-disable no-console -- Workers Logs is the observability channel. */
import type { Bucket, Context, Images } from './bindings.js';
import { parseRequest, type TachyonRequest } from './contract.js';
import { orientationTransforms, plan, PlanError, type Source } from './geometry.js';
import { fetchOriginal, originIdentity, storageKey } from './origin.js';
import { probe, toSource } from './probe.js';
import { secondsUntilExpiry, verifyPresign, type SigningConfig } from './sigv4.js';

export interface Env {
	IMAGES: Images;
	BUCKET?: Bucket;
	TACHYON_R2_BUCKET?: string;
	TACHYON_ORIGIN?: string;
	TACHYON_HTTP_ORIGIN?: string;
	TACHYON_KEY_PREFIX?: string;
	TACHYON_PRIVATE_PREFIXES?: string;
	TACHYON_SIGNING_ACCESS_KEY_ID?: string;
	TACHYON_SIGNING_SECRET_ACCESS_KEY?: string;
	TACHYON_SIGNING_HOST?: string;
	TACHYON_SIGNING_PATH_PREFIX?: string;
}

/** Bump when output for an unchanged URL and Original changes, to invalidate cached Variants. */
export const PROCESSING_VERSION = 'edge-images-3';

/** Cloudflare Images binding input limit; larger Originals are served unmodified. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

const DEFAULT_MAX_AGE = 31536000;

const EXTENSION_TYPES: Record<string, string> = {
	gif: 'image/gif',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	avif: 'image/avif',
};

/**
 *
 */
class HttpError extends Error {
	constructor( readonly status: number, readonly body: string, readonly contentType: string, readonly reason?: string ) {
		super( reason || body );
	}
}

/**
 *
 */
const notFound = () => new HttpError( 404, 'File not found.', 'text/html' );
/**
 *
 */
const internalError = ( reason: string ) => new HttpError( 500, 'Internal Server Error', 'text/plain; charset=utf-8', reason );

/**
 *
 */
function signingConfig( env: Env ): SigningConfig | undefined {
	const { TACHYON_SIGNING_ACCESS_KEY_ID: accessKeyId, TACHYON_SIGNING_SECRET_ACCESS_KEY: secretAccessKey, TACHYON_SIGNING_HOST: host } = env;
	if ( ! accessKeyId || ! secretAccessKey || ! host ) {
		return undefined;
	}
	return {
		accessKeyId,
		secretAccessKey,
		host,
		pathPrefix: env.TACHYON_SIGNING_PATH_PREFIX || '',
	};
}

/** Private prefixes match the storage key, so they hold regardless of `TACHYON_KEY_PREFIX`. */
function isPrivate( env: Env, key: string ): boolean {
	const stored = storageKey( env, key );
	return ( env.TACHYON_PRIVATE_PREFIXES || '' )
		.split( ',' )
		.map( prefix => prefix.trim() )
		.some( prefix => prefix && stored.startsWith( prefix ) );
}

/** Enforce presign expiry and verification (ADR 0009). Returns the max-age for the response. */
async function authorize( env: Env, request: TachyonRequest, now: number ): Promise<number> {
	const { presign, key } = request;
	const config = signingConfig( env );
	const privateKey = isPrivate( env, key );

	if ( privateKey && ! config ) {
		console.error( 'Tachyon private prefixes are configured without signing credentials' );
		throw notFound();
	}
	if ( privateKey && ! presign ) {
		throw notFound();
	}
	if ( ! presign ) {
		return DEFAULT_MAX_AGE;
	}

	const remaining = secondsUntilExpiry( presign, now );
	if ( remaining !== undefined && remaining <= 0 ) {
		throw notFound();
	}
	if ( config && ! await verifyPresign( presign, key, config, now ) ) {
		throw notFound();
	}
	return remaining ?? DEFAULT_MAX_AGE;
}

/**
 *
 */
async function cacheKey( request: Request, env: Env, webp: boolean ): Promise<Request> {
	const variant = JSON.stringify( [ PROCESSING_VERSION, originIdentity( env ), webp ] );
	const digest = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( variant ) );
	const hash = Array.from( new Uint8Array( digest ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	const url = new URL( request.url );
	url.searchParams.append( '__tachyon_variant', hash );
	return new Request( url.toString() );
}

/**
 *
 */
function defaultCache(): Cache | undefined {
	return ( globalThis as { caches?: { default?: Cache } } ).caches?.default;
}

/**
 *
 */
function bytesStream( bytes: Uint8Array ): ReadableStream<Uint8Array> {
	return new Response( bytes ).body!;
}

/** Determine the planner Source, falling back to the binding for formats the header probe cannot size. */
async function describe( env: Env, bytes: Uint8Array ): Promise<Source> {
	const probed = probe( bytes );
	if ( ! probed ) {
		throw internalError( 'Original is not a supported image' );
	}
	if ( probed.width && probed.height ) {
		return toSource( probed.format, probed.width, probed.height, probed.orientation );
	}
	const info = await env.IMAGES.info( bytesStream( bytes ) );
	if ( ! info.width || ! info.height ) {
		throw internalError( 'Images binding could not size the Original' );
	}
	return toSource( probed.format, info.width, info.height, probed.orientation );
}

/**
 *
 */
async function serve( request: Request, env: Env, context: Context ): Promise<Response> {
	let tachyon: TachyonRequest;
	try {
		tachyon = parseRequest( request );
	} catch {
		throw internalError( 'Malformed request path' );
	}

	const now = Date.now() / 1000;
	const maxAge = await authorize( env, tachyon, now );
	const headers = new Headers( {
		'Cache-Control': `max-age=${ maxAge }`,
		'Last-Modified': new Date( now * 1000 ).toUTCString(),
	} );

	const cache = request.method === 'GET' && ! tachyon.presign && ! isPrivate( env, tachyon.key ) ? defaultCache() : undefined;
	const key = cache ? await cacheKey( request, env, tachyon.webp ) : undefined;
	if ( cache && key ) {
		try {
			const hit = await cache.match( key );
			if ( hit ) {
				const fresh = new Headers( hit.headers );
				fresh.set( 'Last-Modified', headers.get( 'Last-Modified' )! );
				return new Response( hit.body, {
					status: hit.status,
					headers: fresh,
				} );
			}
		} catch ( error ) {
			console.error( 'Tachyon cache read failed', error instanceof Error ? error.name : 'UnknownError' );
		}
	}

	const original = await fetchOriginal( env, tachyon.key );
	if ( original.status === 'not-found' ) {
		throw notFound();
	}
	if ( original.status === 'error' ) {
		throw new HttpError( 502, 'Bad Gateway', 'text/plain; charset=utf-8', original.reason );
	}

	let response: Response;
	if ( original.size !== undefined && original.size > MAX_INPUT_BYTES ) {
		response = passthrough( original.body, tachyon.key, headers );
	} else {
		const read = await readAtMost( original.body, MAX_INPUT_BYTES );
		response = 'bytes' in read
			? await transform( env, read.bytes, tachyon, headers )
			: passthrough( read.stream, tachyon.key, headers );
	}

	if ( cache && key ) {
		context.waitUntil( cache.put( key, response.clone() ).catch( error => {
			console.error( 'Tachyon cache write failed', error instanceof Error ? error.name : 'UnknownError' );
		} ) );
	}
	return response;
}

/**
 * Buffer a body of unknown length up to `limit` bytes. When it is larger, stop
 * reading and return a stream of the buffered prefix followed by the remainder.
 */
async function readAtMost( body: ReadableStream<Uint8Array>, limit: number ): Promise<{ bytes: Uint8Array } | { stream: ReadableStream<Uint8Array> }> {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for ( ;; ) {
		const { done, value } = await reader.read();
		if ( done ) {
			break;
		}
		chunks.push( value );
		total += value.byteLength;
		if ( total > limit ) {
			return {
				stream: new ReadableStream<Uint8Array>( {
					/**
					 *
					 */
					start( controller ) {
						chunks.forEach( chunk => controller.enqueue( chunk ) );
						chunks.length = 0;
					},
					/**
					 *
					 */
					async pull( controller ) {
						const next = await reader.read();
						if ( next.done ) {
							controller.close();
						} else {
							controller.enqueue( next.value );
						}
					},
					/**
					 *
					 */
					cancel( reason ) {
						return reader.cancel( reason );
					},
				} ),
			};
		}
	}
	const bytes = new Uint8Array( total );
	let offset = 0;
	for ( const chunk of chunks ) {
		bytes.set( chunk, offset );
		offset += chunk.byteLength;
	}
	return { bytes };
}

/** Serve an Original the Images binding cannot accept, unmodified (documented deviation). */
function passthrough( body: ReadableStream<Uint8Array>, key: string, headers: Headers ): Response {
	const extension = key.split( '.' ).pop()?.toLowerCase() || '';
	headers.set( 'Content-Type', EXTENSION_TYPES[extension] || 'application/octet-stream' );
	return new Response( body, {
		status: 200,
		headers,
	} );
}

/**
 *
 */
async function transform( env: Env, bytes: Uint8Array, tachyon: TachyonRequest, headers: Headers ): Promise<Response> {
	const source = await describe( env, bytes );
	let planned;
	try {
		planned = plan( source, tachyon.args, tachyon.webp );
	} catch ( error ) {
		throw error instanceof PlanError ? internalError( error.message ) : error;
	}

	let transformer = env.IMAGES.input( bytesStream( bytes ) );
	for ( const step of [ ...orientationTransforms( source ), ...planned.transforms ] ) {
		transformer = transformer.transform( step );
	}
	let result;
	try {
		result = await transformer.output( {
			format: planned.format,
			quality: planned.quality,
			// The binding rejects `anim` for formats that cannot animate.
			anim: planned.format === 'image/gif' || planned.format === 'image/webp',
		} );
	} catch ( error ) {
		// Binding errors describe the operation, never the request URL or secrets.
		const { code, message } = error as { code?: number; message?: string };
		throw internalError( `Images binding failed${ code ? ` (${ code })` : '' }: ${ message || 'unknown' }` );
	}
	headers.set( 'Content-Type', result.contentType() );
	return new Response( result.image(), {
		status: 200,
		headers,
	} );
}

/** Handle a Tachyon request. */
export async function handleRequest( request: Request, env: Env, context: Context ): Promise<Response> {
	try {
		return await serve( request, env, context );
	} catch ( error ) {
		const failure = error instanceof HttpError ? error : internalError( error instanceof Error ? error.name : 'UnknownError' );
		if ( failure.status >= 500 ) {
			console.error( 'Tachyon request failed', failure.status, failure.reason || failure.message );
		}
		const headers: Record<string, string> = { 'Content-Type': failure.contentType };
		if ( failure.status >= 500 ) {
			headers['Cache-Control'] = 'no-store';
		}
		return new Response( failure.body, {
			status: failure.status,
			headers,
		} );
	}
}

const worker = {
	fetch: handleRequest,
};

export default worker;
