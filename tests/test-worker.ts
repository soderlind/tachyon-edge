import { readFileSync } from 'fs';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import sharp from 'sharp';

import { handleRequest, MAX_INPUT_BYTES, type Env } from '../src/worker';

import { fakeImages } from './helpers/fake-images';
import { resizeBuffer, type Args } from './oracle/tachyon-v3.0.8';

/**
 *
 */
const images = ( name: string ) => readFileSync( `${ __dirname }/images/${ name }` );
const objects = new Map<string, Buffer>();
const FAKE_TIMERS = [ 'nextTick', 'setImmediate', 'queueMicrotask' ] as const;

/**
 *
 */
function bucket() {
	return {
		get: jest.fn( async ( key: string ): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> => {
			const data = objects.get( key );
			return data ? {
				body: new Response( data ).body!,
				size: data.byteLength,
			} : null;
		} ),
	};
}

type TestEnv = Env & { BUCKET: ReturnType<typeof bucket>; IMAGES: ReturnType<typeof fakeImages> };

/**
 *
 */
function env( overrides: Partial<Env> = {} ): TestEnv {
	return {
		IMAGES: fakeImages(),
		BUCKET: bucket(),
		TACHYON_ORIGIN: 'r2',
		...overrides,
	} as TestEnv;
}

/**
 *
 */
async function get( url: string, environment: Env, headers: Record<string, string> = {} ) {
	const pending: Promise<unknown>[] = [];
	const response = await handleRequest(
		new Request( `https://cdn.example.test${ url }`, { headers } ),
		environment,
		{ /**
				 *
				 */
			waitUntil: promise => void pending.push( promise ),
		}
	);
	await Promise.all( pending );
	const body = Buffer.from( await response.arrayBuffer() );
	return {
		response,
		body,
	};
}

/**
 *
 */
async function size( body: Buffer ) {
	const meta = await sharp( body, { animated: true } ).metadata();
	return [ meta.width, meta.pageHeight || meta.height ];
}

beforeAll( async () => {
	objects.set( 'uploads/photo.jpg', images( 'briefing-copywriting.jpg' ) );
	objects.set( 'uploads/site.png', images( 'Website.png' ) );
	objects.set( 'uploads/animated.gif', images( 'animated.gif' ) );
	objects.set( 'uploads/animated.webp', images( 'animated.webp' ) );
	objects.set( 'uploads/rotated.jpg', await sharp( images( 'hdr.jpg' ) ).withMetadata( { orientation: 6 } ).jpeg().toBuffer() );
	objects.set( 'uploads/photo.avif', await sharp( images( 'hdr.jpg' ) ).resize( 600 ).avif().toBuffer() );
	objects.set( 'private/secret.jpg', images( 'hdr.jpg' ) );
	objects.set( 'uploads/broken.jpg', Buffer.from( 'not an image' ) );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.useRealTimers();
	delete ( globalThis as { caches?: unknown } ).caches;
} );

describe( 'image responses match Tachyon v3.0.8 dimensions and formats', () => {
	test.each( [
		[ 'uploads/photo.jpg', 'w=300' ],
		[ 'uploads/photo.jpg', 'resize=300,300&gravity=northwest' ],
		[ 'uploads/photo.jpg', 'resize=300,200&crop_strategy=smart' ],
		[ 'uploads/photo.jpg', 'crop=10,10,50,50&resize=100,100' ],
		[ 'uploads/photo.jpg', 'crop=10px,20px,300px,200px' ],
		[ 'uploads/photo.jpg', 'lb=400,400&background=ff0000' ],
		[ 'uploads/photo.jpg', 'fit=250,100&zoom=2' ],
		[ 'uploads/photo.jpg', 'w=200&h=200&crop=1' ],
		[ 'uploads/rotated.jpg', 'resize=200,300' ],
		[ 'uploads/rotated.jpg', 'crop=10px,20px,100px,80px' ],
		[ 'uploads/site.png', 'w=200' ],
		[ 'uploads/site.png', 'lb=300,300' ],
		[ 'uploads/animated.gif', 'w=100' ],
		[ 'uploads/animated.webp', 'resize=100,100' ],
		[ 'uploads/photo.jpg', 'w=200&webp=1' ],
	] )( '%s?%s', async ( key, query ) => {
		const { response, body } = await get( `/${ key }?${ query }`, env() );
		const { info } = await resizeBuffer( objects.get( key )!, Object.fromEntries( new URLSearchParams( query ) ) as Args );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'Content-Type' ) ).toBe( `image/${ info.format }` );
		expect( await size( body ) ).toEqual( [ info.width, info.pageHeight || info.height ] );
	} );

	test( 'AVIF Originals are sized with the binding and served as image/avif (Tachyon: image/heif)', async () => {
		const environment = env();
		const { response, body } = await get( '/uploads/photo.avif?w=300', environment );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'Content-Type' ) ).toBe( 'image/avif' );
		expect( ( await size( body ) )[0] ).toBe( 300 );
	} );
} );

