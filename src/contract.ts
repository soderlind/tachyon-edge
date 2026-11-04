/**
 * The Tachyon WordPress plugin request contract (ADR 0006).
 *
 * Query parsing, Object Key derivation and argument validation mirror
 * Tachyon v3.0.8 so that every URL the plugin generates is accepted.
 */

export interface TachyonArgs {
	background?: string;
	crop?: string;
	crop_strategy?: string;
	fit?: string;
	gravity?: string;
	h?: string;
	lb?: string;
	quality?: string;
	resize?: string;
	w?: string;
	webp?: string;
	zoom?: string;
}

export interface Presign {
	algorithm?: string;
	credential?: string;
	date?: string;
	expires?: string;
	signedHeaders?: string;
	signature?: string;
	securityToken?: string;
	/** Every X-Amz-* / SDK presign parameter, in received form, for canonicalisation. */
	params: [ string, string ][];
}

export interface TachyonRequest {
	/** Object Key as Tachyon derives it (and WordPress signs it), before any storage prefix. */
	key: string;
	args: TachyonArgs;
	webp: boolean;
	presign?: Presign;
}

const ARG_NAMES: ( keyof TachyonArgs )[] = [
	'background', 'crop', 'crop_strategy', 'fit', 'gravity', 'h', 'lb', 'quality', 'resize', 'w', 'webp', 'zoom',
];

const PRESIGN_PARAM = /^(x-amz-|x-id$)/i;

/** Join duplicate parameters with commas, as Lambda Function URLs do. */
export function lambdaQuery( search: URLSearchParams ): Map<string, string> {
	const query = new Map<string, string>();
	for ( const [ name, value ] of search ) {
		const previous = query.get( name );
		query.set( name, previous === undefined ? value : `${ previous },${ value }` );
	}
	return query;
}

/** Derive the Object Key exactly as Tachyon does. Throws URIError on malformed paths. */
export function objectKey( pathname: string, prefix = '' ): string {
	return prefix + decodeURIComponent( pathname.substring( 1 ) ).replace( '/tachyon/', '/' );
}

/** Drop invalid arguments, using Tachyon v3.0.8's validation patterns. */
export function validateArgs( args: TachyonArgs ): TachyonArgs {
	const rules: Partial<Record<keyof TachyonArgs, ( value: string ) => boolean>> = {
		/**
		 *
		 */
		w: v => /^[1-9]\d*$/.test( v ),
		/**
		 *
		 */
		h: v => /^[1-9]\d*$/.test( v ),
		/**
		 *
		 */
		quality: v => /^[0-9]{1,3}$/.test( v ) && Number( v ) <= 100,
		/**
		 *
		 */
		resize: v => /^\d+(px)?,\d+(px)?$/.test( v ),
		/**
		 *
		 */
		crop_strategy: v => /^(smart|entropy|attention)$/.test( v ),
		/**
		 *
		 */
		gravity: v => /^(north|northeast|east|southeast|south|southwest|west|northwest|center)$/.test( v ),
		/**
		 *
		 */
		fit: v => /^\d+(px)?,\d+(px)?$/.test( v ),
		/**
		 *
		 */
		crop: v => /^\d+(px)?,\d+(px)?,\d+(px)?,\d+(px)?$/.test( v ),
		/**
		 *
		 */
		zoom: v => /^\d+(\.\d+)?$/.test( v ),
		// Release Quirk: the unanchored alternation accepts any value starting with 0 or containing 1/true/false.
		/**
		 *
		 */
		webp: v => /^0|1|true|false$/.test( v ),
		/**
		 *
		 */
		lb: v => /^\d+(px)?,\d+(px)?$/.test( v ),
		/**
		 *
		 */
		background: v => /^#[a-f0-9]{3}[a-f0-9]{3}?$/.test( v ),
	};
	const valid: TachyonArgs = {};
	for ( const name of ARG_NAMES ) {
		const value = args[name];
		// Tachyon only validates truthy values; empty strings are ignored.
		if ( value && rules[name]!( value ) ) {
			valid[name] = value;
		}
	}
	return valid;
}

/** Collect presign parameters from `presign` (plugin >= server 3.0.0) or raw X-Amz-* query parameters. */
function parsePresign( query: Map<string, string> ): Presign | undefined {
	const params: [ string, string ][] = [];
	const presign = query.get( 'presign' );
	if ( presign ) {
		for ( const entry of new URLSearchParams( presign ) ) {
			params.push( entry );
		}
	}
	for ( const [ name, value ] of query ) {
		if ( PRESIGN_PARAM.test( name ) && ! params.some( ( [ existing ] ) => existing === name ) ) {
			params.push( [ name, value ] );
		}
	}
	if ( ! params.some( ( [ name ] ) => name.toLowerCase().startsWith( 'x-amz-' ) ) ) {
		return undefined;
	}

	/**
	 *
	 */
	const get = ( name: string ) => params.find( ( [ key ] ) => key.toLowerCase() === name.toLowerCase() )?.[1];
	return {
		algorithm: get( 'X-Amz-Algorithm' ),
		credential: get( 'X-Amz-Credential' ),
		date: get( 'X-Amz-Date' ),
		expires: get( 'X-Amz-Expires' ),
		signedHeaders: get( 'X-Amz-SignedHeaders' ),
		signature: get( 'X-Amz-Signature' ),
		securityToken: get( 'X-Amz-Security-Token' ),
		params,
	};
}

/** Parse a request into the Plugin Contract. */
export function parseRequest( request: Request ): TachyonRequest {
	const url = new URL( request.url );
	const query = lambdaQuery( url.searchParams );
	const raw: TachyonArgs = {};
	for ( const name of ARG_NAMES ) {
		const value = query.get( name );
		if ( value !== undefined ) {
			raw[name] = value;
		}
	}

	// `webp` from the query wins (even when empty); otherwise any X-WebP header selects WebP.
	const args = validateArgs( raw );
	const webp = query.has( 'webp' ) ? Boolean( args.webp ) : request.headers.has( 'X-WebP' );

	return {
		key: objectKey( url.pathname ),
		args,
		webp,
		presign: parsePresign( query ),
	};
}
