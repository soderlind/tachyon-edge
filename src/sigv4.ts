/**
 * AWS Signature Version 4 query-presign verification (ADR 0009).
 *
 * Rebuilds the canonical request S3 would verify for a presigned GetObject and
 * compares signatures, so private Originals can be served from an R2 binding.
 */
import type { Presign } from './contract.js';

export interface SigningConfig {
	accessKeyId: string;
	secretAccessKey: string;
	/** Host the URL was signed for, e.g. `bucket.s3.us-east-1.amazonaws.com`. */
	host: string;
	/** Path before the Object Key, e.g. `/bucket` for path-style addressing. */
	pathPrefix: string;
}

const MAX_FUTURE_SKEW_SECONDS = 15 * 60;
const MAX_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

/** Parse `YYYYMMDDTHHMMSSZ` to epoch seconds. */
export function amzDateSeconds( value: string | undefined ): number | undefined {
	const match = value?.match( /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/ );
	if ( ! match ) {
		return undefined;
	}
	const [ , y, mo, d, h, mi, s ] = match.map( Number );
	return Date.UTC( y, mo - 1, d, h, mi, s ) / 1000;
}

/** Seconds until the presign expires (Tachyon's signed max-age); undefined when not a presign with expiry. */
export function secondsUntilExpiry( presign: Presign, now: number ): number | undefined {
	const date = amzDateSeconds( presign.date );
	if ( date === undefined || ! presign.expires ) {
		return undefined;
	}
	return Math.round( date + Number( presign.expires ) - now );
}

/** RFC 3986 encoding used by SigV4 (encodes everything except unreserved characters). */
function awsEncode( value: string, keepSlash = false ): string {
	const encoded = encodeURIComponent( value ).replace( /[!'()*]/g, c => `%${ c.charCodeAt( 0 ).toString( 16 ).toUpperCase() }` );
	return keepSlash ? encoded.replace( /%2F/g, '/' ) : encoded;
}

/**
 *
 */
function hex( buffer: ArrayBuffer ): string {
	return Array.from( new Uint8Array( buffer ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}

/**
 *
 */
async function sha256( value: string ): Promise<string> {
	return hex( await crypto.subtle.digest( 'SHA-256', encoder.encode( value ) ) );
}

/**
 *
 */
async function hmac( key: ArrayBuffer | Uint8Array, value: string ): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey( 'raw', key, {
		name: 'HMAC',
		hash: 'SHA-256',
	}, false, [ 'sign' ] );
	return crypto.subtle.sign( 'HMAC', cryptoKey, encoder.encode( value ) );
}

/**
 *
 */
function timingSafeEqual( a: string, b: string ): boolean {
	const left = encoder.encode( a );
	const right = encoder.encode( b );
	let difference = left.length ^ right.length;
	for ( let i = 0; i < left.length; i++ ) {
		difference |= left[i] ^ ( right[i] ?? 0 );
	}
	return difference === 0;
}

/** Verify a presign for an Object Key; false for any malformed, expired, foreign or tampered signature. */
export async function verifyPresign( presign: Presign, key: string, config: SigningConfig, now: number ): Promise<boolean> {
	if ( presign.algorithm !== 'AWS4-HMAC-SHA256' || presign.securityToken || ! presign.signature || ! presign.credential ) {
		return false;
	}
	if ( presign.signedHeaders?.toLowerCase() !== 'host' ) {
		return false;
	}
	const date = amzDateSeconds( presign.date );
	const expires = Number( presign.expires );
	if ( date === undefined || ! /^\d+$/.test( presign.expires || '' ) || expires < 1 || expires > MAX_EXPIRES_SECONDS ) {
		return false;
	}
	if ( now > date + expires || date > now + MAX_FUTURE_SKEW_SECONDS ) {
		return false;
	}

	const [ accessKeyId, scopeDate, region, service, terminator, ...rest ] = presign.credential.split( '/' );
	if ( rest.length || accessKeyId !== config.accessKeyId || scopeDate !== presign.date!.slice( 0, 8 ) || service !== 's3' || terminator !== 'aws4_request' || ! region ) {
		return false;
	}

	const query = presign.params
		.filter( ( [ name ] ) => name !== 'X-Amz-Signature' )
		.map( ( [ name, value ] ) => [ awsEncode( name ), awsEncode( value ) ] )
		.sort( ( [ a, av ], [ b, bv ] ) => ( a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0 ) )
		.map( ( [ name, value ] ) => `${ name }=${ value }` )
		.join( '&' );
	const canonicalRequest = [
		'GET',
		`${ config.pathPrefix.replace( /\/$/, '' ) }/${ awsEncode( key, true ) }`,
		query,
		`host:${ config.host }\n`,
		'host',
		'UNSIGNED-PAYLOAD',
	].join( '\n' );
	const scope = `${ scopeDate }/${ region }/${ service }/${ terminator }`;
	const stringToSign = [ 'AWS4-HMAC-SHA256', presign.date, scope, await sha256( canonicalRequest ) ].join( '\n' );

	let signingKey = await hmac( encoder.encode( `AWS4${ config.secretAccessKey }` ), scopeDate );
	for ( const part of [ region, service, terminator ] ) {
		signingKey = await hmac( signingKey, part );
	}
	const expected = hex( await hmac( signingKey, stringToSign ) );
	return timingSafeEqual( expected, presign.signature.toLowerCase() );
}
