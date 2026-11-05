/**
 * Provision or remove the WordPress side of the WP-CLI acceptance test.
 *
 * Usage: node tests/acceptance/wp-site.mjs prepare|cleanup
 *
 * Environment:
 *   TACHYON_URL                 Worker base URL the plugin rewrites uploads to, e.g. https://<worker>/uploads (required).
 *   WP_CLI                      Shell command that runs WP-CLI for the target install (default: `wp`).
 *   WP_SITE_URL                 Existing site to use. Default: the sub-site TACHYON_ACCEPTANCE_SLUG, created on a multisite.
 *   TACHYON_ACCEPTANCE_SLUG     Sub-site slug (default: tachyon-acceptance).
 *   TACHYON_ACCEPTANCE_BUCKET   R2 bucket bound to the Worker (default: tachyon-uploads).
 *   TACHYON_ACCEPTANCE_KEEP_PLUGIN  Set to keep tachyon-plugin installed on cleanup.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

// humanmade/tachyon-plugin 0.11.1, the version ADR 0006 targets.
const PLUGIN_COMMIT = '652ecd2ca820c2faa17b6e00eb76e851665bdad5';
const PLUGIN_ZIP = `https://github.com/humanmade/tachyon-plugin/archive/${ PLUGIN_COMMIT }.zip`;
const PLUGIN_SLUG = 'tachyon-plugin';
const REQUIRE = new URL( './tachyon-url.php', import.meta.url ).pathname;

const TACHYON_URL = process.env.TACHYON_URL;
const WP_CLI = process.env.WP_CLI || 'wp';
const SLUG = process.env.TACHYON_ACCEPTANCE_SLUG || 'tachyon-acceptance';
const BUCKET = process.env.TACHYON_ACCEPTANCE_BUCKET || 'tachyon-uploads';

/**
 * Run WP-CLI through the configured shell command and return trimmed stdout.
 */
function wp( ...args ) {
	return execFileSync( '/bin/sh', [ '-c', `${ WP_CLI } "$@"`, 'sh', ...args ], {
		encoding: 'utf8',
		env: { ...process.env, TACHYON_URL },
		stdio: [ 'ignore', 'pipe', 'inherit' ],
	} ).trim();
}

/**
 * Run WP-CLI and report success instead of throwing.
 */
function wpOk( ...args ) {
	try {
		wp( ...args );
		return true;
	} catch {
		return false;
	}
}

/**
 * The site under test: WP_SITE_URL, or the acceptance sub-site if it exists.
 */
function findSite() {
	if ( process.env.WP_SITE_URL ) {
		return process.env.WP_SITE_URL;
	}
	if ( ! wpOk( 'core', 'is-installed', '--network' ) ) {
		throw new Error( 'Not a multisite: set WP_SITE_URL to the site the test may modify.' );
	}
	return wp( 'site', 'list', '--field=url' ).split( '\n' ).find( url => url.replace( /\/$/, '' ).endsWith( `/${ SLUG }` ) );
}

/**
 * R2 keys of the acceptance Originals, derived from the Tachyon URLs the plugin generates.
 */
function originals( site ) {
	const php = `
		$out = [];
		foreach ( get_posts( [ 'post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => -1, 'meta_key' => '_tachyon_acceptance', 'fields' => 'ids' ] ) as $id ) {
			$out[] = [ 'id' => $id, 'file' => get_attached_file( $id ), 'url' => function_exists( 'tachyon_url' ) ? tachyon_url( wp_get_attachment_url( $id ) ) : null ];
		}
		echo wp_json_encode( $out );`;
	return JSON.parse( wp( `--require=${ REQUIRE }`, `--url=${ site }`, 'eval', php ) ).map( o => ( {
		...o,
		key: o.url && decodeURIComponent( new URL( o.url ).pathname.slice( 1 ) ),
	} ) );
}

/**
 * Run Wrangler against the remote R2 bucket.
 */
function wrangler( ...args ) {
	execFileSync( 'npx', [ 'wrangler', ...args, '--remote' ], { stdio: 'inherit', env: { ...process.env, CLOUDFLARE_SEND_METRICS: 'false' } } );
}

/**
 * Generate the fixture images: a landscape JPEG, a transparent portrait PNG,
 * a WebP and a JPEG smaller than every intermediate size.
 */
