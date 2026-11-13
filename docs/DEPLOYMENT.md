# Deployment

Grue runs on Railway in the project **grue**. There are two environments, built from this repository's
`Dockerfile`.

| Environment | URL | Purpose | Deploys |
|---|---|---|---|
| `production` | https://grue.party (also `grue-production.up.railway.app`) | Public benchmark server | Manually, when a release is promoted |
| `qa` | https://grue-qa.up.railway.app | Testing changes before release | Every push to `main` |

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
2. Promote that commit to production. Production is pinned to a commit, so promoting means moving the pin:
   stage the new commit SHA as production's source (Railway dashboard: production, the grue service, Settings,
   Source; or ask Claude, which stages it through the Railway connector), then in production click
   **Apply changes / Deploy**. Pushes to `main` never touch production.

## QA auto-deploy: one-time setup

Done on 2026-11-13: the Railway GitHub App has access to the account's repositories, and `qa` tracks `main`.
Verified: a push to `main` deploys QA and leaves production alone.

Railway only deploys on push when its GitHub App can see the repository. On GitHub, go to Settings, then
Applications, then **Railway**, and under Repository access add `herzigma/grue`. Once that is done, check that
in production the service's branch trigger is off (or production is pinned to a commit), so pushes deploy only QA.

## Gotchas found while setting this up

- Railway rejects `VOLUME` in a Dockerfile. Mount `/data` as a Railway volume instead.
- Do not set `HTTP_PORT` in the image. Railway health-checks `$PORT`, and `HTTP_PORT` would override it.
  Grue listens on `PORT` when it is set, otherwise on 8081.
