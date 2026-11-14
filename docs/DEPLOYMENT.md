# Deployment

Grue runs on Railway in the project **grue**. There are two environments, built from this repository's
`Dockerfile`.

| Environment | URL | Purpose | Deploys |
|---|---|---|---|
| `production` | https://grue.party (also `grue-production.up.railway.app`) | Public benchmark server | Manually: Deploy Latest Commit (autodeploy off) |
| `qa` | https://grue-qa.up.railway.app | Testing changes before release | Every push to `main` (after GitHub Actions pass, if any) |

Each environment has:
- Its own `GRUE_API_KEYS`. A key for one environment is rejected by the other.
- Its own `/data` volume. Results and replays from QA never reach the production leaderboard.
- The same settings otherwise: `HOST=0.0.0.0`, `PORT=8081`, `RESULTS_DIR=/data/results`, `REPLAYS_DIR=/data/replays`,
  `MAX_SESSIONS=12`, health check `/health`, restart on failure.

## DNS (Cloudflare)

`grue.party` is registered and served by Cloudflare. It has two records, both **DNS only** (grey cloud), so
Railway can issue the TLS certificate itself:

| Type | Name | Content |
|---|---|---|
| CNAME | `@` | the target Railway shows for the custom domain (`nuj1y80k.up.railway.app`) |
| TXT | `_railway-verify` | the `railway-verify=...` value Railway shows |

If the domain is ever re-created in Railway, both values change. Copy the new ones from Railway into Cloudflare.

## Using it from Brass Lantern

```bash
# .env in brass-lantern (gitignored)
GRUE_URL=https://grue.party
GRUE_API_KEY=<a production key>
```

QA works the same way with `GRUE_URL=https://grue-qa.up.railway.app` and a QA key.

## Releasing to production

1. Push to `main` and let QA deploy it. Check QA's health, then play a game against it, for example:
   `GRUE_URL=https://grue-qa.up.railway.app python -m brass_lantern play --game lantern-lane --model mock:walkthrough.txt`.
2. Deploy `main`'s latest commit to production. Production tracks `main` with automatic deployments disabled,
   so pushes to `main` never touch it. To release:
   - **By hand:** in the Railway dashboard, switch to the `production` environment, open the grue service,
     press Cmd+K (Ctrl+K on Windows) and choose **Deploy Latest Commit**.
   - **Ask Claude** ("release to prod"): Claude deploys the latest commit of `main` to production through the
     Railway connector, then checks that the deployment succeeded and `https://grue.party/health` answers.

   This deploys whatever is newest on `main` at that moment. If something landed after you checked QA, check
   QA again first. To roll back, open an earlier production deployment in Railway and choose **Rollback**.

## QA auto-deploy: one-time setup

Done on 2026-11-13: the Railway GitHub App has access to the account's repositories, and `qa` tracks `main`.
Verified: a push to `main` deploys QA and leaves production alone.

Railway only deploys on push when its GitHub App can see the repository. On GitHub, go to Settings, then
Applications, then **Railway**, and under Repository access add `herzigma/grue`. Once that is done, check that
production's automatic deployments are disabled (production, the grue service, Settings, Source: **Disable**),
so pushes deploy only QA. Production used to be pinned to a commit SHA instead; that pin was removed on
2026-11-14.

## Gotchas found while setting this up

- Railway rejects `VOLUME` in a Dockerfile. Mount `/data` as a Railway volume instead.
- Do not set `HTTP_PORT` in the image. Railway health-checks `$PORT`, and `HTTP_PORT` would override it.
  Grue listens on `PORT` when it is set, otherwise on 8081.
