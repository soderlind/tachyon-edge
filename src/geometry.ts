/**
 * Geometry planner (ADR 0007).
 *
 * Computes the exact output geometry Tachyon v3.0.8's Sharp pipeline would
 * produce, and expresses it as explicit Images binding operations so the
 * result never depends on Cloudflare's own fit heuristics.
 */
import type { TachyonArgs } from './contract.js';

export type SourceFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif';

export interface Source {
	format: SourceFormat;
	/** Display dimensions, after applying EXIF orientation. */
	width: number;
	height: number;
	/** Stored dimensions, before EXIF orientation (Tachyon's percentage-crop basis). */
	storedWidth: number;
	storedHeight: number;
	/** EXIF orientation (1 when absent). */
	orientation: number;
}

export type Gravity = { x: number; y: number; mode: 'remainder' } | 'auto';

/** Subset of the Images binding ImageTransform the planner emits. */
export interface Transform {
	width?: number;
	height?: number;
	fit?: 'squeeze' | 'cover';
	gravity?: Gravity;
	trim?: { top: number; right: number; bottom: number; left: number };
	border?: { color: string; top: number; right: number; bottom: number; left: number };
	/** Clockwise degrees. */
	rotate?: 90 | 180 | 270;
	flip?: 'h' | 'v';
}

/**
 * Steps that turn stored pixels into display orientation. The Images binding
 * applies EXIF orientation itself for JPEG only, so PNG `eXIf` and WebP `EXIF`
 * orientation must be applied explicitly before the planned transforms.
 */
export function orientationTransforms( source: Source ): Transform[] {
	if ( source.format !== 'png' && source.format !== 'webp' ) {
		return [];
	}
	const steps: Record<number, Transform[]> = {
		2: [ { flip: 'h' } ],
		3: [ { rotate: 180 } ],
		4: [ { flip: 'v' } ],
		5: [ { rotate: 90 }, { flip: 'h' } ],
		6: [ { rotate: 90 } ],
		7: [ { rotate: 270 }, { flip: 'h' } ],
		8: [ { rotate: 270 } ],
	};
	return steps[source.orientation] || [];
}

export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/avif';

export interface Plan {
	width: number;
	height: number;
	transforms: Transform[];
	format: OutputFormat;
	quality?: number;
}

/**
 *
 */
export class PlanError extends Error {
	name = 'PlanError';
}

type Canvas = 'crop' | 'embed' | 'max';

const GRAVITY: Record<string, [ number, number ]> = {
	north: [ 0.5, 0 ],
	northeast: [ 1, 0 ],
	east: [ 1, 0.5 ],
	southeast: [ 1, 1 ],
	south: [ 0.5, 1 ],
	southwest: [ 0, 1 ],
	west: [ 0, 0.5 ],
	northwest: [ 0, 0 ],
	center: [ 0.5, 0.5 ],
	centre: [ 0.5, 0.5 ],
};

/** Tachyon's getDimArray: a `px` suffix or zero yields null (Release Quirk). */
function dims( value: string, zoom = 1 ): ( number | null )[] {
	return value.split( ',' ).map( v => Math.round( Number( v ) * zoom ) || null );
}

/** Sharp's ResolveShrink with withoutEnlargement. */
function resolveShrink( width: number, height: number, tw: number | null, th: number | null, canvas: Canvas ): [ number, number ] {
	let h = 1;
	let v = 1;
	if ( tw && th ) {
		h = width / tw;
		v = height / th;
		const s = canvas === 'crop' ? Math.min( h, v ) : Math.max( h, v );
		h = v = s;
	} else if ( tw ) {
		h = v = width / tw;
	} else if ( th ) {
		h = v = height / th;
	}
	h = Math.min( Math.max( 1, h ), width );
	v = Math.min( Math.max( 1, v ), height );
	return [ h, v ];
}

