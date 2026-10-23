# BrighTech Distribution site

Static site for https://brightechdistribution.com on Netlify. The catalog is edited in the backoffice at `/admin`; the rest is plain HTML.

## How it fits together

| Path | What it is |
|---|---|
| `content/products/<SKU>.json` | One file per product: `sku`, `name`, `category`, `image`, `visible`, `order`. Edited through `/admin`. |
| `images/` | Product images (WebP). Uploaded through `/admin`. |
| `src/index.template.html` | The page. `<!--@CATALOG_CARDS@-->` marks where the product cards go. |
| `src/static/` | 404, privacy, terms, robots, sitemap, icons, `_redirects`, `_headers`. Copied unchanged. |
| `scripts/build.js` | Builds `dist/` from the above. An invalid product fails the build, so nothing is published. |
| `netlify/functions/submission-created.js` | Emails each quote-form inquiry through Zoho. Keep it byte-identical unless fixing it on purpose. |
| `tests/` | `node --test` checks that the seed content rebuilds today's live page byte-for-byte and that bad data is rejected. |

## Publishing a catalog change

1. Open `/admin`, sign in, add or edit products. Every save goes to the `staging` branch.
2. Check the free preview at `https://staging--bejewelled-semolina-89f3ca.netlify.app`.
3. Publish: on GitHub, open a pull request `staging` into `main` and merge it. That triggers one production deploy.

**Credits.** Netlify Free allows 300 credits a month. Each production deploy costs 15; previews and failed builds cost 0. At 0 credits the whole site and the quote form go offline until the monthly reset. Check the balance (Netlify, Usage and billing) before publishing, and batch edits into one publish. Never push straight to `main`.

**Rollback.** Netlify, Deploys, choose the previous production deploy, Publish deploy. Free.

## Local use

```
node scripts/build.js     # writes dist/
node --test               # golden + validation tests
```

Keep files byte-exact: this repo uses `* -text` in `.gitattributes` because `index.html` mixes CRLF, LF and lone CR. Do not run a formatter over it.

## Secrets

None are stored here. `ZOHO_SMTP_USER`, `ZOHO_SMTP_PASS` (production only) and `MAIL_TO` live in the Netlify site settings. The GitHub token used by `/admin` is typed into the browser and never committed.
