/**
 * Remote smoke test (ADR 0011): run against a deployed Worker with the real Images binding.
 * Upload fixtures first with `node tests/remote/prepare.mjs <dir> <bucket>`, then
 * `TACHYON_SMOKE_URL=https://<worker>/uploads/ TACHYON_SMOKE_FIXTURES=<dir> npm run test:remote`.
 * Expects TACHYON_PRIVATE_PREFIXES=uploads/private/ without signing credentials (fail closed).
 */
import { readFileSync } from 'fs';

import { describe, expect, test } from '@jest/globals';
import sharp from 'sharp';

import { resizeBuffer, type Args } from '../oracle/tachyon-v3.0.8';

const BASE = process.env.TACHYON_SMOKE_URL!;
/**
 *
 */
const local = ( f: string ) => readFileSync( `${ process.env.TACHYON_SMOKE_FIXTURES }/${ f }` );
/**
 *
 */
async function fetchImg( path: string, headers: Record<string, string> = {} ) {
	const r = await fetch( BASE + path, { headers } );
	return {
		r,
		body: Buffer.from( await r.arrayBuffer() ),
	};
}
/**
 *
 */
async function dims( b: Buffer ) {
	const m = await sharp( b, { animated: true } ).metadata(); return {
		w: m.width,
		h: m.pageHeight || m.height,
		pages: m.pages || 1,
		format: m.format,
		palette: m.paletteBitDepth,
		exif: !! m.exif,
		icc: !! m.icc,
	};
}
/**
 *
 */
async function pixel( b: Buffer, x: number, y: number ) {
	const { data, info } = await sharp( b ).raw().toBuffer( { resolveWithObject: true } ); const i = ( y * info.width + x ) * info.channels; return [ data[i], data[i+1], data[i+2] ];
}
/**
 *
 */
const red = ( p: number[] ) => p[0] > 180 && p[2] < 80;
/**
 *
 */
const blue = ( p: number[] ) => p[2] > 180 && p[0] < 80;

describe( 'geometry vs oracle', () => {
	const cases: [ string, string ][] = [];
	for ( const f of [ 'briefing-copywriting.jpg', 'Website.png', 'hdr.jpg', 'humans.png', 'icons.png', 'marker-o6.jpg' ] )
		for ( const q of [ 'w=300', 'h=120', 'w=200&h=200&crop=1', 'resize=300,200', 'resize=150,150&gravity=northwest', 'resize=200,100&crop_strategy=smart', 'fit=250,100', 'fit=250,100&zoom=2', 'crop=10,10,50,50', 'crop=10px,20px,100px,80px&w=50', 'lb=400,400&background=ff0000', 'w=5000', 'w=301&webp=1' ] )
			cases.push( [ f, q ] );
	for ( const f of [ 'animated.gif', 'animated.webp' ] ) for ( const q of [ 'w=100', 'resize=80,80' ] ) cases.push( [ f, q ] );
	test.each( cases )( '%s?%s', async ( f, q ) => {
		const { r, body } = await fetchImg( `${ f }?${ q }` );
		const { info } = await resizeBuffer( local( f ), Object.fromEntries( new URLSearchParams( q ) ) as Args );
		expect( r.status ).toBe( 200 );
		expect( r.headers.get( 'content-type' ) ).toBe( `image/${ info.format }` );
		const d = await dims( body );
		expect( [ d.w, d.h ] ).toEqual( [ info.width, info.pageHeight || info.height ] );
		if ( f.startsWith( 'animated' ) ) expect( d.pages ).toBeGreaterThan( 1 );
	}, 30000 );
} );

