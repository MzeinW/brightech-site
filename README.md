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
| `tests/` | `node --test`: the seed content rebuilds today's live page byte-for-byte; bad data is rejected; build modes. |

## Two kinds of build

Netlify sets `CONTEXT`; `scripts/build.js` reads it.

| Context | Where | Backoffice `/admin` | Quote form |
|---|---|---|---|
| `production` (branch `main`) | brightechdistribution.com | **never included** | live (`data-netlify`) |
| `branch-deploy` (branch `staging`) and `deploy-preview` | `staging--bejewelled-semolina-89f3ca.netlify.app` | included | inert: no form registered, no stray leads |
| none (local build) | `dist/` | no (set `BT_INCLUDE_ADMIN=1` to preview it) | live |

So the GitHub token lives only in the browser storage of the staging address, never on the customer site, and a local `netlify deploy --prod` cannot publish the backoffice.

## Everyday use

1. Open `https://staging--bejewelled-semolina-89f3ca.netlify.app/admin/`, choose **Sign In Using Access Token**, paste your token.
2. Add or edit products. Every save is committed to the `staging` branch; Netlify rebuilds the staging preview (free, about a minute). Check it at the staging address.
3. **Publishing is one person's job** (the owner): on GitHub open a pull request `staging` into `main` and merge it with **Create a merge commit**. That triggers one production deploy.
4. After the merge: Netlify, Deploys, confirm the new deploy says **Published** and the live page changed.

Rules for products: SKU like `BT-AUD-204`; name up to 80 characters; the image is converted to WebP and shrunk to fit 520 x 520 on upload (the build refuses a stored image over 1 MB or one that is not really an image); hiding a product also stops its image being published; new products get order 9999, which puts them last.

**Credits.** Netlify Free allows 300 credits a month. Each production deploy costs 15; previews, branch deploys, failed builds and rollbacks cost 0. At 0 credits the whole site and the quote form go offline until the monthly reset. Check the balance (Netlify, Usage and billing) before publishing, batch edits into one publish, and never push or merge to `main` for any other reason (a README change published to `main` costs 15 credits).

## One-time setup (owner)

GitHub (a free **organization**, because a fine-grained token cannot be used on a repository where you are only a collaborator):
1. Create the organization; invite the second editor as a **member**.
2. Create the repository in it and push this repo (`main` and `staging`). Make `staging` the **default branch** so tools that target "the default branch" can never publish by accident.
3. Protect `main`: require a pull request, block force pushes and deletion, and do not let admins bypass. (Branch protection on a Free organization works for **public** repositories only; for a private one it needs the Team plan.)
4. Organization settings, Personal access tokens: allow fine-grained tokens (approve each editor's token if approval is required).
5. In `admin/config.yml` set `repo: <organization>/<repository>`.

Netlify (signed in as the account that owns the site):
1. Check the credit balance is at least 60.
2. Deploys, **Lock to stop auto publishing** on the current deploy, so the first git build cannot go live unchecked.
3. Site configuration, Build and deploy, Continuous deployment, **Link repository**, GitHub; grant the Netlify app access to this one repository only. Production branch `main`; branch deploys: individual branches, `staging`. Build settings come from `netlify.toml`.
4. Let the first build finish (15 credits, unpublished). On that deploy check: Forms lists `quote` with 7 fields, Functions lists `submission-created`, "15 redirect rules processed", and its page equals the live page.
5. **Publish deploy**, then **Unlock**. Send one real inquiry: a Forms entry appears, the function log says "notification sent", the email arrives. If any of the three fails, publish the previous deploy (free) and lock again.
6. Environment variables: give `ZOHO_SMTP_USER`, `ZOHO_SMTP_PASS` and `MAIL_TO` the **Functions** scope only (remove Builds), production context only, so a staging build can never read them. Send another inquiry to confirm.
7. After this the old Desktop folders must never deploy again: rename them and delete their `.netlify` folder.

Each editor: GitHub, Settings, Developer settings, Fine-grained tokens, **Generate new token**: resource owner = the organization; repository = this one only; permission **Contents: Read and write** only; expiration 90 days (set a reminder). A token is per person and per device.

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
