/**
 * Generate the remote smoke fixtures and upload them to R2 below `uploads/`.
 * Usage: node tests/remote/prepare.mjs <fixture-dir> <bucket>
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [ dir, bucket ] = process.argv.slice( 2 );
if ( ! dir || ! bucket ) {
	throw new Error( 'Usage: node tests/remote/prepare.mjs <fixture-dir> <bucket>' );
}
const images = new URL( '../images/', import.meta.url ).pathname;
mkdirSync( dir, { recursive: true } );
for ( const file of readdirSync( images ) ) {
	copyFileSync( join( images, file ), join( dir, file ) );
}

// Red top-left quadrant on blue, so crop position and EXIF handling are visible in pixels.
const marker = await sharp( { create: { width: 400, height: 300, channels: 3, background: '#0000ff' } } )
	.composite( [ { input: { create: { width: 200, height: 150, channels: 3, background: '#ff0000' } }, left: 0, top: 0 } ] )
	.jpeg( { quality: 95 } )
	.toBuffer();
writeFileSync( join( dir, 'marker.jpg' ), marker );
// Stored rotated -90° with orientation 6, so it displays exactly like marker.jpg.
const stored = await sharp( marker ).rotate( -90 ).jpeg( { quality: 95 } ).toBuffer();
writeFileSync( join( dir, 'marker-o6.jpg' ), await sharp( stored ).withMetadata( { orientation: 6 } ).jpeg( { quality: 95 } ).toBuffer() );
writeFileSync( join( dir, 'photo.avif' ), await sharp( join( images, 'hdr.jpg' ) ).resize( 600 ).avif().toBuffer() );

const upload = ( file, key ) => execFileSync( 'npx', [ 'wrangler', 'r2', 'object', 'put', `${ bucket }/${ key }`, '--file', join( dir, file ), '--remote' ], { stdio: 'inherit' } );
for ( const file of readdirSync( dir ) ) {
	upload( file, `uploads/${ file }` );
}
upload( 'marker.jpg', 'uploads/private/secret.jpg' );