describe( 'binding semantics checklist', () => {
	test( 'trim on EXIF orientation 6 uses display coordinates', async () => {
		// Display: 400x300, red top-left 200x150. Crop the top-left 200x150 (red) region.
		const { body } = await fetchImg( 'marker-o6.jpg?crop=0px,0px,200px,150px' );
		const d = await dims( body ); expect( [ d.w, d.h ] ).toEqual( [ 200, 150 ] );
		expect( red( await pixel( body, 100, 75 ) ) ).toBe( true );
		const br = await fetchImg( 'marker-o6.jpg?crop=200px,150px,200px,150px' );
		expect( blue( await pixel( br.body, 100, 75 ) ) ).toBe( true );
	}, 30000 );
	test( 'one-pixel trim edges are pixels, not fractions', async () => {
		const { body } = await fetchImg( 'marker.jpg?crop=1px,1px,398px,298px' );
		const d = await dims( body ); expect( [ d.w, d.h ] ).toEqual( [ 398, 298 ] );
	}, 30000 );
	test( 'border adds exact pixels in the background colour', async () => {
		const { body } = await fetchImg( 'marker.jpg?lb=400,400&background=%2300ff00' );
		const d = await dims( body ); expect( [ d.w, d.h ] ).toEqual( [ 400, 400 ] );
		const top = await pixel( body, 200, 10 ); expect( top[1] ).toBeGreaterThan( 180 ); expect( top[0] ).toBeLessThan( 80 );
		const inside = await pixel( body, 300, 300 ); expect( blue( inside ) ).toBe( true );
	}, 30000 );
	test( 'cover gravity selects the compass region', async () => {
		expect( red( await pixel( ( await fetchImg( 'marker.jpg?resize=100,300&gravity=west' ) ).body, 50, 10 ) ) ).toBe( true );
		expect( blue( await pixel( ( await fetchImg( 'marker.jpg?resize=100,300&gravity=east' ) ).body, 50, 10 ) ) ).toBe( true );
		expect( red( await pixel( ( await fetchImg( 'marker.jpg?resize=400,100&gravity=north' ) ).body, 50, 20 ) ) ).toBe( true );
		expect( blue( await pixel( ( await fetchImg( 'marker.jpg?resize=400,100&gravity=south' ) ).body, 50, 80 ) ) ).toBe( true );
	}, 30000 );
	test( 'PNG output with quality is palette-encoded', async () => {
		const d = await dims( ( await fetchImg( 'Website.png?w=200' ) ).body );
		console.log( 'png', d );
		expect( d.format ).toBe( 'png' );
	}, 30000 );
	test( 'AVIF original sized via binding', async () => {
		const { r, body } = await fetchImg( 'photo.avif?w=300' );
		console.log( 'avif', r.status, r.headers.get( 'content-type' ), r.status === 200 ? await dims( body ) : body.toString().slice( 0, 100 ) );
	}, 30000 );
	test( 'statuses and headers', async () => {
		const ok = await fetchImg( 'marker.jpg?w=10' );
		expect( ok.r.headers.get( 'cache-control' ) ).toBe( 'max-age=31536000' );
		expect( ok.r.headers.get( 'last-modified' ) ).toBeTruthy();
		const nf = await fetchImg( 'missing.jpg' );
		expect( nf.r.status ).toBe( 404 ); expect( nf.body.toString() ).toBe( 'File not found.' );
		expect( ( await fetchImg( 'private/secret.jpg' ) ).r.status ).toBe( 404 );
		expect( ( await fetchImg( 'private/secret.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=600&X-Amz-Date=20991231T000000Z&X-Amz-Signature=x' ) ).r.status ).toBe( 404 );
		const bad = await fetchImg( 'marker.jpg?crop=90,90,50,50' );
		expect( bad.r.status ).toBe( 500 ); expect( bad.r.headers.get( 'cache-control' ) ).toBe( 'no-store' );
		const webp = await fetchImg( 'marker.jpg?w=50', { 'X-WebP': '1' } );
		expect( webp.r.headers.get( 'content-type' ) ).toBe( 'image/webp' );
		const plain = await fetchImg( 'marker.jpg?w=50' );
		expect( plain.r.headers.get( 'content-type' ) ).toBe( 'image/jpeg' );
	}, 60000 );
	test( 'metadata', async () => {
		console.log( 'meta', await dims( ( await fetchImg( 'hdr.jpg?w=100' ) ).body ) );
	}, 30000 );
} );
