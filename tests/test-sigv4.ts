import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { describe, expect, test } from '@jest/globals';

import { parseRequest } from '../src/contract';
import { secondsUntilExpiry, verifyPresign, type SigningConfig } from '../src/sigv4';

const credentials = {
	accessKeyId: 'AKIDEXAMPLE',
	secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
const SIGNED_AT = new Date( Date.UTC( 2026, 10, 4, 12, 0, 0 ) );
const now = SIGNED_AT.getTime() / 1000 + 10;

const styles = {
	'R2 path-style': {
		client: {
			region: 'auto',
			endpoint: 'https://acct123.r2.cloudflarestorage.com',
			forcePathStyle: true,
		},
		config: {
			host: 'acct123.r2.cloudflarestorage.com',
			pathPrefix: '/uploads-bucket',
		},
	},
	'S3 virtual-hosted': {
		client: { region: 'eu-west-1' },
		config: {
			host: 'uploads-bucket.s3.eu-west-1.amazonaws.com',
			pathPrefix: '',
		},
	},
};

/** Presign like S3 Uploads, then rewrite to a Tachyon URL like the plugin's tachyon_url(). */
async function tachyonRequest( style: keyof typeof styles, key: string, args = '' ): Promise<Request> {
	const client = new S3Client( {
		...styles[style].client,
		credentials,
	} );
	const signed = new URL( await getSignedUrl( client, new GetObjectCommand( {
		Bucket: 'uploads-bucket',
		Key: key,
	} ), {
		expiresIn: 300,
		signingDate: SIGNED_AT,
	} ) );
	const presign = new URLSearchParams();
	const rest = new URLSearchParams();
	for ( const [ name, value ] of signed.searchParams ) {
		( /^x-amz-/i.test( name ) ? presign : rest ).append( name, value );
	}
	const path = key.split( '/' ).map( encodeURIComponent ).join( '/' );
	const query = [ rest.toString(), `presign=${ encodeURIComponent( presign.toString() ) }`, args ].filter( Boolean ).join( '&' );
	return new Request( `https://cdn.example.test/${ path }?${ query }` );
}

/**
 *
 */
function config( style: keyof typeof styles ): SigningConfig {
	return {
		...credentials,
		...styles[style].config,
	};
}

describe.each( Object.keys( styles ) as ( keyof typeof styles )[] )( '%s', style => {
	test.each( [
		'private/2026/11/photo.jpg',
		'private/2026/11/café (1).jpg',
		'private/odd/!\'()*~name.png',
	] )( 'accepts a genuine presign for %s', async key => {
		const request = parseRequest( await tachyonRequest( style, key, 'w=100&resize=10,10' ) );
		expect( await verifyPresign( request.presign!, request.key, config( style ), now ) ).toBe( true );
	} );

	test( 'rejects a different Object Key', async () => {
		const request = parseRequest( await tachyonRequest( style, 'private/a.jpg' ) );
		expect( await verifyPresign( request.presign!, 'private/b.jpg', config( style ), now ) ).toBe( false );
	} );

	test( 'rejects a tampered signature', async () => {
		const request = parseRequest( await tachyonRequest( style, 'private/a.jpg' ) );
		const presign = {
			...request.presign!,
			signature: request.presign!.signature!.replace( /^./, c => ( c === 'a' ? 'b' : 'a' ) ),
		};
		expect( await verifyPresign( presign, request.key, config( style ), now ) ).toBe( false );
	} );

	test( 'rejects a tampered expiry', async () => {
		const request = parseRequest( await tachyonRequest( style, 'private/a.jpg' ) );
		const presign = {
			...request.presign!,
			expires: '600',
			params: request.presign!.params.map( ( [ n, v ] ): [ string, string ] => [ n, n === 'X-Amz-Expires' ? '600' : v ] ),
		};
		expect( await verifyPresign( presign, request.key, config( style ), now ) ).toBe( false );
	} );

	test( 'rejects the wrong secret or access key', async () => {
		const request = parseRequest( await tachyonRequest( style, 'private/a.jpg' ) );
		expect( await verifyPresign( request.presign!, request.key, {
			...config( style ),
			secretAccessKey: 'other',
		}, now ) ).toBe( false );
		expect( await verifyPresign( request.presign!, request.key, {
			...config( style ),
			accessKeyId: 'OTHER',
		}, now ) ).toBe( false );
	} );

	test( 'rejects expired and far-future signatures', async () => {
		const request = parseRequest( await tachyonRequest( style, 'private/a.jpg' ) );
		const signedAt = SIGNED_AT.getTime() / 1000;
		expect( await verifyPresign( request.presign!, request.key, config( style ), signedAt + 301 ) ).toBe( false );
		expect( await verifyPresign( request.presign!, request.key, config( style ), signedAt + 300 ) ).toBe( true );
		expect( await verifyPresign( request.presign!, request.key, config( style ), signedAt - 15 * 60 ) ).toBe( true );
		expect( await verifyPresign( request.presign!, request.key, config( style ), signedAt - 15 * 60 - 1 ) ).toBe( false );
	} );

	test( 'rejects session-token presigns', async () => {
		const request = parseRequest( await tachyonRequest( style, 'private/a.jpg' ) );
		expect( await verifyPresign( {
			...request.presign!,
			securityToken: 'token',
		}, request.key, config( style ), now ) ).toBe( false );
	} );

	test( 'max-age is the remaining validity', async () => {
		const request = parseRequest( await tachyonRequest( style, 'private/a.jpg' ) );
		expect( secondsUntilExpiry( request.presign!, now ) ).toBe( 290 );
	} );
} );