describe( 'EXIF orientation in PNG and WebP Originals', () => {
	/**
	 *
	 */
	const quadrants = async () => sharp( {
		create: {
			width: 200,
			height: 100,
			channels: 3,
			background: '#000000',
		},
	} ).composite( [
		[ '#ff0000', 0, 0 ],
		[ '#00ff00', 100, 0 ],
		[ '#0000ff', 0, 50 ],
		[ '#ffff00', 100, 50 ],
	].map( ( [ background, left, top ] ) => ( {
		input: {
			create: {
				width: 100,
				height: 50,
				channels: 3 as const,
				background: background as string,
			},
		},
		left: left as number,
		top: top as number,
	} ) ) ).png().toBuffer();

	/** Colour names at the centre of each display quadrant. */
	async function corners( bytes: Buffer ) {
		const { data, info } = await sharp( bytes ).raw().toBuffer( { resolveWithObject: true } );
		return [ [ 0.25, 0.25 ], [ 0.75, 0.25 ], [ 0.25, 0.75 ], [ 0.75, 0.75 ] ].map( ( [ x, y ] ) => {
			const i = ( Math.floor( y * info.height ) * info.width + Math.floor( x * info.width ) ) * info.channels;
			return [ data[i], data[i + 1], data[i + 2] ].map( v => v > 127 ? 1 : 0 ).join( '' );
		} );
	}

	test.each( [ 'png', 'webp' ].flatMap( format => [ 2, 3, 4, 5, 6, 7, 8 ].map( orientation => [ format, orientation ] as const ) ) )( '%s orientation %i is displayed like Tachyon', async ( format, orientation ) => {
		const tagged = sharp( await quadrants() ).withMetadata( { orientation } );
		const bytes = await ( format === 'png' ? tagged.png() : tagged.webp( { lossless: true } ) ).toBuffer();
		const key = `uploads/oriented-${ orientation }.${ format }`;
		objects.set( key, bytes );
		const { response, body } = await get( `/${ key }?w=80`, env() );
		const { data } = await resizeBuffer( bytes, { w: '80' } as Args );
		expect( response.status ).toBe( 200 );
		expect( await size( body ) ).toEqual( await size( data ) );
		expect( await corners( body ) ).toEqual( await corners( data ) );
	} );
} );

describe( 'encoding', () => {
	test( 'default quality, explicit quality and zoom compression reach the binding', async () => {
		const environment = env();
		await get( '/uploads/photo.jpg?w=100', environment );
		await get( '/uploads/photo.jpg?w=100&quality=40', environment );
		await get( '/uploads/photo.jpg?w=100&zoom=3', environment );
		const qualities = environment.IMAGES.calls.map( call => call.output.quality );
		expect( qualities[0] ).toBe( 82 );
		expect( qualities[1] ).toBe( 40 );
		expect( qualities[2] ).toBeLessThan( 82 );
	} );

	test( 'animation is requested only for formats that can animate', async () => {
		const environment = env();
		await get( '/uploads/photo.jpg?w=100', environment );
		await get( '/uploads/site.png?w=100', environment );
		await get( '/uploads/animated.gif?w=100', environment );
		await get( '/uploads/photo.jpg?w=100&webp=1', environment );
		expect( environment.IMAGES.calls.map( call => call.output.anim ) ).toEqual( [ false, false, true, true ] );
	} );

	test( 'X-WebP selects WebP', async () => {
		const { response } = await get( '/uploads/photo.jpg?w=100', env(), { 'X-WebP': '1' } );
		expect( response.headers.get( 'Content-Type' ) ).toBe( 'image/webp' );
	} );
} );

