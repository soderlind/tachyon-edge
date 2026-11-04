/**
 * Original sources (ADR 0008): an R2 binding or an HTTP base URL.
 */
import type { Bucket } from './bindings.js';

export interface OriginEnv {
	TACHYON_ORIGIN?: string;
	BUCKET?: Bucket;
	TACHYON_HTTP_ORIGIN?: string;
	TACHYON_KEY_PREFIX?: string;
}

export type Original =
	| { status: 'found'; body: ReadableStream<Uint8Array>; size?: number }
	| { status: 'not-found' }
	| { status: 'error'; reason: string };

/** Stable identity of the configured Origin, for cache keys. */
export function originIdentity( env: OriginEnv ): string {
	const kind = env.TACHYON_ORIGIN || 'r2';
	return JSON.stringify( [ kind, kind === 'http' ? env.TACHYON_HTTP_ORIGIN : null, env.TACHYON_KEY_PREFIX || '' ] );
}

/** Build the HTTP Origin URL for an Object Key without allowing it to escape the base path. */
export function httpOriginUrl( base: string, key: string ): string | undefined {
	const segments = key.split( '/' );
	if ( segments.some( segment => segment === '.' || segment === '..' ) ) {
		return undefined;
	}
	return `${ base.replace( /\/+$/, '' ) }/${ segments.map( encodeURIComponent ).join( '/' ) }`;
}

/** Fetch an Original by its Object Key. */
export async function fetchOriginal( env: OriginEnv, key: string ): Promise<Original> {
	const storageKey = ( env.TACHYON_KEY_PREFIX || '' ) + key;
	const kind = env.TACHYON_ORIGIN || 'r2';

	if ( kind === 'r2' ) {
		if ( ! env.BUCKET ) {
			return {
				status: 'error',
				reason: 'R2 origin selected but BUCKET is not bound',
			};
		}
		if ( ! storageKey ) {
			return { status: 'not-found' };
		}
		try {
			const object = await env.BUCKET.get( storageKey );
			return object ? {
				status: 'found',
				body: object.body,
				size: object.size,
			} : { status: 'not-found' };
		} catch ( error ) {
			return {
				status: 'error',
				reason: `R2 read failed: ${ error instanceof Error ? error.name : 'UnknownError' }`,
			};
		}
	}

	if ( kind === 'http' ) {
		if ( ! env.TACHYON_HTTP_ORIGIN ) {
			return {
				status: 'error',
				reason: 'HTTP origin selected but TACHYON_HTTP_ORIGIN is not set',
			};
		}
		const url = httpOriginUrl( env.TACHYON_HTTP_ORIGIN, storageKey );
		if ( ! url ) {
			return { status: 'not-found' };
		}
		let response: Response;
		try {
			response = await fetch( url, { headers: { Accept: 'image/*' } } );
		} catch ( error ) {
			return {
				status: 'error',
				reason: `HTTP origin fetch failed: ${ error instanceof Error ? error.name : 'UnknownError' }`,
			};
		}
		if ( response.status === 403 || response.status === 404 ) {
			await response.body?.cancel();
			return { status: 'not-found' };
		}
		if ( ! response.ok || ! response.body ) {
			await response.body?.cancel();
			return {
				status: 'error',
				reason: `HTTP origin returned ${ response.status }`,
			};
		}
		const length = Number( response.headers.get( 'Content-Length' ) );
		return {
			status: 'found',
			body: response.body,
			size: Number.isFinite( length ) && length > 0 ? length : undefined,
		};
	}

	return {
		status: 'error',
		reason: `Unknown TACHYON_ORIGIN "${ kind }"`,
	};
}
