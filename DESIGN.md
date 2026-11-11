# Ovix UI design system

Derived from the shipped dashboard (`frontend/src/ds/`). This is the vpn.ovix.store brand
turned into a live control room. The product facts are in `../PRODUCT.md`. The direction
contract is in `.impeccable/surfaces/`, and the approved comp is
`../.impeccable/mocks/styles/ovix-brand-sample.html`.

## Tokens (`src/ds/tokens.css`)
`useTheme` puts `body.light` or `body.dark` on `<body>`. Ultra-dark keeps the same dark world on a black ground.

| Role | Light | Dark |
|---|---|---|
| Ground `--ov-bg` | #FAFAFA + orange dot grid (22px) | #090A0F + dot grid |
| Card `--ov-card` | rgba(255,255,255,.86), blur 20px | rgba(18,20,32,.72) |
| Ink `--ov-tx` / `--ov-tx2` / `--ov-mu` | #111827 / #4B5563 / #5F6672 | #F3F4F6 / #9CA3AF / #8B93A1 |
| Brand `--ov-pr` | #F97316 (fills, icons, large type) | #FD8E43 |
| Small orange text `--ov-pr-text` | #C2410C (AA) | #FD8E43 |
| Primary fill `--ov-pr-fill` | #C8450E→#AD3A0B, white text | #FD8E43→#F97316, ink text |
| Status ok / exp / bad | #047857 / #9A3F07 / #B91C1C (+ 12–14% tints) | #34D399 / #FBBF24 / #F87171 |

Radii are 9px, 12px and 18px (cards). Motion uses 120, 200 and 320ms, plus 600ms for signature moves. The easing curve is `cubic-bezier(.2,.8,.2,1)`. Reduced motion turns off every keyframe and stops the network map's animation loop. When motion is reduced, the map repaints every 2 seconds instead.

## Type
- Outfit for headings and big numbers.
- Inter for body text.
- JetBrains Mono for rates, IDs and keyboard hints.
- Numbers always use `tabular-nums`.
- Uppercase 12px labels with 0.06em tracking appear only on stat labels and table headers. There are no eyebrow labels anywhere else.

## Dashboard anatomy (`src/ds/dashboard/`, prefix `ovd-`)
- **TopBar**: sticky, fades into the ground. It holds the page title, a greeting and the health line, a search button that opens the command palette, a theme toggle, and the Add Client primary button (`/clients?new=1`).
- **StatCard**: an icon chip and a label, then a tweened value (the raw value is tweened and formatted on every frame, so units never jump), then a note and a 0-based SVG sparkline. Orange marks the accent series; grey marks the secondary one.
- **LiveNetwork**: a canvas map of server → the inbounds in use → the 10 busiest online clients.
  - Link width and packet rate follow each client's live speed.
  - Client nodes use the status colours.
  - Colours are read from the tokens, and read again whenever the theme changes.
  - Animation frames stop while the map is off screen or the tab is hidden.
- **ServerCard**: a CPU ring gauge, an Xray state pill, RAM/Swap/Storage meters (the `--ov-prog` gradient) and uptime. Clicking it opens System History.
- **ActivityFeed**: timed events (came online, went offline, Xray errors, panel notices) appear above standing "needs action" items (expiring or ended clients). New items slide in.
- **ClientsPanel**: filter chips (All, Online, Expiring soon, Ended, Disabled) use the server's buckets. Each row has a status pill that mirrors `client_paging.go`, a live speed, a usage meter, the expiry date, and a link that opens the client on the Clients page.

## Shell (every page)
- **Sidebar**: open by default at 248px, showing the brand mark, labelled nav and the server health card (`ds/NodeCard`). Unpinning it shrinks it to a 72px rail.
- **PageTop** (`ds/PageTop`): every page gets the dashboard top bar, with the menu title and a one-line description of the page.
- **Phone**: a bottom tab bar (`ds/MobileNav`: Overview, Clients, Add, Inbounds, More) replaces the floating menu handle. More opens the drawer.
- **Widgets**: `ds/shell.css` gives AntD widgets one finish: glass cards, uppercase table headers, pill tags, 12px radius controls, an orange tab rail and 20px modals.
- **Sign-in**: an ink brand panel next to a white form card. On a phone only the card shows.
- **Colour**: AntD preset hues (`blue`, `geekblue`, `purple`, `cyan`, `magenta`, `pink`) are reseeded to brand shades in `useTheme`, so a colour name can never bring blue back.

## Rules
- Orange appears only on primary actions, the active state and live flow. Everything else stays neutral.
- No gradient text. No glows except the primary button's shadow.
- Every new surface must have a dark twin and must work at phone width (375px):
  - Phone layout: stats in a 2×2 grid, search hidden, Add Client shrinks to its icon, table columns trimmed.
- Upstream screens still render through Ant Design. `ds/antd-skin.css` brings them into the brand until each one is redesigned.