async function fixtures( dir ) {
	const quadrants = ( width, height ) => sharp( { create: { width, height, channels: 3, background: '#000000' } } )
		.composite( [ [ '#ff0000', 0, 0 ], [ '#00ff00', 1, 0 ], [ '#0000ff', 0, 1 ], [ '#ffff00', 1, 1 ] ].map( ( [ background, x, y ] ) => ( {
			input: { create: { width: width / 2, height: height / 2, channels: 3, background } },
			left: x * width / 2,
			top: y * height / 2,
		} ) ) );
	const files = {
		'tachyon-acceptance-landscape.jpg': await quadrants( 2400, 1600 ).jpeg( { quality: 90 } ).toBuffer(),
		'tachyon-acceptance-portrait.png': await sharp( await quadrants( 1000, 1500 ).png().toBuffer() ).ensureAlpha( 0.5 ).png().toBuffer(),
		'tachyon-acceptance-wide.webp': await quadrants( 1600, 900 ).webp( { quality: 90 } ).toBuffer(),
		'tachyon-acceptance-small.jpg': await quadrants( 200, 120 ).jpeg( { quality: 90 } ).toBuffer(),
	};
	return Promise.all( Object.entries( files ).map( async ( [ name, buffer ] ) => {
		const path = join( dir, name );
		await sharp( buffer ).toFile( path );
		return path;
	} ) );
}

/**
 * Delete the acceptance attachments and their R2 Originals.
 */
function removeAttachments( site ) {
	const existing = originals( site );
	for ( const { key } of existing ) {
		if ( key ) {
			wrangler( 'r2', 'object', 'delete', `${ BUCKET }/${ key }` );
		}
	}
	if ( existing.length ) {
		wp( `--url=${ site }`, 'post', 'delete', ...existing.map( o => String( o.id ) ), '--force' );
	}
}

/**
 * Create the site if needed, install and activate the plugin there, import the fixtures and upload the Originals.
 */
async function prepare() {
	let site = findSite();
	if ( ! site ) {
		// Other network plugins can fatal on site-creation hooks after the site exists; check for the site instead.
		wpOk( 'site', 'create', `--slug=${ SLUG }`, '--title=Tachyon Edge acceptance', '--porcelain' );
		site = findSite();
		if ( ! site ) {
			throw new Error( `Could not create the sub-site "${ SLUG }".` );
		}
	}
	if ( ! wpOk( 'plugin', 'is-installed', PLUGIN_SLUG ) ) {
		wp( 'plugin', 'install', PLUGIN_ZIP );
	}
	const version = wp( 'plugin', 'get', PLUGIN_SLUG, '--field=version' );
	if ( version !== '0.11.1' ) {
		throw new Error( `Expected ${ PLUGIN_SLUG } 0.11.1, found ${ version }. Remove it and run prepare again.` );
	}
	wp( `--url=${ site }`, 'plugin', 'activate', PLUGIN_SLUG );

	removeAttachments( site );
	const dir = mkdtempSync( join( tmpdir(), 'tachyon-acceptance-' ) );
	try {
		for ( const file of await fixtures( dir ) ) {
			const id = wp( `--url=${ site }`, 'media', 'import', file, '--porcelain' );
			wp( `--url=${ site }`, 'post', 'meta', 'update', id, '_tachyon_acceptance', '1' );
		}
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
	for ( const { file, key } of originals( site ) ) {
		wrangler( 'r2', 'object', 'put', `${ BUCKET }/${ key }`, '--file', file );
	}
	console.log( `Prepared ${ site } with ${ PLUGIN_SLUG } ${ version } and TACHYON_URL=${ TACHYON_URL }` );
}

/**
 * Remove the R2 Originals and attachments, the sub-site the test created, and the plugin.
 */
function cleanup() {
	const site = findSite();
	if ( site ) {
		removeAttachments( site );
		if ( ! process.env.WP_SITE_URL ) {
			wp( 'site', 'delete', `--slug=${ SLUG }`, '--yes' );
		}
	}
	if ( wpOk( 'plugin', 'is-installed', PLUGIN_SLUG ) && ! process.env.TACHYON_ACCEPTANCE_KEEP_PLUGIN ) {
		wp( 'plugin', 'delete', PLUGIN_SLUG );
	}
	console.log( 'Cleaned up the acceptance site, attachments, R2 Originals and plugin.' );
}

if ( ! TACHYON_URL ) {
	throw new Error( 'Set TACHYON_URL, e.g. https://<worker>/uploads' );
}
const command = process.argv[2];
if ( command === 'prepare' ) {
	await prepare();
} else if ( command === 'cleanup' ) {
	cleanup();
} else {
	throw new Error( 'Usage: node tests/acceptance/wp-site.mjs prepare|cleanup' );
}
