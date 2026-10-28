# BrighTech Distribution site

Static site for https://brightechdistribution.com on Netlify. Products are edited in a backoffice (`/admin`, Sveltia CMS); the rest is plain HTML.

## How it fits together

| Path | What it is |
|---|---|
| `content/products/<SKU>.json` | One file per product: `sku`, `name`, `category`, `image`, `visible`, `order`. Edited in the backoffice. |
| `images/` | Product images (WebP). Uploaded in the backoffice; only images used by visible products are published. |
| `src/index.template.html` | The page. `<!--@CATALOG_CARDS@-->` marks where the product cards go. |
| `src/static/` | 404, privacy, terms, robots, sitemap, icons, `_redirects`. Copied unchanged. |
| `admin/` | The backoffice: a pinned, self-hosted copy of Sveltia CMS (`vendor/VERSION.txt`) plus `config.yml`. |
| `src/admin.headers` | Security headers for `/admin`, written to `dist/_headers` only when the backoffice is built. |
| `scripts/build.js` | Builds `dist/`. Any invalid product, or a structurally wrong result, fails the build and nothing is published. |
| `scripts/serve.js` | Local preview server with Netlify-style headers. |
| `netlify/functions/submission-created.js` | Emails each quote-form inquiry through Zoho. Keep it byte-identical unless fixing it on purpose. |
| `tests/` | `node --test`: the frozen original catalog (`tests/fixtures/seed`) rebuilds the reviewed page byte-for-byte (`node tests/update-golden.js` after an intentional template change); bad data is rejected; build modes; the live catalog builds cleanly with 4:3 pictures and the hero strip names only listed products. |

## Two kinds of build

Netlify sets `CONTEXT`; `scripts/build.js` reads it.

| Context | Where | Backoffice `/admin` | Quote form |
|---|---|---|---|
| `production` (branch `main`) | brightechdistribution.com | **never included** | live (`data-netlify`) |
| `branch-deploy` (branch `staging`) and `deploy-preview` | `staging--bejewelled-semolina-89f3ca.netlify.app` | included | inert: no form registered, no stray leads |
| none (local build) | `dist/` | no (set `BT_INCLUDE_ADMIN=1` to preview it) | live |

So the GitHub token lives only in the browser storage of the staging address, never on the customer site, and a local `netlify deploy --prod` cannot publish the backoffice.

## Everyday use

1. Open `https://staging--bejewelled-semolina-89f3ca.netlify.app/admin/`, choose **Sign In Using Access Token**, paste your token (see *Create an editor token* below).
2. Add or edit products. Every save is committed to the `staging` branch; Netlify rebuilds the staging preview (free, about a minute). Check it at the staging address.
3. **Publishing is one person's job** (the owner): on GitHub open a pull request `staging` into `main` and merge it with **Create a merge commit**. That triggers one production deploy.
4. After the merge: Netlify, Deploys, confirm the new deploy says **Published** and the live page changed.

Rules for products: SKU like `BT-AUD-204`; name up to 80 characters; the image is converted to WebP and shrunk to fit 520 x 520 on upload (the build refuses a stored image over 1 MB or one that is not really an image); hiding a product also stops its image being published; new products get order 9999, which puts them last.

**Credits.** Netlify Free allows 300 credits a month. Each production deploy costs 15; previews, branch deploys, failed builds and rollbacks cost 0. At 0 credits the whole site and the quote form go offline until the monthly reset. Check the balance (Netlify, Usage and billing) before publishing, batch edits into one publish, and never push or merge to `main` for any other reason (a README change published to `main` costs 15 credits).

## How it is set up

- **GitHub:** public repository `MzeinW/brightech-site` on the owner's account. `staging` is the default branch, so a tool that targets "the default branch" can never publish by accident. `main` is protected: changes arrive only by pull request, force pushes and deletion are blocked, and the rule applies to the owner too.
- **Netlify:** the existing site is linked to the repository with a **read-only deploy key and a webhook**, so Netlify holds no GitHub token at all. Production branch `main`; branch deploys for `staging` only. Build settings come from `netlify.toml`. Because the Netlify GitHub app is not used, GitHub does not show Netlify build results on pull requests; look at the Netlify Deploys list instead. To stop all builds in an emergency: Netlify, Site configuration, Build and deploy, Build status, **Stop builds**.
- **Email:** `ZOHO_SMTP_USER`, `ZOHO_SMTP_PASS` and `MAIL_TO` live in the Netlify site settings; the password is available to the production context only, so a staging build can never read it.
- **Editor:** the owner, signing in with a fine-grained GitHub token (below).

### Create an editor token

GitHub, Settings, Developer settings, Fine-grained tokens, **Generate new token**: resource owner = the repository owner; repository = `brightech-site` only; permission **Contents: Read and write** only; expiration 90 days (set a reminder). A token belongs to one person and is used on one device; delete it in GitHub if the device is lost.

### Adding a second editor later

A fine-grained token cannot be used on a repository where someone is only a collaborator, so the repository has to live in a GitHub organization first:

1. Create a free organization; invite the editor as a **member**.
2. Transfer the repository into it (repository Settings, Danger zone, Transfer). It stays public, so branch protection keeps working; check the default branch and the `main` protection afterwards.
3. Tell Netlify the new path (the deploy key and webhook move with the repository): `netlify api updateSite` with `repo.repo_path` set to `<organization>/brightech-site`, or Site configuration, Build and deploy, Continuous deployment in the Netlify UI. Check the webhook still shows recent successful deliveries.
4. Set `repo: <organization>/brightech-site` in `admin/config.yml`, publish that through a pull request, and have each editor create a token with the organization as resource owner.
5. Keep publishing to one person: only the owner merges `staging` into `main`.

## Runbooks

**Roll back a bad publish.** Netlify, Deploys, open the last good production deploy, **Publish deploy** (free). A rollback is overwritten by the next git deploy, so then either **Lock to stop auto publishing** or revert the merge on `main` (that revert is itself a 15-credit deploy), fix on `staging`, and unlock. Free plans delete deploys after 30 days.

**Token expired or lost.** Expired: generate a new token and sign in again. Lost device or stolen token: delete that token in GitHub at once, look at recent commits on `staging` and `main`, then issue a new one. Keep GitHub recovery codes somewhere other than your phone.

**Sveltia update.** `admin/vendor/` is pinned (see `VERSION.txt`); the project releases almost daily and is still pre-1.0. Once a month, or when something breaks: `python scripts/vendor-sveltia.py <version>` (verifies every file's integrity hash before replacing the old copy), then on `staging` try sign in, create a product with an image, edit it and delete it, then merge.

**Check the quote form.** After any change to the template, build script or function: send one real inquiry (Forms entry, function log, email).

## Local use

```
node scripts/build.js                       # production-like build into dist/
CONTEXT=branch-deploy node scripts/build.js # staging-like build (backoffice included, form inert)
node scripts/serve.js                       # preview dist/ at http://127.0.0.1:8099/
node --test                                 # all tests
```

This repo stores files unconverted (`* -text` in `.gitattributes`) because `index.html` mixes CRLF, LF and lone CR. Do not run a formatter over it.

## Secrets

None are stored here. The Zoho and `MAIL_TO` variables live in the Netlify site settings. GitHub tokens are typed into the browser and never committed.
