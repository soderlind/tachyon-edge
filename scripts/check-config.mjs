/**
 * Check that every Wrangler configuration that binds BUCKET names the same bucket
 * in TACHYON_R2_BUCKET. The R2 binding cannot report its bucket, so the Worker
 * relies on this variable to keep cached Variants apart per bucket (ADR 0010).
 * Runs as the Wrangler build command and in `npm test`.
 * Usage: node scripts/check-config.mjs [wrangler.jsonc]
 */
import { readFileSync } from 'node:fs';

import ts from 'typescript';

const file = process.argv[2] || 'wrangler.jsonc';
const { config, error } = ts.parseConfigFileTextToJson( file, readFileSync( file, 'utf8' ) );
if ( error ) {
	console.error( `${ file }: ${ ts.flattenDiagnosticMessageText( error.messageText, '\n' ) }` );
	process.exit( 1 );
}

// `vars` and bindings are not inherited by Wrangler environments, so check each one on its own.
const targets = [ [ 'top level', config ], ...Object.entries( config.env || {} ).map( ( [ name, env ] ) => [ `env.${ name }`, env ] ) ];
const problems = [];
for ( const [ name, target ] of targets ) {
	const vars = target.vars || {};
	const bucket = ( target.r2_buckets || [] ).find( binding => binding.binding === 'BUCKET' );
	if ( ( vars.TACHYON_ORIGIN || 'r2' ) !== 'r2' || ! bucket ) {
		continue;
	}
	if ( vars.TACHYON_R2_BUCKET !== bucket.bucket_name ) {
		problems.push( `${ name }: vars.TACHYON_R2_BUCKET is ${ JSON.stringify( vars.TACHYON_R2_BUCKET ?? null ) } but BUCKET is bound to "${ bucket.bucket_name }"` );
	}
}

if ( problems.length ) {
	console.error( `${ file }: TACHYON_R2_BUCKET must equal the bucket_name bound as BUCKET.\n  ${ problems.join( '\n  ' ) }` );
	process.exit( 1 );
}
