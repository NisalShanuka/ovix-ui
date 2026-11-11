# Ovix UI

Control panel for the **OVIX STORE VPN** service (https://vpn.ovix.store): a web panel for
managing [Xray-core](https://github.com/XTLS/Xray-core) servers, clients, traffic and
subscriptions.

Ovix UI is a fork of [3x-ui](https://github.com/MHSanaei/3x-ui) by MHSanaei and contributors,
based on release v3.10.2. The backend follows upstream; Ovix adds its own branding, a
redesigned interface, reseller accounts and the Sentinel abuse monitor.

## Status

Private, under development. Self-update and the internet installer are disabled until
Ovix UI releases are published (see `OVIX_RELEASE_REPO`).

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
