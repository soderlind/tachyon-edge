import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, describe, expect, test } from '@jest/globals';

const script = join( __dirname, '..', 'scripts', 'check-config.mjs' );
const dir = mkdtempSync( join( tmpdir(), 'tachyon-config-' ) );

/**
 * Run the config check and return its exit status and stderr.
 */
function check( ...args: string[] ): { status: number; stderr: string } {
	try {
		execFileSync( process.execPath, [ script, ...args ], {
			cwd: join( __dirname, '..' ),
			stdio: 'pipe',
		} );
		return {
			status: 0,
			stderr: '',
		};
	} catch ( error ) {
		const { status, stderr } = error as { status: number; stderr: Buffer };
		return {
			status,
			stderr: stderr.toString(),
		};
	}
}

/**
 *
 */
function config( text: string ): string {
	const file = join( dir, `${ Math.random().toString( 36 ).slice( 2 ) }.jsonc` );
	writeFileSync( file, text );
	return file;
}

afterAll( () => rmSync( dir, {
	recursive: true,
	force: true,
} ) );

describe( 'TACHYON_R2_BUCKET config check', () => {
	test( 'the repository wrangler.jsonc passes', () => {
		expect( check() ).toEqual( {
			status: 0,
			stderr: '',
		} );
	} );

	test( 'a mismatched bucket fails, including inside an environment', () => {
		const result = check( config( `{
			// comments and trailing commas are allowed
			"r2_buckets": [ { "binding": "BUCKET", "bucket_name": "one" } ],
			"vars": { "TACHYON_R2_BUCKET": "one" },
			"env": {
				"staging": {
					"r2_buckets": [ { "binding": "BUCKET", "bucket_name": "two" } ],
					"vars": { "TACHYON_R2_BUCKET": "one", },
				},
			},
		}` ) );
		expect( result.status ).toBe( 1 );
		expect( result.stderr ).toContain( 'env.staging: vars.TACHYON_R2_BUCKET is "one" but BUCKET is bound to "two"' );
		expect( result.stderr ).not.toContain( 'top level' );
	} );

	test( 'a missing TACHYON_R2_BUCKET fails', () => {
		const result = check( config( '{ "r2_buckets": [ { "binding": "BUCKET", "bucket_name": "one" } ] }' ) );
		expect( result.status ).toBe( 1 );
		expect( result.stderr ).toContain( 'top level: vars.TACHYON_R2_BUCKET is null' );
	} );

	test( 'the HTTP Origin does not need TACHYON_R2_BUCKET', () => {
		expect( check( config( `{
			"r2_buckets": [ { "binding": "BUCKET", "bucket_name": "one" } ],
			"vars": { "TACHYON_ORIGIN": "http" }
		}` ) ).status ).toBe( 0 );
	} );

	test( '--sync sets TACHYON_R2_BUCKET from bucket_name and keeps comments', () => {
		const file = config( `{
			// renamed by the Deploy to Cloudflare button
			"r2_buckets": [ { "binding": "BUCKET", "bucket_name": "renamed" } ],
			"vars": { "TACHYON_R2_BUCKET": "tachyon-uploads" },
			"env": {
				"staging": {
					"r2_buckets": [ { "binding": "BUCKET", "bucket_name": "two" } ],
					"vars": { "TACHYON_KEY_PREFIX": "" },
				},
			},
		}` );
		expect( check( '--sync', file ).status ).toBe( 0 );

		const text = readFileSync( file, 'utf8' );
		expect( text ).toContain( '// renamed by the Deploy to Cloudflare button' );
		expect( text ).toContain( '"vars": { "TACHYON_R2_BUCKET": "renamed" }' );
		expect( text ).toContain( '"vars": { "TACHYON_R2_BUCKET": "two", "TACHYON_KEY_PREFIX": "" }' );
		expect( check( file ).status ).toBe( 0 );
	} );

	test( '--sync fails when there is no vars object to write to', () => {
		const result = check( '--sync', config( '{ "r2_buckets": [ { "binding": "BUCKET", "bucket_name": "one" } ] }' ) );
		expect( result.status ).toBe( 1 );
		expect( result.stderr ).toContain( 'top level: vars.TACHYON_R2_BUCKET is null' );
	} );
} );
