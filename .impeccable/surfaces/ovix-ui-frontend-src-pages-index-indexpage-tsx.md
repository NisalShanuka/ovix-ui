---
version: 1
slug: "ovix-ui-frontend-src-pages-index-indexpage-tsx"
primary_target: "ovix-ui/frontend/src/pages/index/IndexPage.tsx"
related_targets: ["ovix-ui/frontend/src/layouts/PanelLayout.tsx","ovix-ui/frontend/src/layouts/AppSidebar.tsx"]
---

# Surface brief: Ovix UI panel shell + dashboard

Scope: the admin panel shell (sidebar, top bar, mobile bottom nav) and the dashboard (index page). Mode: Operate.
Audience: owner + resellers/staff; job: see server health and live traffic, act on what needs attention (renew, top up, review torrent), find a client fast. Desktop and phone.
Constraints: English only; OVIX STORE VPN brand tokens from PRODUCT.md; data comes from existing upstream hooks/API and the WebSocket bridge; reduced-motion respected.
Reference sample (approved by owner 2026-11-11): .impeccable/mocks/styles/ovix-brand-sample.html

## Direction contract
THESIS: The panel is the vpn.ovix.store brand turned into a live control room. It refuses the category default of a static card grid plus one line chart: every number moves with the server, and the network itself is drawn live.
OWN-WORLD: #FAFAFA ground with the orange dot grid, translucent white cards (18px radius, hairline border, soft shadow), orange #F97316→#EA580C only for primary actions, active state and live flow; ink #111827; status green/amber/red from the site; Outfit for headings and numbers, Inter for body, JetBrains Mono for rates and IDs. Dark twin: #090A0F, #FD8E43.
STORY: In one glance the owner knows the server is up, how many clients are online, how much traffic is flowing and which clients need action today; one click renews or opens a client.
FIRST VIEWPORT: Left sidebar (shield + OVIX STORE VPN wordmark, nav with counts, node health card with CPU/RAM bars at bottom). Top bar: page title + greeting, search (Ctrl K), theme toggle, orange "New client" primary at right. Row of 4 stat cards (Online, Download, Upload, Today) with animated sparklines. Below: Live network canvas (2/3 width) beside port-load gauge and live Activity feed (1/3). Clients table with filter chips follows.
FORM: Brand-pinned by the owner (site colours, modern, animated), chosen after three direction rounds; signature interaction is the Live network map (SG-01 → inbound → clients, link width = live Mbps, orange packets at real speed, status-coloured nodes) plus number tweens and feed slide-ins. seed:cc185743bef40932
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- Owner's real logo file (shield placeholder until then).
- Reseller-facing differences in the shell (what nav items resellers see).