describe( 'headers and statuses', () => {
	test( 'success carries Tachyon headers', async () => {
		jest.useFakeTimers( {
			now: new Date( '2026-11-04T12:00:00Z' ),
			doNotFake: [ ...FAKE_TIMERS ],
		} );
		const { response } = await get( '/uploads/photo.jpg?w=100', env() );
		expect( response.headers.get( 'Cache-Control' ) ).toBe( 'max-age=31536000' );
		expect( response.headers.get( 'Last-Modified' ) ).toBe( 'Wed, 04 Nov 2026 12:00:00 GMT' );
	} );

	test( 'missing Originals return Tachyon\'s 404', async () => {
		const { response, body } = await get( '/uploads/missing.jpg?w=100', env() );
		expect( response.status ).toBe( 404 );
		expect( response.headers.get( 'Content-Type' ) ).toBe( 'text/html' );
		expect( body.toString() ).toBe( 'File not found.' );
	} );

	test( 'the key prefix is applied to storage lookups only', async () => {
		const environment = env( { TACHYON_KEY_PREFIX: 'uploads/' } );
		const { response } = await get( '/photo.jpg?w=10', environment );
		expect( response.status ).toBe( 200 );
		expect( environment.BUCKET.get ).toHaveBeenCalledWith( 'uploads/photo.jpg' );
	} );

	test.each( [
		[ 'malformed path', '/uploads/bad%E0.jpg' ],
		[ 'crop outside the image', '/uploads/photo.jpg?crop=50,50,60,60' ],
		[ 'undecodable Original', '/uploads/broken.jpg?w=10' ],
	] )( '%s returns a sanitized 500', async ( _, url ) => {
		jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		const { response, body } = await get( url, env() );
		expect( response.status ).toBe( 500 );
		expect( response.headers.get( 'Cache-Control' ) ).toBe( 'no-store' );
		expect( body.toString() ).toBe( 'Internal Server Error' );
	} );

	test( 'Originals over the binding limit are served unmodified', async () => {
		const environment = env();
		environment.BUCKET.get.mockResolvedValueOnce( {
			body: new Response( 'big' ).body!,
			size: MAX_INPUT_BYTES + 1,
		} );
		const { response, body } = await get( '/uploads/huge.png?w=100', environment );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'Content-Type' ) ).toBe( 'image/png' );
		expect( body.toString() ).toBe( 'big' );
		expect( environment.IMAGES.calls ).toHaveLength( 0 );
	} );
} );

describe( 'HTTP Origin', () => {
	/**
	 *
	 */
	const httpEnv = () => env( {
		TACHYON_ORIGIN: 'http',
		TACHYON_HTTP_ORIGIN: 'https://origin.example.test/wp-content/',
	} );

	test( 'fetches the encoded Object Key below the base URL', async () => {
		const fetch = jest.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( objects.get( 'uploads/photo.jpg' ) ) );
		const { response } = await get( '/uploads/caf%C3%A9%20x.jpg?w=50', httpEnv() );
		expect( response.status ).toBe( 200 );
		expect( String( fetch.mock.calls[0][0] ) ).toBe( 'https://origin.example.test/wp-content/uploads/caf%C3%A9%20x.jpg' );
	} );

	test.each( [ [ 403, 404 ], [ 404, 404 ], [ 500, 502 ] ] )( 'upstream %i becomes %i', async ( upstream, status ) => {
		jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		jest.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( 'upstream detail', { status: upstream } ) );
		const { response, body } = await get( '/uploads/a.jpg', httpEnv() );
		expect( response.status ).toBe( status );
		expect( body.toString() ).not.toContain( 'upstream detail' );
	} );

	test( 'Originals without Content-Length are read only up to the limit, then passed through', async () => {
		const chunk = new Uint8Array( 1024 * 1024 ).fill( 7 );
		const chunks = Math.ceil( MAX_INPUT_BYTES / chunk.byteLength ) + 4;
		let pulled = 0;
		const body = new ReadableStream<Uint8Array>( {
			/**
			 *
			 */
			pull( controller ) {
				if ( pulled++ < chunks ) {
					controller.enqueue( chunk );
				} else {
					controller.close();
				}
			},
		}, { highWaterMark: 0 } );
		jest.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( body ) );
		const environment = httpEnv();
		const response = await handleRequest( new Request( 'https://cdn.example.test/uploads/huge.png?w=100' ), environment, { /**
																																																																																																																									 *
																																																																																																																									 */
			waitUntil: () => {},
		} );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'Content-Type' ) ).toBe( 'image/png' );
		expect( pulled ).toBeLessThan( chunks );
		expect( ( await response.arrayBuffer() ).byteLength ).toBe( chunks * chunk.byteLength );
		expect( environment.IMAGES.calls ).toHaveLength( 0 );
	} );

	test( 'chunked Originals under the limit are transformed', async () => {
		const bytes = objects.get( 'uploads/photo.jpg' )!;
		const body = new ReadableStream<Uint8Array>( {
			/**
			 *
			 */
			start( controller ) {
				controller.enqueue( bytes.subarray( 0, 1000 ) );
				controller.enqueue( bytes.subarray( 1000 ) );
				controller.close();
			},
		} );
		jest.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( body ) );
		const { response, body: out } = await get( '/uploads/photo.jpg?w=50', httpEnv() );
		expect( response.status ).toBe( 200 );
		expect( ( await size( out ) )[0] ).toBe( 50 );
	} );

	test( 'dot segments cannot escape the base path', async () => {
		const fetch = jest.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( null, { status: 404 } ) );
		await get( '/uploads/%2E%2E/%2E%2E/wp-config.php', httpEnv() );
		for ( const [ url ] of fetch.mock.calls ) {
			expect( String( url ) ).toMatch( /^https:\/\/origin\.example\.test\/wp-content\/[^.]/ );
		}
	} );
} );