/** Resize dimensions Sharp produces for a shrink pair. */
function shrunk( width: number, height: number, [ h, v ]: [ number, number ] ): [ number, number ] {
	return [ Math.max( 1, Math.round( width / h ) ), Math.max( 1, Math.round( height / v ) ) ];
}

/**
 * Sharp's resize output size, including JPEG shrink-on-load: libjpeg decodes at
 * 1/2, 1/4 or 1/8 scale (flooring each axis) and the residual shrink is
 * recomputed from that intermediate size, which shifts rounding by a pixel.
 */
function resized( width: number, height: number, tw: number | null, th: number | null, canvas: Canvas, jpegPreshrink: boolean ): [ number, number ] {
	let shrink = resolveShrink( width, height, tw, th, canvas );
	if ( jpegPreshrink ) {
		const common = Math.min( ...shrink );
		let factor = common >= 8 ? 8 : common >= 4 ? 4 : common >= 2 ? 2 : 1;
		if ( factor > 1 && Math.trunc( common ) === factor ) {
			factor /= 2;
		}
		if ( factor > 1 ) {
			width = Math.floor( width / factor );
			height = Math.floor( height / factor );
			shrink = resolveShrink( width, height, tw, th, canvas );
		}
	}
	return shrunk( width, height, shrink );
}

/** Tachyon's logarithmic default quality for a zoom level. */
export function zoomQuality( defaultValue: number, zoom: number ): number {
	const value = Math.round( defaultValue - ( Math.log( zoom ) / Math.log( defaultValue / zoom ) ) * ( defaultValue * zoom ) );
	const min = Math.round( defaultValue / zoom );
	return Math.min( Math.max( value, min ), defaultValue );
}

/** Crop region smartcrop selects for a target (dimensions only; position is content-aware). */
function smartcropSize( width: number, height: number, tw: number, th: number ): [ number, number ] {
	const scale = Math.min( width / tw, height / th );
	let cw = Math.trunc( tw * scale );
	let ch = Math.trunc( th * scale );
	const prescale = Math.min( Math.max( 256 / width, 256 / height ), 1 );
	if ( prescale < 1 ) {
		cw = Math.trunc( Math.trunc( cw * prescale ) / prescale );
		ch = Math.trunc( Math.trunc( ch * prescale ) / prescale );
	}
	return [ cw, ch ];
}

/** Convert a Tachyon `crop` argument into a pixel region in display coordinates. */
function cropRegion( crop: string, source: Source ) {
	const [ left, top, width, height ] = crop.split( ',' ).map( ( value, index ) => {
		if ( value.includes( 'px' ) ) {
			return Number( value.slice( 0, -2 ) );
		}
		const basis = index % 2 ? source.storedHeight : source.storedWidth;
		return Number( ( basis * ( Number( value ) / 100 ) ).toFixed( 0 ) );
	} );
	if ( width < 1 || height < 1 || left + width > source.width || top + height > source.height ) {
		throw new PlanError( 'crop region is outside the image' );
	}
	return {
		left,
		top,
		width,
		height,
	};
}

