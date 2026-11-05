<?php
/**
 * Defines TACHYON_URL for the acceptance test's WP-CLI process only.
 *
 * Load with `wp --require=tests/acceptance/tachyon-url.php`, so the Tachyon
 * plugin is enabled without editing wp-config.php.
 */

$tachyon_url = getenv( 'TACHYON_URL' );
if ( $tachyon_url && ! defined( 'TACHYON_URL' ) ) {
	define( 'TACHYON_URL', rtrim( $tachyon_url, '/' ) );
}