describe( 'private prefixes and presigns', () => {
	const SIGNED_AT = new Date( '2026-11-04T12:00:00Z' );
	const credentials = {
		accessKeyId: 'AKIDEXAMPLE',
		secretAccessKey: 'secret-key-example',
	};
	const signing: Partial<Env> = {
		TACHYON_PRIVATE_PREFIXES: 'private/, members/',
		TACHYON_SIGNING_ACCESS_KEY_ID: credentials.accessKeyId,
		TACHYON_SIGNING_SECRET_ACCESS_KEY: credentials.secretAccessKey,
		TACHYON_SIGNING_HOST: 'acct.r2.cloudflarestorage.com',
		TACHYON_SIGNING_PATH_PREFIX: '/uploads-bucket',
	};

	/** Presign like the plugin: SDK presign, X-Amz-* folded into `presign=`. */
	async function signedUrl( key: string, args = 'w=50' ) {
		const client = new S3Client( {
			region: 'auto',
			endpoint: 'https://acct.r2.cloudflarestorage.com',
			forcePathStyle: true,
			credentials,
		} );
		const signed = new URL( await getSignedUrl( client, new GetObjectCommand( {
			Bucket: 'uploads-bucket',
			Key: key,
		} ), {
			expiresIn: 600,
			signingDate: SIGNED_AT,
		} ) );
		const presign = new URLSearchParams();
		const rest = new URLSearchParams();
		for ( const [ name, value ] of signed.searchParams ) {
			( /^x-amz-/i.test( name ) ? presign : rest ).append( name, value );
		}
		return `/${ key }?${ rest }&presign=${ encodeURIComponent( presign.toString() ) }&${ args }`;
	}

	/**
	 *
	 */
	const at = ( seconds: number ) => jest.useFakeTimers( {
		now: SIGNED_AT.getTime() + seconds * 1000,
		doNotFake: [ ...FAKE_TIMERS ],
	} );

	test( 'unsigned private requests are not found', async () => {
		expect( ( await get( '/private/secret.jpg?w=50', env( signing ) ) ).response.status ).toBe( 404 );
	} );

	test( 'private prefixes match the storage key, including TACHYON_KEY_PREFIX', async () => {
		const environment = env( {
			...signing,
			TACHYON_KEY_PREFIX: 'stored/',
			TACHYON_PRIVATE_PREFIXES: 'stored/private/',
		} );
		objects.set( 'stored/private/secret.jpg', images( 'hdr.jpg' ) );
		expect( ( await get( '/private/secret.jpg?w=50', environment ) ).response.status ).toBe( 404 );
		expect( environment.BUCKET.get ).not.toHaveBeenCalled();

		const url = await signedUrl( 'private/secret.jpg' );
		at( 100 );
		expect( ( await get( url, environment ) ).response.status ).toBe( 200 );
		expect( environment.BUCKET.get ).toHaveBeenCalledWith( 'stored/private/secret.jpg' );
	} );

	test( 'private prefixes without signing credentials fail closed', async () => {
		jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		const url = await signedUrl( 'private/secret.jpg' );
		at( 100 );
		expect( ( await get( url, env( { TACHYON_PRIVATE_PREFIXES: 'private/' } ) ) ).response.status ).toBe( 404 );
	} );

	test( 'genuine presigns are served with the remaining validity as max-age', async () => {
		const url = await signedUrl( 'private/secret.jpg' );
		at( 100 );
		const { response } = await get( url, env( signing ) );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'Cache-Control' ) ).toBe( 'max-age=500' );
	} );

	test( 'wrong secret, expiry and a presign for another key are not found', async () => {
		const url = await signedUrl( 'private/secret.jpg' );
		const other = ( await signedUrl( 'private/other.jpg' ) ).replace( 'private/other.jpg', 'private/secret.jpg' );
		at( 100 );
		expect( ( await get( url, env( {
			...signing,
			TACHYON_SIGNING_SECRET_ACCESS_KEY: 'wrong',
		} ) ) ).response.status ).toBe( 404 );
		expect( ( await get( other, env( signing ) ) ).response.status ).toBe( 404 );
		at( 601 );
		expect( ( await get( url, env( signing ) ) ).response.status ).toBe( 404 );
	} );

	test( 'public presigns are verified when credentials exist; expiry always applies', async () => {
		const url = ( await signedUrl( 'uploads/other.jpg' ) ).replace( 'uploads/other.jpg', 'uploads/photo.jpg' );
		at( 100 );
		expect( ( await get( url, env( signing ) ) ).response.status ).toBe( 404 );
		expect( ( await get( url, env() ) ).response.status ).toBe( 200 );
		at( 601 );
		expect( ( await get( url, env() ) ).response.status ).toBe( 404 );
	} );
} );

