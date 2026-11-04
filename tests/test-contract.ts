import { describe, expect, test } from '@jest/globals';

import { lambdaQuery, objectKey, parseRequest, validateArgs } from '../src/contract';

/** Build a Tachyon URL the way the plugin's tachyon_url() does (add_query_arg with rawurlencode'd values). */
function pluginUrl( path: string, args: Record<string, string> = {}, presign?: Record<string, string>, extra = '' ) {
	const query: string[] = [];
	if ( extra ) {
		query.push( extra );
	}
	if ( presign ) {
		// urlencode( http_build_query( $presign ) ), appended unencoded by add_query_arg.
		query.push( `presign=${ encodeURIComponent( new URLSearchParams( presign ).toString() ) }` );
	}
	for ( const [ name, value ] of Object.entries( args ) ) {
		query.push( `${ name }=${ encodeURIComponent( value ) }` );
	}
	return `https://cdn.example.test${ path }${ query.length ? `?${ query.join( '&' ) }` : '' }`;
}

describe( 'Object Key', () => {
	test.each( [
		[ '/uploads/2026/11/photo.jpg', 'uploads/2026/11/photo.jpg' ],
		[ '/uploads/sites/3/2026/11/photo.jpg', 'uploads/sites/3/2026/11/photo.jpg' ],
		[ '/uploads/2026/11/caf%C3%A9.jpg', 'uploads/2026/11/café.jpg' ],
		[ '/uploads/2026/11/my+photo.jpg', 'uploads/2026/11/my+photo.jpg' ],
		[ '/uploads/tachyon/2026/photo.jpg', 'uploads/2026/photo.jpg' ],
		[ '/tachyon/2026/photo.jpg', 'tachyon/2026/photo.jpg' ],
	] )( '%s -> %s', ( path, key ) => {
		expect( objectKey( path ) ).toBe( key );
	} );

	test( 'prefix is prepended', () => {
		expect( objectKey( '/a.jpg', 'site-1/' ) ).toBe( 'site-1/a.jpg' );
	} );

	test( 'malformed escapes throw', () => {
		expect( () => objectKey( '/bad%E0.jpg' ) ).toThrow( URIError );
	} );
} );

describe( 'arguments', () => {
	test( 'duplicate parameters join with commas, like Lambda Function URLs', () => {
		expect( lambdaQuery( new URLSearchParams( 'w=1&w=2&h=3' ) ) ).toEqual( new Map( [ [ 'w', '1,2' ], [ 'h', '3' ] ] ) );
	} );

	test( 'invalid values are dropped, valid kept', () => {
		expect( validateArgs( {
			w: '0',
			h: '200',
			quality: '101',
			resize: '300,200',
			crop_strategy: 'face',
			gravity: 'center',
			fit: '300px,200',
			crop: '1,2,3',
			zoom: '1.5',
			lb: 'x',
			background: '#FFF',
		} ) ).toEqual( {
			h: '200',
			resize: '300,200',
			gravity: 'center',
			fit: '300px,200',
			zoom: '1.5',
		} );
	} );

	test( 'empty values are ignored (the plugin emits gravity= for center)', () => {
		expect( validateArgs( {
			gravity: '',
			resize: '10,10',
		} ) ).toEqual( { resize: '10,10' } );
	} );

	test.each( [ '0', 'false', '1', 'true', '0abc', 'xtruex' ] )( 'webp=%s selects WebP (Release Quirk)', value => {
		expect( parseRequest( new Request( pluginUrl( '/a.jpg', { webp: value } ) ) ).webp ).toBe( true );
	} );

	test( 'webp=x does not select WebP', () => {
		expect( parseRequest( new Request( pluginUrl( '/a.jpg', { webp: 'x' } ) ) ).webp ).toBe( false );
	} );

	test( 'X-WebP header selects WebP unless the query has webp', () => {
		const headers = { 'X-WebP': '1' };
		expect( parseRequest( new Request( pluginUrl( '/a.jpg' ), { headers } ) ).webp ).toBe( true );
		expect( parseRequest( new Request( `${ pluginUrl( '/a.jpg' ) }?webp=`, { headers } ) ).webp ).toBe( false );
		expect( parseRequest( new Request( pluginUrl( '/a.jpg' ) ) ).webp ).toBe( false );
	} );

	test( 'plugin args survive rawurlencode', () => {
		const request = parseRequest( new Request( pluginUrl( '/uploads/a.jpg', {
			resize: '300,200',
			gravity: '',
			crop_strategy: 'smart',
			quality: '80',
		} ) ) );
		expect( request.args ).toEqual( {
			resize: '300,200',
			crop_strategy: 'smart',
			quality: '80',
		} );
		expect( request.presign ).toBeUndefined();
	} );
} );

describe( 'presign', () => {
	const presign = {
		'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
		'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
		'X-Amz-Credential': 'AKID/20261104/us-east-1/s3/aws4_request',
		'X-Amz-Date': '20261104T120000Z',
		'X-Amz-SignedHeaders': 'host',
		'X-Amz-Expires': '300',
		'X-Amz-Signature': 'abc123',
	};

	test( 'is read from the presign parameter, keeping raw x-id', () => {
		const request = parseRequest( new Request( pluginUrl( '/uploads/a.jpg', { w: '100' }, presign, 'x-id=GetObject' ) ) );
		expect( request.args ).toEqual( { w: '100' } );
		expect( request.presign ).toMatchObject( {
			algorithm: 'AWS4-HMAC-SHA256',
			credential: 'AKID/20261104/us-east-1/s3/aws4_request',
			date: '20261104T120000Z',
			expires: '300',
			signature: 'abc123',
		} );
		expect( request.presign!.params ).toEqual( [ ...Object.entries( presign ), [ 'x-id', 'GetObject' ] ] );
	} );

	test( 'is read from raw X-Amz-* parameters', () => {
		const raw = new URLSearchParams( presign ).toString();
		const request = parseRequest( new Request( `https://cdn.example.test/uploads/a.jpg?${ raw }&w=100` ) );
		expect( request.presign?.signature ).toBe( 'abc123' );
		expect( request.presign?.params ).toHaveLength( 7 );
	} );
} );
