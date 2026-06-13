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

## OnlyOffice
- Docker container ID: 45b74ffc6322
- Running at: http://localhost (port 80)
- JWT Secret: stored in ONLYOFFICE_JWT_SECRET env var
- Start command: docker start 45b74ffc6322
- Check running: docker ps
- Health check: http://localhost/healthcheck
- If stopped: docker start 45b74ffc6322
- Auto-restart: --restart=always flag set (starts with Docker Desktop automatically)
