# Nandan Pixel URL Shortener

Source for the URL shortener and the related homepage update. The app is live at <https://shorturl.nandanpixel.com>; the homepage is <https://nandanpixel.com>.

## Architecture

The claimed app Worker at `https://nandanpixel-shorturl.flicker-tracker.workers.dev` serves the shortener app and uses a Durable Object to persist redirects. The `nandanpixel-shorturl-proxy` Worker in the Cloudflare account that owns the branded domain forwards `shorturl.nandanpixel.com` to that app Worker and rewrites the API's `shortUrl` to use the branded host. The homepage is the existing Cloudflare Pages project `nandanpixel-tools`, deployed from the `main` branch by static direct upload.

The shortener has no user login or account management and no analytics. The recent-links list is stored only in the visitor's browser; saved redirects are stored durably by the Worker. No claim is made about future service charges: no paid services were activated as part of preparing this source bundle, and costs are not guaranteed.

## Local development

Use Node.js/npm and Wrangler. From this directory:

```sh
npx wrangler dev --config wrangler.jsonc
npx wrangler dev --config wrangler-proxy.jsonc
npx wrangler pages dev homepage
```

The first command runs the app Worker and its local assets/storage. The second runs the branded-host proxy locally. The third serves the static homepage locally.

## Deployment commands

These commands are provided for an authorized maintainer of the published app. Wrangler must already be authenticated to the appropriate Cloudflare account. Deploy the app Worker and the proxy in their respective accounts:

```sh
npx wrangler deploy --config wrangler.jsonc
npx wrangler deploy --config wrangler-proxy.jsonc
```

For an authorized static direct upload of the homepage to the existing Pages project and branch:

```sh
npx wrangler pages deploy homepage --project-name nandanpixel-tools --branch main
```

`shorturl-site/` and `homepage/` are copied source directories. The Worker and proxy configuration files are `wrangler.jsonc` and `wrangler-proxy.jsonc` respectively.
