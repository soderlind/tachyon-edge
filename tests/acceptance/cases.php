<?php
/**
 * Prints the URLs the Tachyon plugin generates for the acceptance attachments,
 * with the dimensions WordPress claims for each, as one JSON line.
 *
 * Run: wp --require=tests/acceptance/tachyon-url.php --url=<site> eval-file tests/acceptance/cases.php
 */

if ( ! function_exists( 'tachyon_url' ) || ! defined( 'TACHYON_URL' ) ) {
	WP_CLI::error( 'The Tachyon plugin is not active on this site, or TACHYON_URL is not set.' );
}

$ids = get_posts( [
	'post_type'      => 'attachment',
	'post_status'    => 'inherit',
	'posts_per_page' => -1,
	'meta_key'       => '_tachyon_acceptance',
	'fields'         => 'ids',
	'orderby'        => 'ID',
	'order'          => 'ASC',
] );

$cases = [];
foreach ( $ids as $id ) {
	$name = wp_basename( get_attached_file( $id ) );
	$mime = get_post_mime_type( $id );

	// Named sizes and arbitrary sizes, through image_downsize.
	$sizes = [ 'thumbnail', 'medium', 'medium_large', 'large', 'full', [ 300, 200 ], [ 1000, 1000 ] ];
	foreach ( $sizes as $size ) {
		$src = wp_get_attachment_image_src( $id, $size );
		$cases[] = [
			'name'   => sprintf( '%s %s', $name, is_array( $size ) ? implode( 'x', $size ) : $size ),
			'url'    => $src[0],
			'width'  => (int) $src[1],
			'height' => (int) $src[2],
			'mime'   => $mime,
		];
	}

	// Responsive images: each srcset candidate must be as wide as its descriptor says.
	foreach ( explode( ',', (string) wp_get_attachment_image_srcset( $id, 'large' ) ) as $candidate ) {
		if ( preg_match( '/^\s*(\S+)\s+(\d+)w\s*$/', $candidate, $m ) ) {
			$cases[] = [
				'name'   => sprintf( '%s srcset %sw', $name, $m[2] ),
				'url'    => html_entity_decode( $m[1] ),
				'width'  => (int) $m[2],
				'height' => null,
				'mime'   => $mime,
			];
		}
	}

	// Post content: an <img> inserted at the medium size, rewritten by the the_content filter.
	$meta = wp_get_attachment_metadata( $id );
	if ( ! empty( $meta['sizes']['medium'] ) ) {
		$medium = $meta['sizes']['medium'];
		$html   = apply_filters( 'the_content', sprintf(
			'<img src="%s" width="%d" height="%d" class="wp-image-%d size-medium" alt="" />',
			esc_url( dirname( wp_get_attachment_url( $id ) ) . '/' . $medium['file'] ),
			$medium['width'],
			$medium['height'],
			$id
		) );
		$tags = new WP_HTML_Tag_Processor( $html );
		if ( $tags->next_tag( 'img' ) ) {
			// The plugin drops width/height from content images, so expect the inserted size.
			$cases[] = [
				'name'   => sprintf( '%s the_content medium', $name ),
				'url'    => $tags->get_attribute( 'src' ),
				'width'  => (int) $medium['width'],
				'height' => (int) $medium['height'],
				'mime'   => $mime,
			];
			foreach ( explode( ',', (string) $tags->get_attribute( 'srcset' ) ) as $candidate ) {
				if ( preg_match( '/^\s*(\S+)\s+(\d+)w\s*$/', $candidate, $m ) ) {
					$cases[] = [
						'name'   => sprintf( '%s the_content srcset %dw', $name, $m[2] ),
						'url'    => html_entity_decode( $m[1] ),
						'width'  => (int) $m[2],
						'height' => null,
						'mime'   => $mime,
					];
				}
			}
		}
	}
}

echo 'TACHYON_CASES ' . wp_json_encode( [
	'tachyon_url' => TACHYON_URL,
	'cases'       => $cases,
] ) . PHP_EOL;
