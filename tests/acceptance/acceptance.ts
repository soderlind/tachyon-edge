/**
 * WP-CLI acceptance test: WordPress with the Tachyon plugin, pointed at a deployed Worker.
 *
 * Asks WordPress (through WP-CLI) for the Tachyon URLs and dimensions it puts in the page,
 * then checks that the Worker serves each URL with that status, type, cache header and size.
 * Provision first with `node tests/acceptance/wp-site.mjs prepare`; see docs/acceptance-test.md.
 */
import { execFileSync } from 'child_process';
import { resolve } from 'path';

import { describe, expect, test } from '@jest/globals';
import sharp from 'sharp';

type Case = { name: string; url: string; width: number; height: number | null; mime: string };

const WP_CLI = process.env.WP_CLI || 'wp';
const SLUG = process.env.TACHYON_ACCEPTANCE_SLUG || 'tachyon-acceptance';

/**
 * Run WP-CLI through the configured shell command.
 */
function wp( ...args: string[] ): string {
	return execFileSync( '/bin/sh', [ '-c', `${ WP_CLI } "$@"`, 'sh', ...args ], {
		encoding: 'utf8',
		stdio: [ 'ignore', 'pipe', 'inherit' ],
	} ).trim();
}

/**
 * The site prepared by wp-site.mjs.
 */
function site(): string {
	if ( process.env.WP_SITE_URL ) {
		return process.env.WP_SITE_URL;
	}
	const url = wp( 'site', 'list', '--field=url' ).split( '\n' ).find( u => u.replace( /\/$/, '' ).endsWith( `/${ SLUG }` ) );
	if ( ! url ) {
		throw new Error( `Sub-site "${ SLUG }" not found. Run: node tests/acceptance/wp-site.mjs prepare` );
	}
	return url;
}

const output = wp(
	`--require=${ resolve( __dirname, 'tachyon-url.php' ) }`,
	`--url=${ site() }`,
	'eval-file',
	resolve( __dirname, 'cases.php' )
);
const line = output.split( '\n' ).find( l => l.startsWith( 'TACHYON_CASES ' ) );
if ( ! line ) {
	throw new Error( `cases.php printed no cases:\n${ output }` );
}
const { tachyon_url: tachyonUrl, cases } = JSON.parse( line.slice( 'TACHYON_CASES '.length ) ) as { tachyon_url: string; cases: Case[] };

describe( 'WordPress with the Tachyon plugin', () => {
	test( 'the plugin is active and generated cases for every fixture', () => {
		expect( tachyonUrl ).toBe( ( process.env.TACHYON_URL || '' ).replace( /\/$/, '' ) );
		expect( new Set( cases.map( c => c.name.split( ' ' )[0] ) ).size ).toBe( 4 );
	} );

	test.each( cases.map( c => [ c.name, c ] as const ) )( '%s', async ( _name, c ) => {
		expect( c.url.startsWith( `${ tachyonUrl }/` ) ).toBe( true );
		const r = await fetch( c.url );
		const body = Buffer.from( await r.arrayBuffer() );
		expect( r.status ).toBe( 200 );
		expect( r.headers.get( 'content-type' ) ).toBe( c.mime );
		expect( r.headers.get( 'cache-control' ) ).toBe( 'max-age=31536000' );
		const meta = await sharp( body ).metadata();
		expect( meta.width ).toBe( c.width );
		if ( c.height !== null ) {
			expect( meta.height ).toBe( c.height );
		}
	}, 30_000 );
} );
