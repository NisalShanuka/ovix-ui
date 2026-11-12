# Ovix UI

Control panel for the **OVIX STORE VPN** service (https://vpn.ovix.store): a web panel for
managing [Xray-core](https://github.com/XTLS/Xray-core) servers, clients, traffic and
subscriptions.

Ovix UI is a fork of [3x-ui](https://github.com/MHSanaei/3x-ui) by MHSanaei and contributors,
based on release v3.10.2. The backend follows upstream; Ovix adds its own branding, a
redesigned interface, reseller accounts and the Sentinel abuse monitor.

## Status

Private. Releases are published in this repo (latest: see
[Releases](../../releases)); the panel updates itself from them.

## How to install

> **Do not run this on a server that already runs 3x-ui with customers.** Moving an
> existing 3x-ui server needs a database backup and a rehearsal first (see
> [Moving from 3x-ui](#moving-from-3x-ui)).

**Requirements:** Ubuntu 22.04 / 24.04 or Debian 11 / 12, **x86_64 (amd64)**, root access.
Only the amd64 build is published at the moment.

### 1. Make a read-only GitHub token (once)

This repo is private, so the server needs a token to download releases.

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token**.
2. **Repository access → Only select repositories →** `NisalShanuka/ovix-ui`.
3. **Permissions → Repository permissions → Contents: Read-only.** Leave everything else at
   "No access".
4. Generate and copy the token (it starts with `github_pat_`). Note its expiry date.

The token can only read this one repo.

### 2. Run the installer

Log in to the VPS as root and run these three commands, with your token in place of
`github_pat_xxx`:

```bash
export OVIX_RELEASE_TOKEN='github_pat_xxx'
```

```bash
curl -fsSL -H "Authorization: Bearer $OVIX_RELEASE_TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/NisalShanuka/ovix-ui/contents/install.sh?ref=main" -o install.sh
```

```bash
bash install.sh
```

The installer saves the token to `/etc/ovix-ui/release-token` (root only, used for later
updates), downloads the latest release, checks its SHA-256 checksum and installs it to
`/usr/local/ovix-ui` as the `ovix-ui` systemd service.

### 3. Answer the installer's questions

Like 3x-ui, the installer asks a few questions, in this order:

| Question | What to answer |
|---|---|
| Database: `1) SQLite` / `2) PostgreSQL` | Press Enter for **SQLite** (fine below ~500 clients). |
| Customize the panel port? `[y/n]` | `y` and type a port, or `n` for a random one. |
| SSL certificate | `1` domain certificate (Let's Encrypt, needs a domain pointing at the server), `2` IP certificate (the default), `3` your own certificate files, or `4` none. Options 1 and 2 need port 80 open. |
| Bind the panel to 127.0.0.1 only? (only when there is no SSL) | `N`, unless you reach the panel through an SSH tunnel or reverse proxy. |

The **username, password and URL path are generated randomly** and printed at the end,
together with the access URL. Save them, then open the URL and log in.

To install without any questions, set the answers first:

```bash
export OVIX_NONINTERACTIVE=1 OVIX_DB_TYPE=sqlite OVIX_PANEL_PORT=2053 OVIX_USERNAME=admin OVIX_PASSWORD='choose-a-password' OVIX_WEB_BASE_PATH=panel OVIX_SSL_MODE=ip
```

`OVIX_SSL_MODE` is `ip`, `domain` (also set `OVIX_DOMAIN`) or `none` (the default when
unset). Then run `bash install.sh` as above.

### 4. Change settings later from the panel

Everything the installer set can be changed in the panel:

| Setting | Where |
|---|---|
| Listen IP, port, URI path | **Panel Settings → General → General** |
| SSL certificate and key paths | **Panel Settings → General → Certificates** |
| Username and password | **Panel Settings → Authentication → Admin credentials** |
| Two-factor login | **Panel Settings → Authentication** |

Press **Save**, then **Restart Panel**. After a port or path change, open the panel at the
new address.

From the terminal, run `ovix-ui` for the admin menu (reset username and password, change the
port, get an SSL certificate, view logs). Other commands: `ovix-ui status`,
`ovix-ui restart`, `ovix-ui log`, `ovix-ui settings`, `ovix-ui update`.

### Updating

On **Overview**, click the version number. When a newer release exists, press
**Update Panel**; the panel downloads, verifies and installs it, then reloads. If it says
updates come from a private repository, the token is missing or expired: paste a new one
in the same window and press Save.

### Moving from 3x-ui

1. Back up `/etc/x-ui/x-ui.db`, `/usr/local/x-ui/bin/config.json` and any certificates, and
   copy them off the server.
2. Rehearse on a spare server: install Ovix UI, put the copied database in place as
   `/etc/ovix-ui/ovix-ui.db`, run `ovix-ui migrate`, and check every client, UUID, port and
   certificate.
3. In a quiet hour: stop `x-ui`, install Ovix UI with the same database, panel port and
   certificates, and start it. Clients keep working because UUIDs and inbound ports do not
   change.
4. Keep the old `x-ui` files for a week so you can roll back.

### Troubleshooting

| Problem | Fix |
|---|---|
| `curl: (22) ... 404` when downloading `install.sh` | The token is wrong, expired, or has no access to `ovix-ui`. Make a new one (step 1). |
| `Failed to fetch ovix-ui version` | Same: the token can't see the releases. |
| The panel page doesn't open | Open the port in the VPS firewall / provider panel and run `ovix-ui status`. |
| Forgot the login | Run `ovix-ui` and choose the reset username and password option. |

## Development

Requirements (Linux or WSL2 Ubuntu 22.04): Go 1.27, a C compiler (`build-essential`,
needed by the SQLite driver), Node 26 and npm 11.

```bash
make dist-stub     # once, so Go packages build before the frontend exists
make gen           # regenerate frontend API types
make verify        # lint, typecheck, tests, build
```

Run locally: `go run .` for the backend and `cd frontend && npm run dev` for the UI.
`CLAUDE.md` and `CONTRIBUTING.md` describe conventions and the full test setup.

After merging a new upstream tag, rerun the rebrand:

```bash
python ovix/rebrand.py --apply
```

## License

GPL-3.0, same as upstream. See [LICENSE](LICENSE). Copyright notices of the original
3x-ui authors are kept.