describe( 'cache', () => {
	/**
	 *
	 */
	function installCache() {
		const store = new Map<string, Response>();
		const cache = {
			match: jest.fn( async ( request: Request ) => store.get( request.url )?.clone() ),
			put: jest.fn( async ( request: Request, response: Response ) => void store.set( request.url, response ) ),
		};
		( globalThis as { caches?: unknown } ).caches = { default: cache };
		return {
			store,
			cache,
		};
	}

	test( 'unsigned Variants are cached per WebP choice and refreshed on hit', async () => {
		const { store } = installCache();
		const environment = env();
		jest.useFakeTimers( {
			now: new Date( '2026-11-04T12:00:00Z' ),
			doNotFake: [ ...FAKE_TIMERS ],
		} );
		await get( '/uploads/photo.jpg?w=60', environment );
		await get( '/uploads/photo.jpg?w=60', environment, { 'X-WebP': '1' } );
		expect( store.size ).toBe( 2 );

		jest.setSystemTime( new Date( '2026-11-05T12:00:00Z' ) );
		const hit = await get( '/uploads/photo.jpg?w=60', environment, { 'X-WebP': '1' } );
		expect( hit.response.headers.get( 'Content-Type' ) ).toBe( 'image/webp' );
		expect( hit.response.headers.get( 'Last-Modified' ) ).toBe( 'Thu, 05 Nov 2026 12:00:00 GMT' );
		expect( environment.BUCKET.get ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'Variants are cached separately per R2 bucket', async () => {
		const { store } = installCache();
		await get( '/uploads/photo.jpg?w=60', env( { TACHYON_R2_BUCKET: 'one' } ) );
		const other = env( { TACHYON_R2_BUCKET: 'two' } );
		await get( '/uploads/photo.jpg?w=60', other );
		expect( store.size ).toBe( 2 );
		expect( other.BUCKET.get ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'errors, private and signed requests are not cached', async () => {
		const { store, cache } = installCache();
		await get( '/uploads/missing.jpg', env() );
		await get( '/private/secret.jpg', env( { TACHYON_PRIVATE_PREFIXES: 'private/' } ) );
		jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		const signed = await get( '/uploads/photo.jpg?w=10&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=x', env() );
		expect( signed.response.status ).toBe( 200 );
		expect( store.size ).toBe( 0 );
		expect( cache.match ).toHaveBeenCalledTimes( 1 );
	} );
} );
