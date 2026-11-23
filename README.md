# Japanese Learning Site

One page, one entry, three axes. See `CLAUDE.md` for the full specification and
`DECISIONS.md` for why it is built this way.

## Quick start

```
corepack enable && corepack prepare pnpm@10 --activate
pnpm install
cp .env.example .env         # optional; without DATABASE_URL an embedded PGlite DB is used
docker compose up -d postgres  # optional; Postgres on 127.0.0.1 (needs DATABASE_URL in .env)
pnpm --filter api db:migrate
pnpm --filter pipeline seed
pnpm dev                     # api on :3001, web on :5173
```

Postgres from Docker Compose listens on 127.0.0.1 only, never on the network. The api
`dev`/`db:migrate` and pipeline `load`/`seed`/`check` scripts load the repo-root `.env`
(variables already set in the shell take precedence); tests never read it.

## Quick deploy

For a handful of users: Apache terminates HTTPS and proxies to `vite preview`, which
serves the built frontend and forwards `/api` to the API. Everything except Apache listens
on 127.0.0.1. `vite preview` is not a production-grade server; for more traffic, serve
`apps/web/dist` from the web server directly.

```
browser --HTTPS--> Apache (443) --> vite preview (127.0.0.1:4173) --/api--> API (:3001) --> Postgres (127.0.0.1)
```

**1. Build and load data**

```
pnpm install
cp .env.example .env              # set DATABASE_URL; see .env.example for the rest
docker compose up -d postgres
pnpm --filter pipeline seed       # sample data; or `pnpm --filter pipeline all` for the full dataset
pnpm --filter web build
```

Use either the seed or the full dataset on one database, not both: loading the seed over
the full data rewrites shared rows with the subset's values.

**2. Run the API and the preview server** (keep both running, e.g. as systemd services)

```
cd apps/api && NODE_ENV=production pnpm exec tsx --env-file-if-exists=../../.env src/server.ts
pnpm --filter web preview --host 127.0.0.1 --port 4173 --strictPort
```

`NODE_ENV=production` marks the session cookie `Secure` and lets clients cache content
for a day, so the site must be reached over HTTPS or logging in silently fails. The API
runs through `tsx` because `pnpm --filter api start` cannot load the shared package from
the compiled build yet. `--strictPort` makes preview fail instead of moving to another
port that Apache does not proxy to.

**3. Apache**

```
sudo a2enmod proxy proxy_http ssl headers
sudo certbot --apache -d jp.example.com
```

```apache
<VirtualHost *:443>
    ServerName jp.example.com
    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/jp.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/jp.example.com/privkey.pem

    ProxyPreserveHost Off
    ProxyPass        / http://127.0.0.1:4173/
    ProxyPassReverse / http://127.0.0.1:4173/
    Header always set Strict-Transport-Security "max-age=31536000"
</VirtualHost>

<VirtualHost *:80>
    ServerName jp.example.com
    Redirect permanent / https://jp.example.com/
</VirtualHost>
```

Serve it from its own hostname (or its own port, with `Listen` and a matching
`<VirtualHost>`), not a sub-path: the app expects to live at `/`.

With `ProxyPreserveHost Off`, Apache sends `127.0.0.1:4173` as the host, which preview
accepts. With `ProxyPreserveHost On`, list the public hostnames in `.env` and restart
preview; a leading dot allows a domain and its subdomains:

```
PREVIEW_ALLOWED_HOSTS=jp.example.com,.example.org
```

**4. Firewall**

Open only Apache's ports (80 and 443). The API listens on all interfaces at `API_PORT`
(3001), so block that port; 4173 and Postgres are already local-only.

**Updating:** `git pull && pnpm install && pnpm --filter web build`, then restart the API
and the preview server.
