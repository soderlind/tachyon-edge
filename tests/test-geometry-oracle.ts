/**
 * Geometry parity (ADR 0011): for every Original and argument set, the planner
 * must predict exactly the output dimensions and format Tachyon v3.0.8 produces.
 */
import { readFileSync } from 'fs';

import sharp, { type OutputInfo } from 'sharp';

import { validateArgs, TachyonArgs } from '../src/contract';
import { plan, PlanError } from '../src/geometry';
import { probe, toSource } from '../src/probe';

import legacyGeometry from './oracle/sharp-0.34.2-geometry.json';
import { resizeBuffer, Args } from './oracle/tachyon-v3.0.8';

type Fixture = { name: string; bytes: Buffer };

const fixtures: Fixture[] = [];

const ANIMATED = new Set( [ 'animated.gif', 'animated.webp' ] );

const LEGACY_GEOMETRY = new Map( legacyGeometry.map( record => [
	`${ record.name } ${ JSON.stringify( record.args ) }`,
	record,
] as const ) );

const FORMAT_MIME: Record<string, string> = {
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
};

const ARG_SETS: TachyonArgs[] = [
	{},
	{ w: '300' },
	{ h: '200' },
	{
		w: '150',
		h: '150',
	},
	{ w: '5000' },
	{
		w: '333',
		h: '77',
	},
	{
		w: '300',
		zoom: '2',
	},
	{
		w: '300',
		h: '300',
		crop: '10,10,50,50',
	},
	{
		w: '200',
		crop: '0,0,60,40',
	},
	{ crop: '10px,20px,100px,80px' },
	{ crop: '0,0,100,100' },
	{ crop: '50,50,60,60' },
	{ resize: '300,300' },
	{ resize: '800,800' },
	{ resize: '2000,300' },
	{ resize: '0,200' },
	{ resize: '200,0' },
	{ resize: '150px,100' },
	{ resize: '301,97' },
	{
		resize: '300,200',
		gravity: 'north',
	},
	{
		resize: '300,200',
		gravity: 'southeast',
	},
	{
		resize: '300,200',
		crop_strategy: 'entropy',
	},
	{
		resize: '300,200',
		crop_strategy: 'attention',
	},
	{
		resize: '300,200',
		crop_strategy: 'smart',
	},
	{
		resize: '120,400',
		crop_strategy: 'smart',
	},
	{
		resize: '300,200',
		zoom: '1.5',
	},
	{
		resize: '100,100',
		crop: '10,10,50,50',
	},
	{ fit: '300,300' },
	{ fit: '5000,5000' },
	{ fit: '300,0' },
	{ fit: '0,123' },
	{
		fit: '250,100',
		zoom: '2',
	},
	{ lb: '300,300' },
	{ lb: '800,800' },
	{ lb: '2000,300' },
	{
		lb: '300,300',
		background: '#ff0000',
	},
	{ lb: '301,99' },
	{ lb: '300,0' },
	{ quality: '40' },
	{
		w: '200',
		webp: '1',
	},
	{
		w: '200',
		webp: 'true',
	},
	{
		w: '200',
		quality: '55',
		webp: '1',
	},
];

/** The image both pipelines see: per-page height for animations. */
function frameSize( info: OutputInfo ): [ number, number ] {
	return [ info.width, info.pageHeight || info.height ];
}

beforeAll( async () => {
	for ( const name of [ 'briefing-copywriting.jpg', 'hdr.jpg', 'Website.png', 'humans.png', 'icons.png', 'animated.gif', 'animated.webp' ] ) {
		fixtures.push( {
			name,
			bytes: readFileSync( `${ __dirname }/images/${ name }` ),
		} );
	}
	const base = sharp( readFileSync( `${ __dirname }/images/briefing-copywriting.jpg` ) );
	for ( const orientation of [ 3, 6, 8 ] ) {
		fixtures.push( {
			name: `exif-${ orientation }.jpg`,
			bytes: await base.clone().withMetadata( { orientation } ).jpeg().toBuffer(),
		} );
	}
	// EXIF orientation in PNG eXIf and extended WebP EXIF chunks (the WebP chunk follows the bitstream).
	const wide = await sharp( {
		create: {
			width: 400,
			height: 200,
			channels: 3,
			background: '#663399',
		},
	} ).png().toBuffer();
	fixtures.push( {
		name: 'exif-6.png',
		bytes: await sharp( wide ).withMetadata( { orientation: 6 } ).png().toBuffer(),
	} );
	fixtures.push( {
		name: 'exif-6.webp',
		bytes: await sharp( wide ).withMetadata( { orientation: 6 } ).webp().toBuffer(),
	} );
	fixtures.push( {
		name: 'small.png',
		bytes: await sharp( {
			create: {
				width: 300,
				height: 200,
				channels: 3,
				background: '#336699',
			},
		} ).png().toBuffer(),
	} );
	fixtures.push( {
		name: 'odd.jpg',
		bytes: await sharp( {
			create: {
				width: 1001,
				height: 333,
				channels: 3,
				background: '#996633',
			},
		} ).jpeg().toBuffer(),
	} );
	fixtures.push( {
		name: 'small.webp',
		bytes: await sharp( {
			create: {
				width: 999,
				height: 333,
				channels: 3,
				background: '#669933',
			},
		} ).webp().toBuffer(),
	} );
} );

