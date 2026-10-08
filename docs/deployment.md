# Deploying careOS web

careOS web ships as a self-contained Node server (`output: 'standalone'`,
ADR-008). The runtime image needs nothing from the host beyond a reachable API
and, in production, a TLS terminator in front of it.

## Image

Build and inspect:

```bash
docker build -t careos-web .
docker image inspect careos-web --format '{{.Config.User}}'
```

The Dockerfile is two-stage. The build stage runs the full token verification
and `next build`; the runtime stage copies only `.next/standalone/` (which the
`postbuild` script has already populated with static assets) and runs `server.js`
as an unprivileged user. No sources or dev dependencies ship in the image.

## Environment

Every variable is validated at startup; an invalid value fails the process
rather than a request. All default to something, so the only one that is
usually worth setting is `API_INTERNAL_URL`. Full inventory in `.env.example`
and the schema in `src/lib/env.ts`.

| Variable                            | Default                 | Meaning                                                                                           |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `API_INTERNAL_URL`                  | `http://localhost:3001` | Origin the server proxies `/api/v1/*` to. Server-side only.                                       |
| `NEXT_PUBLIC_API_BASE_PATH`         | `/api/v1`               | Browser-facing API prefix, same-origin.                                                           |
| `NEXT_PUBLIC_APP_NAME`              | `careOS`                | Product name in titles and signs.                                                                 |
| `NEXT_PUBLIC_ENABLE_MOCKS`          | `false`                 | MSW browser mocks. The build **throws** if `true` with `NODE_ENV=production` — never enable here. |
| `NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS` | `false`                 | TanStack Query devtools.                                                                          |

`NODE_ENV=production` is baked into the image; it cannot be overridden at run
time, which is deliberate (`next build` hard-codes it).

## Running

```bash
docker run --rm -p 3000:3000 \
  -e API_INTERNAL_URL=https://api.careos.example \
  careos-web
```

Health: `GET /` returns 200. There is no synthetic health endpoint; a request
through the proxy (`/api/v1/...`) is the real check that the upstream link
works.

## Production notes

- **TLS is a deployment responsibility.** The app terminates it at the load
  balancer / ingress. The session cookies are `Secure`, so they will only be
  sent over HTTPS — without TLS in front, a user cannot hold a session. There
  is a fixed `Strict-Transport-Security` header for the TLS layer to keep.
- **The Content-Security-Policy is nonce-based and enforced by the proxy**
  (`src/proxy.ts`, ADR-010). It is header-served per request together with the
  nonce that the markup carries. Do not add a CDN or edge that rewrites or
  strips `Content-Security-Policy` — and do not inline-editor HTML, because
  script nonces cannot survive content rewriting.
- **One key is enough per host.** Do not run more than one copy of the image
  behind the same TLS domain without sticky sessions or a shared nothing
  design.
- **Never set `NEXT_PUBLIC_ENABLE_MOCKS=true`** here or the build refuses to
  start.
- Backups, TLS certificate renewal and the reverse proxy are infrastructure
  concerns owned by the deployment environment, not the container.
