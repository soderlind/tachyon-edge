# Plugin Setup

The Tachyon plugin replaces WordPress' default thumbnail handling with dynamic Tachyon URLs.

[Download from GitHub →](https://github.com/humanmade/tachyon-plugin)

## Installation

Install the Tachyon plugin as a regular plugin in your WordPress install (mu-plugins also supported). Then point it at your Tachyon Edge Worker in `wp-config.php`:

```php
define( 'TACHYON_URL', 'https://tachyon-edge.<subdomain>.workers.dev/uploads' );
define( 'TACHYON_SERVER_VERSION', '3.0.0' );
```

The path after the Worker host must match the Object Keys in your Origin. See the README's Deploy section.

## Credits

The Tachyon plugin is based on the Photon plugin code by Automattic, part of [Jetpack](https://github.com/Automattic/jetpack/blob/master/class.photon.php). Used under the GPL.
