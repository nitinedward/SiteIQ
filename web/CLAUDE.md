# SiteIQ Design System v2

## Colours
--white: #ffffff
--off: #f8f7f5
--stone: #f0ede8
--line: #e4e0d9
--line2: #ccc8c0
--mid: #9b968d
--dark: #2c2a27
--ink: #1a1917
--accent: #2c5282
--accent2: #edf2fb
--accent3: #dbeafe
--red: #c0392b
--red2: #fdf0ef
--green: #27705a
--green2: #e6f4ef
--amber: #b8860b
--amber2: #fef9e7
--orange: #c05621
--orange2: #fef3e2

## Fonts
--f-serif: 'Cormorant', Georgia, serif
--f-body: 'Outfit', sans-serif
--f-mono: 'JetBrains Mono', monospace

## Shadows
--shadow-sm: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)
--shadow-md: 0 4px 12px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04)
--shadow-lg: 0 8px 24px rgba(0,0,0,.10), 0 4px 8px rgba(0,0,0,.04)
--shadow-card: 0 0 0 1px rgba(0,0,0,.05), 0 2px 8px rgba(0,0,0,.06)

## Border Radius
--r1: 6px
--r2: 10px
--r3: 14px
--r4: 20px

## Shell
Sidebar: 240px
Topbar: 60px
Grid: 240px 1fr / 60px 1fr

## Domains
- Canonical host: https://www.site-iq.co.nz
- The apex (site-iq.co.nz) 308-redirects to www — both are aliased to the
  same Vercel production deployment. When verifying a deploy with curl, hit
  www: for a while the two pointed at *different* deployments, so the apex
  looked fixed while the browser (on www) was serving a stale build.

## OnlyOffice
Runs on a DigitalOcean VPS, not locally.
- Host: root@170.64.219.210 (SSH)
- Docker container: b37cbcd5605d (name `elegant_pare`, image
  onlyoffice/documentserver:7.5.1), port 80 published on the host
- Public URL: https://onlyoffice.site-iq.co.nz (Cloudflare-proxied) —
  this is what ONLYOFFICE_SERVER_URL / NEXT_PUBLIC_ONLYOFFICE_SERVER_URL point at
- Health check: https://onlyoffice.site-iq.co.nz/healthcheck (returns `true`)
- Check running: `ssh root@170.64.219.210 'docker ps'`
- If stopped: `ssh root@170.64.219.210 'docker start b37cbcd5605d'`
- Auto-restart: policy is `always`, so it comes back with the Docker daemon
- JWT secret: ONLYOFFICE_JWT_SECRET, and it must match the container's own
  configured secret exactly. Inbound request signing is required
  (`token.enable.request.inbox` in the container's local.json), so
  CommandService/ConvertService calls must be JWT-signed. Strip a leading
  BOM from the env var before use — a mismatched-looking-but-identical
  secret has bitten this project before.

### OnlyOffice document key
`document.key` identifies the *content*, not the session. For a key it has
seen before, the Document Server ignores `document.url` and serves its own
cached copy — and that session's saves then write the stale copy back over
Supabase, which looks like the report "resetting" (this is what broke
inserting photos/markups: the key used to be a per-page-load counter, so
every visit reused keys from earlier visits).

So the key is derived from the stored file itself — `getDocKey()` in
`src/lib/docStorage.ts`, `doc-{inspectionId}-{ETag}` — and the report page
re-reads it via `GET /api/docs/version` after anything rewrites the file
(AI generation, insert, download rebuild). Rules: never reuse a key for
different content; never open the editor before the key is known; always
pass the key the session was *opened* with to CommandService calls
(force-save, drop, meta), not a freshly-read one.

### OnlyOffice editor theme
The editor's toolbar/canvas colours come from a custom theme installed on
the Document Server, referenced as `uiTheme: 'theme-siteiq'` in
`src/components/OnlyOfficeEditor.tsx`.

Source of truth is `onlyoffice/themes/siteiq.json` in this repo. It is
installed **inside the container**, so a container rebuild wipes it — the
editor then silently falls back to its default theme. To reinstall:

```bash
scp onlyoffice/themes/siteiq.json root@170.64.219.210:/tmp/siteiq.json
ssh root@170.64.219.210 'D=/var/www/onlyoffice/documentserver/web-apps/apps/common/main/resources/themes; \
  docker exec b37cbcd5605d sh -c "[ -f $D/themes.json.orig ] || cp $D/themes.json $D/themes.json.orig"; \
  docker cp /tmp/siteiq.json b37cbcd5605d:$D/themes.json; \
  docker exec b37cbcd5605d sh -c "mv $D/themes.json.gz $D/themes.json.gz.orig 2>/dev/null"'
```

How it works: `default.json` sets `themes.uri` to that directory;
DocService aggregates it into `https://onlyoffice.site-iq.co.nz/themes.json`,
and the editor registers any entry carrying an `id`, injecting
`:root .<id>{--var:value}`. Only `themes.json` in that directory is read —
adding extra files there does nothing. The originals are kept alongside as
`themes.json.orig` / `themes.json.gz.orig`; restore them to revert.

Not themeable without a licence: the ONLYOFFICE logo and product text.
`customization.logo` / `customization.customer` are gated behind
`asc_getCanBranding()`, which is why `logo: { visible: false }` in the
config has no effect on this server.

### OnlyOffice plugins
The "Reword with AI" plugins live in `public/oo-plugins/` and are served
from this app (Vercel), registered via `editorConfig.plugins.pluginsData`
in `src/components/OnlyOfficeEditor.tsx` — nothing is installed on the
container, so rebuilding it won't break them. Behaviours of this Document
Server build that cost real time to find are documented in comments in
`public/oo-plugins/siteiq-reword-menu/scripts/code.js`; read those before
changing plugin wiring.