describe( 'planner matches Tachyon v3.0.8 geometry', () => {
	const cases = [ 'briefing-copywriting.jpg', 'hdr.jpg', 'Website.png', 'humans.png', 'icons.png', 'animated.gif', 'animated.webp', 'exif-3.jpg', 'exif-6.jpg', 'exif-8.jpg', 'exif-6.png', 'exif-6.webp', 'small.png', 'odd.jpg', 'small.webp' ]
		.flatMap( name => ARG_SETS.map( args => [ name, args ] as const ) );

	test( 'all recorded legacy cases are exercised', () => {
		const keys = new Set( cases.map( ( [ name, args ] ) => `${ name } ${ JSON.stringify( args ) }` ) );
		expect( LEGACY_GEOMETRY.size ).toBe( legacyGeometry.length );
		for ( const key of LEGACY_GEOMETRY.keys() ) {
			expect( keys.has( key ) ).toBe( true );
		}
	} );

	test.each( cases )( '%s %j', async ( name, rawArgs ) => {
		const fixture = fixtures.find( f => f.name === name )!;
		const probed = probe( fixture.bytes )!;
		const source = toSource( probed.format, probed.width!, probed.height!, probed.orientation );
		const args = validateArgs( rawArgs );
		const legacy = LEGACY_GEOMETRY.get( `${ name } ${ JSON.stringify( rawArgs ) }` );

		let expected: { size: [ number, number ]; format: string } | Error;
		try {
			const { info } = await resizeBuffer( fixture.bytes, { ...rawArgs } as Args );
			expected = {
				size: frameSize( info ),
				format: FORMAT_MIME[info.format],
			};
		} catch ( error ) {
			expected = error as Error;
		}

		if ( legacy ) {
			if ( expected instanceof Error ) {
				throw expected;
			}
			expect( expected ).toEqual( legacy.patched );
			expect( legacy.legacy.size ).toHaveLength( 2 );
			expected = {
				size: [ legacy.legacy.size[0], legacy.legacy.size[1] ],
				format: legacy.legacy.format,
			};
		}

		if ( expected instanceof Error ) {
			if ( ANIMATED.has( name ) ) {
				// Deviation (ADR 0006): Tachyon fails these on animations (crop % of the stacked
				// height, multi-page resize strategy); Tachyon Edge plans them per frame.
				try {
					plan( source, args, Boolean( args.webp ) );
				} catch ( error ) {
					expect( error ).toBeInstanceOf( PlanError );
				}
			} else {
				expect( () => plan( source, args, Boolean( args.webp ) ) ).toThrow( PlanError );
			}
			return;
		}
		const result = plan( source, args, Boolean( args.webp ) );
		expect( {
			size: [ result.width, result.height ],
			format: result.format,
		} ).toEqual( expected );
	} );
} );

describe( 'Tachyon oracle input handling', () => {
	test( 'preserves tolerance of truncated JPEGs', async () => {
		const image = readFileSync( `${ __dirname }/images/briefing-copywriting.jpg` );
		const truncated = image.subarray( 0, image.length - 2 );
		await expect( sharp( truncated ).toBuffer() ).rejects.toThrow();
		const { info } = await resizeBuffer( truncated, { w: '300' } );
		expect( info.width ).toBe( 300 );
		expect( info.format ).toBe( 'jpeg' );
	} );
} );

describe( 'planner matches Tachyon v3.0.8 geometry on random sizes', () => {
	let seed = 20261104;
	/**
	 *
	 */
	const random = ( max: number ) => {
		seed = ( seed * 1103515245 + 12345 ) % 2147483648;
		return 1 + ( seed % max );
	};
	const cases = Array.from( { length: 60 }, ( _, i ) => {
		const format = [ 'jpeg', 'png', 'webp' ][i % 3] as 'jpeg' | 'png' | 'webp';
		const width = 40 + random( 2400 );
		const height = 40 + random( 2400 );
		/**
		 *
		 */
		const pair = () => `${ random( width ) },${ random( height ) }`;
		const args: TachyonArgs[] = [ { w: String( random( width ) ) }, { h: String( random( height ) ) }, { resize: pair() }, { fit: pair() }, { lb: pair() }, {
			w: String( random( width ) ),
			h: String( random( height ) ),
		} ];
		return [ format, width, height, args[i % args.length] ] as const;
	} );

	test.each( cases )( '%s %ix%i %j', async ( format, width, height, rawArgs ) => {
		const bytes = await sharp( {
			create: {
				width,
				height,
				channels: 3,
				background: '#808080',
			},
		} )[format]().toBuffer();
		const probed = probe( bytes )!;
		const source = toSource( probed.format, probed.width!, probed.height!, probed.orientation );
		const { info } = await resizeBuffer( bytes, { ...rawArgs } as Args );
		const result = plan( source, validateArgs( rawArgs ), false );
		expect( [ result.width, result.height ] ).toEqual( frameSize( info ) );
	} );
} );
