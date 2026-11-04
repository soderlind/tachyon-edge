/**
 * Minimal image header probe: format, stored dimensions and EXIF orientation.
 *
 * Cloudflare Images applies EXIF orientation automatically, so geometry must
 * be planned in display coordinates, as Tachyon does after `rotate()`.
 */
import type { Source, SourceFormat } from './geometry.js';

export interface Probe {
	format: SourceFormat;
	width?: number;
	height?: number;
	orientation: number;
}

/** Read the EXIF orientation from a TIFF block. */
function tiffOrientation( view: DataView, start: number, end: number ): number {
	if ( start + 8 > end ) {
		return 1;
	}
	const little = view.getUint16( start ) === 0x4949;
	const ifd = start + view.getUint32( start + 4, little );
	if ( ifd + 2 > end ) {
		return 1;
	}
	const entries = view.getUint16( ifd, little );
	for ( let i = 0; i < entries; i++ ) {
		const entry = ifd + 2 + i * 12;
		if ( entry + 12 > end ) {
			break;
		}
		if ( view.getUint16( entry, little ) === 0x0112 ) {
			const value = view.getUint16( entry + 8, little );
			return value >= 1 && value <= 8 ? value : 1;
		}
	}
	return 1;
}

/** Parse JPEG markers up to the first frame header. */
function probeJpeg( view: DataView ): Probe {
	let orientation = 1;
	let offset = 2;
	while ( offset + 4 <= view.byteLength ) {
		if ( view.getUint8( offset ) !== 0xff ) {
			offset++;
			continue;
		}
		const marker = view.getUint8( offset + 1 );
		if ( marker === 0xff ) {
			offset++;
			continue;
		}
		if ( marker === 0xd8 || ( marker >= 0xd0 && marker <= 0xd7 ) || marker === 0x01 ) {
			offset += 2;
			continue;
		}
		const length = view.getUint16( offset + 2 );
		const segment = offset + 4;
		const end = Math.min( offset + 2 + length, view.byteLength );
		if ( marker === 0xe1 && segment + 6 <= end && view.getUint32( segment ) === 0x45786966 && view.getUint16( segment + 4 ) === 0 ) {
			orientation = tiffOrientation( view, segment + 6, end );
		}
		const isFrame = marker >= 0xc0 && marker <= 0xcf && ! [ 0xc4, 0xc8, 0xcc ].includes( marker );
		if ( isFrame && segment + 5 <= view.byteLength ) {
			return {
				format: 'jpeg',
				height: view.getUint16( segment + 1 ),
				width: view.getUint16( segment + 3 ),
				orientation,
			};
		}
		if ( marker === 0xda || length < 2 ) {
			break;
		}
		offset += 2 + length;
	}
	return {
		format: 'jpeg',
		orientation,
	};
}

/** Read orientation from a raw TIFF block or one prefixed by the `Exif\0\0` APP1 header. */
function exifOrientation( view: DataView, start: number, end: number ): number {
	if ( start + 6 <= end && view.getUint32( start ) === 0x45786966 && view.getUint16( start + 4 ) === 0 ) {
		start += 6;
	}
	return tiffOrientation( view, start, end );
}

/** Scan extended WebP chunks for EXIF orientation. */
function webpOrientation( view: DataView, bytes: Uint8Array ): number {
	let offset = 12;
	while ( offset + 8 <= bytes.length ) {
		const size = view.getUint32( offset + 4, true );
		const data = offset + 8;
		if ( String.fromCharCode( ...bytes.subarray( offset, offset + 4 ) ) === 'EXIF' ) {
			return exifOrientation( view, data, Math.min( data + size, bytes.length ) );
		}
		offset = data + size + ( size & 1 );
	}
	return 1;
}

/** Scan PNG chunks before the image data for an `eXIf` orientation. */
function pngOrientation( view: DataView, bytes: Uint8Array ): number {
	let offset = 8;
	while ( offset + 8 <= bytes.length ) {
		const length = view.getUint32( offset );
		const type = String.fromCharCode( ...bytes.subarray( offset + 4, offset + 8 ) );
		const data = offset + 8;
		if ( type === 'eXIf' ) {
			return exifOrientation( view, data, Math.min( data + length, bytes.length ) );
		}
		if ( type === 'IDAT' || type === 'IEND' ) {
			break;
		}
		offset = data + length + 4;
	}
	return 1;
}

/** Parse the first WebP chunk header. */
function probeWebp( view: DataView, bytes: Uint8Array ): Probe {
	const chunk = String.fromCharCode( ...bytes.subarray( 12, 16 ) );
	if ( chunk === 'VP8 ' && bytes.length >= 30 ) {
		return {
			format: 'webp',
			width: view.getUint16( 26, true ) & 0x3fff,
			height: view.getUint16( 28, true ) & 0x3fff,
			orientation: 1,
		};
	}
	if ( chunk === 'VP8L' && bytes.length >= 25 ) {
		const bits = view.getUint32( 21, true );
		return {
			format: 'webp',
			width: ( bits & 0x3fff ) + 1,
			height: ( ( bits >> 14 ) & 0x3fff ) + 1,
			orientation: 1,
		};
	}
	if ( chunk === 'VP8X' && bytes.length >= 30 ) {
		/**
		 *
		 */
		const read24 = ( at: number ) => bytes[at] | ( bytes[at + 1] << 8 ) | ( bytes[at + 2] << 16 );
		return {
			format: 'webp',
			width: read24( 24 ) + 1,
			height: read24( 27 ) + 1,
			orientation: bytes[20] & 0x08 ? webpOrientation( view, bytes ) : 1,
		};
	}
	return {
		format: 'webp',
		orientation: 1,
	};
}

/** Identify a supported image and read what the header exposes. */
export function probe( bytes: Uint8Array ): Probe | undefined {
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	/**
	 *
	 */
	const ascii = ( from: number, to: number ) => String.fromCharCode( ...bytes.subarray( from, to ) );
	if ( bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 ) {
		return probeJpeg( view );
	}
	if ( bytes.length >= 24 && ascii( 1, 4 ) === 'PNG' && ascii( 12, 16 ) === 'IHDR' ) {
		return {
			format: 'png',
			width: view.getUint32( 16 ),
			height: view.getUint32( 20 ),
			orientation: pngOrientation( view, bytes ),
		};
	}
	if ( bytes.length >= 10 && ascii( 0, 4 ) === 'GIF8' ) {
		return {
			format: 'gif',
			width: view.getUint16( 6, true ),
			height: view.getUint16( 8, true ),
			orientation: 1,
		};
	}
	if ( bytes.length >= 16 && ascii( 0, 4 ) === 'RIFF' && ascii( 8, 12 ) === 'WEBP' ) {
		return probeWebp( view, bytes );
	}
	if ( bytes.length >= 12 && ascii( 4, 8 ) === 'ftyp' && /^avi[fs]$/.test( ascii( 8, 12 ) ) ) {
		return {
			format: 'avif',
			orientation: 1,
		};
	}
	return undefined;
}

/** Build a planner Source from probed or binding-reported stored dimensions. */
export function toSource( format: SourceFormat, storedWidth: number, storedHeight: number, orientation: number ): Source {
	const swap = orientation >= 5;
	return {
		format,
		storedWidth,
		storedHeight,
		orientation,
		width: swap ? storedHeight : storedWidth,
		height: swap ? storedWidth : storedHeight,
	};
}