/** Build the geometry and encoding plan for a request. */
export function plan( source: Source, args: TachyonArgs, webp: boolean ): Plan {
	const transforms: Transform[] = [];
	let width = source.width;
	let height = source.height;

	if ( args.crop ) {
		const region = cropRegion( args.crop, source );
		transforms.push( {
			trim: {
				top: region.top,
				left: region.left,
				bottom: height - region.top - region.height,
				right: width - region.left - region.width,
			},
		} );
		width = region.width;
		height = region.height;
	}

	const zoom = parseFloat( args.zoom || '1' ) || 1;
	// Sharp only shrinks on load without EXIF rotation/flip and without a pre-resize extract.
	let preshrink = source.format === 'jpeg' && source.orientation === 1 && ! args.crop;

	/** Proportional resize to exact dimensions. */
	const squeeze = ( w: number, h: number ) => {
		if ( w !== width || h !== height ) {
			transforms.push( {
				width: w,
				height: h,
				fit: 'squeeze',
			} );
			width = w;
			height = h;
		}
	};
	/** Fill-and-crop to exact dimensions that never exceed the scaled image. */
	const cover = ( w: number, h: number, gravity: Gravity ) => {
		if ( w !== width || h !== height ) {
			transforms.push( {
				width: w,
				height: h,
				fit: 'cover',
				gravity,
			} );
			width = w;
			height = h;
		}
	};

	if ( args.resize ) {
		let [ tw, th ] = dims( args.resize, zoom );
		const strategy = args.crop_strategy;
		const position = ( strategy !== 'smart' && strategy ) || args.gravity || 'centre';
		const [ uw, uh ] = dims( args.resize );
		if ( strategy === 'smart' && ! args.crop && uw && uh ) {
			const [ cw, ch ] = smartcropSize( width, height, uw, uh );
			cover( cw, ch, 'auto' );
			preshrink = false;
		}
		const gravity: Gravity = GRAVITY[position] ? {
			x: GRAVITY[position][0],
			y: GRAVITY[position][1],
			mode: 'remainder',
		} : 'auto';
		const [ rw, rh ] = resized( width, height, tw, th, 'crop', preshrink );
		if ( tw && th ) {
			const finalW = Math.min( rw, tw );
			const finalH = Math.min( rh, th );
			if ( finalW === rw && finalH === rh ) {
				squeeze( rw, rh );
			} else {
				cover( finalW, finalH, gravity );
			}
		} else {
			squeeze( rw, rh );
		}
	} else if ( args.fit ) {
		const [ tw, th ] = dims( args.fit, zoom );
		squeeze( ...resized( width, height, tw, th, 'max', preshrink ) );
	} else if ( args.lb ) {
		const [ tw, th ] = dims( args.lb, zoom );
		const [ iw, ih ] = resized( width, height, tw, th, 'embed', preshrink );
		squeeze( iw, ih );
		const canvasW = tw || iw;
		const canvasH = th || ih;
		if ( canvasW !== iw || canvasH !== ih ) {
			const left = Math.floor( ( canvasW - iw ) / 2 );
			const top = Math.floor( ( canvasH - ih ) / 2 );
			transforms.push( {
				border: {
					color: args.background || '#000000',
					top,
					bottom: canvasH - ih - top,
					left,
					right: canvasW - iw - left,
				},
			} );
			width = canvasW;
			height = canvasH;
		}
	} else if ( args.w || args.h ) {
		// Tachyon passes unrounded zoomed values, which Sharp rejects; rounding serves them instead.
		const tw = Math.round( Number( args.w ) * zoom ) || null;
		const th = Math.round( Number( args.h ) * zoom ) || null;
		const canvas: Canvas = args.crop ? 'crop' : 'max';
		const [ rw, rh ] = resized( width, height, tw, th, canvas, preshrink );
		if ( canvas === 'crop' && tw && th && ( rw > tw || rh > th ) ) {
			cover( Math.min( rw, tw ), Math.min( rh, th ), {
				x: 0.5,
				y: 0.5,
				mode: 'remainder',
			} );
		} else {
			squeeze( rw, rh );
		}
	}

	const quality = args.quality ? Number( args.quality ) : zoomQuality( 82, zoom );
	let format: OutputFormat;
	let outputQuality: number | undefined;
	if ( webp ) {
		format = 'image/webp';
		outputQuality = quality;
	} else if ( source.format === 'jpeg' ) {
		format = 'image/jpeg';
		outputQuality = quality;
	} else if ( source.format === 'png' ) {
		// An explicit quality makes Cloudflare emit palette PNG, like Tachyon's png({ palette: true }).
		format = 'image/png';
		outputQuality = 100;
	} else if ( source.format === 'webp' ) {
		// Sharp's default WebP quality when Tachyon does not set one.
		format = 'image/webp';
		outputQuality = 80;
	} else {
		format = `image/${ source.format }`;
	}

	return {
		width,
		height,
		transforms,
		format,
		quality: outputQuality,
	};
}
