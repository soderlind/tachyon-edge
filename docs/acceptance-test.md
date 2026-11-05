# Acceptance test: WordPress with the Tachyon plugin

The unit, oracle and remote smoke suites test the Worker against URLs written by hand. The acceptance test starts from WordPress instead. It installs [humanmade/tachyon-plugin](https://github.com/humanmade/tachyon-plugin) 0.11.1 (commit `652ecd2`, the version [ADR 0006](adr/0006-compatibility-target-is-the-wordpress-plugin.md) targets) and uploads images through WP-CLI. It then asks WordPress which image URLs and dimensions it would put in a page, and fetches each URL from a deployed Worker.

## What it checks

For four fixtures (a 2400×1600 JPEG, a 1000×1500 PNG with alpha, a 1600×900 WebP and a 200×120 JPEG that is smaller than every intermediate size), the test collects URLs from the plugin's three output paths:

| Source | Cases |
|---|---|
| `wp_get_attachment_image_src` | `thumbnail`, `medium`, `medium_large`, `large`, `full`, `[300, 200]`, `[1000, 1000]` |
| `wp_get_attachment_image_srcset( …, 'large' )` | Every candidate, by its `w` descriptor |
| `the_content` | An `<img class="wp-image-N size-medium">` and every `srcset` candidate the filter adds |

Every URL must:

- start with `TACHYON_URL` (so the plugin rewrote it),
- return `200` with the attachment's MIME type and `Cache-Control: max-age=31536000`,
- decode to the width WordPress declares, and to the declared height when WordPress declares one. `srcset` candidates declare only a width. Content images are checked against the inserted size, because the plugin removes `width` and `height` from content `<img>` tags and adds `data-recalc-dims`.

The test fails if the plugin is inactive, if `TACHYON_URL` differs from the one WordPress uses, or if any fixture produced no cases.

## Prerequisites

- WP-CLI for a WordPress install the test may change. On a multisite, the test creates its own sub-site. On a single site, set `WP_SITE_URL` to a site you can add media to.
- A deployed Worker with `TACHYON_ORIGIN=r2` and an empty `TACHYON_KEY_PREFIX`.
- Wrangler logged in to the account that owns the Worker's R2 bucket. `prepare` uploads the Originals with `wrangler r2 object put --remote`.
- Node dependencies installed (`npm ci`). The fixtures are generated with Sharp.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `TACHYON_URL` | (required) | What the plugin rewrites the uploads base URL to, e.g. `https://<worker>/uploads`. Loaded with `wp --require=tests/acceptance/tachyon-url.php`, so `wp-config.php` is never edited |
| `WP_CLI` | `wp` | Shell command that runs WP-CLI for the target install |
| `WP_SITE_URL` | the `TACHYON_ACCEPTANCE_SLUG` sub-site | Existing site to use instead of creating a sub-site |
| `TACHYON_ACCEPTANCE_SLUG` | `tachyon-acceptance` | Sub-site slug on a multisite |
| `TACHYON_ACCEPTANCE_BUCKET` | `tachyon-uploads` | R2 bucket bound to the Worker as `BUCKET` |
| `TACHYON_ACCEPTANCE_KEEP_PLUGIN` | unset | Set to keep `tachyon-plugin` installed on cleanup |

## Run

```sh
export TACHYON_URL=https://<worker>/uploads
node tests/acceptance/wp-site.mjs prepare
npm run test:acceptance
node tests/acceptance/wp-site.mjs cleanup   # optional
```

`prepare` can be re-run. It deletes earlier acceptance attachments and their R2 objects before importing fresh ones. `npm run test:acceptance` does not change WordPress or R2, so you can repeat it after redeploying the Worker.

### Local (by Flywheel)

A bare `wp` does not reach Local's database. Point `WP_CLI` at the wrapper from the [wp-cli-local skill](https://github.com/soderlind/skills/tree/main/skills/wp-cli-local), which runs WP-CLI with the site's PHP and MySQL socket. Install it with `npx skills add soderlind/skills --skill wp-cli-local`, and run the commands from inside the site's directory:

```sh
cd ~/Sites/<site>/app/public/wp-content/plugins/tachyon-edge
export WP_CLI="bash ~/.agents/skills/wp-cli-local/scripts/wp"
export TACHYON_URL=https://tachyon-edge.<account>.workers.dev/uploads
node tests/acceptance/wp-site.mjs prepare
npm run test:acceptance
```

## What `prepare` changes

1. Creates the sub-site `/<TACHYON_ACCEPTANCE_SLUG>/` unless `WP_SITE_URL` is set. If another network plugin fatals in a site-creation hook after the site exists, `prepare` carries on with the site.
2. Installs `tachyon-plugin` from the pinned GitHub archive if it is missing, fails unless the installed version is `0.11.1`, and activates it on the test site only.
3. Imports the four fixtures with `wp media import` and marks them with the `_tachyon_acceptance` post meta.
4. Uploads each Original to R2. The key is the path of the plugin's URL for the attachment. On a multisite, the plugin strips `/sites/N` from the uploads base URL before rewriting it, so a sub-site file becomes `uploads/sites/N/YYYY/MM/<file>`.

`cleanup` reverses all four steps. It deletes the plugin unless `TACHYON_ACCEPTANCE_KEEP_PLUGIN` is set. If you had `tachyon-plugin` installed before the test, set that variable.

## Files

| File | Role |
|---|---|
| [tests/acceptance/wp-site.mjs](../tests/acceptance/wp-site.mjs) | `prepare` and `cleanup` |
| [tests/acceptance/tachyon-url.php](../tests/acceptance/tachyon-url.php) | Defines `TACHYON_URL` from the environment for `wp --require` |
| [tests/acceptance/cases.php](../tests/acceptance/cases.php) | `wp eval-file` script that prints the cases as one `TACHYON_CASES {json}` line |
| [tests/acceptance/acceptance.ts](../tests/acceptance/acceptance.ts) | Jest suite that fetches every case. Excluded from `npm test` |
