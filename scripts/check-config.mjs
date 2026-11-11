/**
 * Check that every Wrangler configuration that binds BUCKET names the same bucket
 * in TACHYON_R2_BUCKET. The R2 binding cannot report its bucket, so the Worker
 * relies on this variable to keep cached Variants apart per bucket (ADR 0010).
 * Runs as the Wrangler build command and in `npm test`.
 *
 * With --sync, a mismatched or missing TACHYON_R2_BUCKET is rewritten to the bound
 * bucket_name instead of failing. `npm run deploy` (and so the Deploy to Cloudflare
 * button, which can rename the bucket) syncs before deploying.
 *
 * Usage: node scripts/check-config.mjs [--sync] [wrangler.jsonc]
 */
import { readFileSync, writeFileSync } from 'node:fs';

import ts from 'typescript';

const args = process.argv.slice( 2 );
const sync = args.includes( '--sync' );
const file = args.find( arg => arg !== '--sync' ) || 'wrangler.jsonc';
const text = readFileSync( file, 'utf8' );
const { config, error } = ts.parseConfigFileTextToJson( file, text );
if ( error ) {
	console.error( `${ file }: ${ ts.flattenDiagnosticMessageText( error.messageText, '\n' ) }` );
	process.exit( 1 );
}

// Syntax tree of the same text, so --sync can edit values in place and keep comments.
const source = ts.parseJsonText( file, text );
const property = ( object, key ) => object && ts.isObjectLiteralExpression( object )
	? object.properties.find( node => ts.isPropertyAssignment( node ) && node.name.text === key )?.initializer
	: undefined;
const root = source.statements[ 0 ]?.expression;

// `vars` and bindings are not inherited by Wrangler environments, so check each one on its own.
const targets = [
	[ 'top level', config, root ],
	...Object.entries( config.env || {} ).map( ( [ name, env ] ) => [ `env.${ name }`, env, property( property( root, 'env' ), name ) ] ),
];
const problems = [];
const edits = [];
for ( const [ name, target, node ] of targets ) {
	const vars = target.vars || {};
	const bucket = ( target.r2_buckets || [] ).find( binding => binding.binding === 'BUCKET' );
	if ( ( vars.TACHYON_ORIGIN || 'r2' ) !== 'r2' || ! bucket || vars.TACHYON_R2_BUCKET === bucket.bucket_name ) {
		continue;
	}
	const varsNode = property( node, 'vars' );
	const value = property( varsNode, 'TACHYON_R2_BUCKET' );
	const quoted = JSON.stringify( bucket.bucket_name );
	if ( sync && value ) {
		edits.push( { start: value.getStart( source ), end: value.end, text: quoted, name } );
	} else if ( sync && varsNode && ts.isObjectLiteralExpression( varsNode ) ) {
		const start = varsNode.getStart( source ) + 1;
		edits.push( { start, end: start, text: ` "TACHYON_R2_BUCKET": ${ quoted },`, name } );
	} else {
		problems.push( `${ name }: vars.TACHYON_R2_BUCKET is ${ JSON.stringify( vars.TACHYON_R2_BUCKET ?? null ) } but BUCKET is bound to "${ bucket.bucket_name }"` );
	}
}

if ( problems.length ) {
	const hint = sync ? '' : '\n  Run `npm run deploy`, or `node scripts/check-config.mjs --sync`, to set it from bucket_name.';
	console.error( `${ file }: TACHYON_R2_BUCKET must equal the bucket_name bound as BUCKET.\n  ${ problems.join( '\n  ' ) }${ hint }` );
	process.exit( 1 );
}

if ( edits.length ) {
	let updated = text;
	for ( const edit of [ ...edits ].sort( ( a, b ) => b.start - a.start ) ) {
		updated = updated.slice( 0, edit.start ) + edit.text + updated.slice( edit.end );
	}
	writeFileSync( file, updated );
	for ( const edit of edits ) {
		console.log( `${ file }: ${ edit.name }: set TACHYON_R2_BUCKET to the bound bucket_name` );
	}
}
