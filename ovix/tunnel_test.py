#!/usr/bin/env python3
"""Hard test of a VLESS/VMess/Trojan tunnel from a client's point of view.

Starts a local Xray client from a share link, then drives real traffic
through its SOCKS5 port: HTTPS, egress IP, UDP DNS, bulk download and upload,
parallel streams, connection churn and a long-lived stream. Stdlib only.

  python3 ovix/tunnel_test.py --xray /path/to/xray 'vless://...'
Exit code 0 means every check passed.
"""
import argparse
import base64
import concurrent.futures as cf
import json
import os
import random
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse

SOCKS_PORT = 10808
SPEED_HOST = "speed.cloudflare.com"


# ---------- share link -> xray client config ----------

def stream_from_query(q, host):
    net = q.get("type", "tcp")
    sec = q.get("security", "none")
    st = {"network": net, "security": sec}
    if sec == "tls":
        st["tlsSettings"] = {
            "serverName": q.get("sni", host),
            "fingerprint": q.get("fp", "chrome"),
            "alpn": [a for a in q.get("alpn", "").split(",") if a] or None,
            "allowInsecure": q.get("allowInsecure") == "1",
        }
    if sec == "reality":
        st["realitySettings"] = {
            "serverName": q.get("sni", ""),
            "fingerprint": q.get("fp", "chrome"),
            "publicKey": q.get("pbk", ""),
            "shortId": q.get("sid", ""),
            "spiderX": q.get("spx", "/"),
        }
    if net == "ws":
        st["wsSettings"] = {"path": q.get("path", "/"), "host": q.get("host", "")}
    if net == "grpc":
        st["grpcSettings"] = {"serviceName": q.get("serviceName", "")}
    if net in ("xhttp", "splithttp"):
        st["xhttpSettings"] = {"path": q.get("path", "/"), "host": q.get("host", ""), "mode": q.get("mode", "auto")}
    if net == "httpupgrade":
        st["httpupgradeSettings"] = {"path": q.get("path", "/"), "host": q.get("host", "")}
    if net == "tcp" and q.get("headerType") == "http":
        st["tcpSettings"] = {"header": {"type": "http", "request": {"path": [q.get("path", "/")],
                                                                    "headers": {"Host": [q.get("host", host)]}}}}
    return st


def outbound_from_link(link):
    scheme = link.split("://", 1)[0].lower()
    if scheme == "vmess":
        raw = link[len("vmess://"):]
        cfg = json.loads(base64.b64decode(raw + "=" * (-len(raw) % 4)).decode())
        q = {"type": cfg.get("net", "tcp"), "security": cfg.get("tls") or "none", "sni": cfg.get("sni", ""),
             "path": cfg.get("path", "/"), "host": cfg.get("host", ""), "serviceName": cfg.get("path", "")}
        host, port = cfg["add"], int(cfg["port"])
        return {"protocol": "vmess", "settings": {"vnext": [{"address": host, "port": port, "users": [
            {"id": cfg["id"], "security": cfg.get("scy", "auto")}]}]},
            "streamSettings": stream_from_query(q, host)}
    u = urllib.parse.urlsplit(link)
    q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
    host, port, user = u.hostname, u.port, urllib.parse.unquote(u.username or "")
    if scheme == "vless":
        users = [{"id": user, "encryption": q.get("encryption", "none"), "flow": q.get("flow", "")}]
        return {"protocol": "vless", "settings": {"vnext": [{"address": host, "port": port, "users": users}]},
                "streamSettings": stream_from_query(q, host)}
    if scheme == "trojan":
        q.setdefault("security", "tls")
        return {"protocol": "trojan", "settings": {"servers": [{"address": host, "port": port, "password": user}]},
                "streamSettings": stream_from_query(q, host)}
    raise SystemExit(f"unsupported link scheme: {scheme}")


def client_config(link):
    return {
        "log": {"loglevel": "warning"},
        "inbounds": [{"listen": "127.0.0.1", "port": SOCKS_PORT, "protocol": "socks",
                      "settings": {"udp": True, "ip": "127.0.0.1"}}],
        "outbounds": [outbound_from_link(link)],
    }


# ---------- minimal SOCKS5 client ----------

def socks_connect(host, port, timeout=20):
    s = socket.create_connection(("127.0.0.1", SOCKS_PORT), timeout=timeout)
    s.sendall(b"\x05\x01\x00")
    if s.recv(2) != b"\x05\x00":
        raise OSError("socks auth refused")
    hb = host.encode()
    s.sendall(b"\x05\x01\x00\x03" + bytes([len(hb)]) + hb + struct.pack(">H", port))
    rep = s.recv(4)
    if len(rep) < 4 or rep[1] != 0:
        raise OSError(f"socks connect failed: {rep!r}")
    atyp = rep[3]
    addr_len = {1: 4, 4: 16}.get(atyp) or _recv_exact(s, 1)[0]
    _recv_exact(s, addr_len + 2)
    return s


def _recv_exact(s, n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise OSError("socks reply cut short")
        buf += chunk
    return buf


def https(method, host, path, body=b"", timeout=60, read_limit=None, slow=0.0):
    """slow: optional read rate cap in bytes/s."""
    raw = socks_connect(host, 443, timeout)
    ctx = ssl.create_default_context()
    s = ctx.wrap_socket(raw, server_hostname=host)
    req = (f"{method} {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: ovix-tunnel-test\r\n"
           f"Connection: close\r\nContent-Length: {len(body)}\r\n\r\n").encode()
    s.sendall(req)
    if body:
        view = memoryview(body)
        for i in range(0, len(body), 65536):
            s.sendall(view[i:i + 65536])
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
    head, _, rest = buf.partition(b"\r\n\r\n")
    status = int(head.split(b" ", 2)[1])
    total = len(rest)
    data = rest
    started = time.monotonic()
    while True:
        chunk = s.recv(262144)
        if not chunk:
            break
        total += len(chunk)
        if read_limit is None:
            data += chunk
        if slow:
            # slow is a target rate in bytes/s: stretch the read to keep the stream open
            time.sleep(max(0.0, total / slow - (time.monotonic() - started)))
    s.close()
    return status, (data if read_limit is None else b""), total


# ---------- checks ----------

class Report:
    def __init__(self):
        self.rows, self.failed = [], 0

    def add(self, name, ok, detail):
        self.rows.append((name, ok, detail))
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name:<26} {detail}", flush=True)


def check_https(r):
    t = time.monotonic()
    st, body, _ = https("GET", "www.cloudflare.com", "/cdn-cgi/trace")
    trace = dict(line.split("=", 1) for line in body.decode().splitlines() if "=" in line)
    r.add("https + egress ip", st == 200 and "ip" in trace,
          f"egress {trace.get('ip')} ({trace.get('loc')}) in {(time.monotonic() - t) * 1000:.0f} ms")
    return trace.get("ip")


def check_udp_dns(r):
    s = socket.create_connection(("127.0.0.1", SOCKS_PORT), timeout=10)
    s.sendall(b"\x05\x01\x00")
    s.recv(2)
    s.sendall(b"\x05\x03\x00\x01" + b"\x00" * 6)
    rep = s.recv(10)
    relay_port = struct.unpack(">H", rep[8:10])[0]
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    u.settimeout(8)
    qid = random.randint(0, 65535)
    q = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    for label in "example.com".split("."):
        q += bytes([len(label)]) + label.encode()
    q += b"\x00" + struct.pack(">HH", 1, 1)
    u.sendto(b"\x00\x00\x00\x01" + socket.inet_aton("1.1.1.1") + struct.pack(">H", 53) + q,
             ("127.0.0.1", relay_port))
    try:
        data, _ = u.recvfrom(4096)
        ans = struct.unpack(">H", data[10 + 6:10 + 8])[0] if len(data) > 18 else 0
        ok = data[10:12] == struct.pack(">H", qid) and ans > 0
        r.add("udp (dns via tunnel)", ok, f"{ans} answer(s) for example.com")
    except socket.timeout:
        r.add("udp (dns via tunnel)", False, "no reply in 8 s")
    finally:
        u.close()
        s.close()


def check_download(r, mb):
    n = mb * 1_000_000
    t = time.monotonic()
    st, _, got = https("GET", SPEED_HOST, f"/__down?bytes={n}", timeout=120, read_limit=True)
    dt = time.monotonic() - t
    r.add(f"download {mb} MB", st == 200 and got == n, f"{got * 8 / dt / 1e6:.1f} Mbps ({dt:.1f} s)")


def check_upload(r, mb):
    body = os.urandom(mb * 1_000_000)
    t = time.monotonic()
    st, _, _ = https("POST", SPEED_HOST, "/__up", body=body, timeout=120)
    dt = time.monotonic() - t
    r.add(f"upload {mb} MB", st == 200, f"{len(body) * 8 / dt / 1e6:.1f} Mbps ({dt:.1f} s)")


def check_parallel(r, n):
    def one(i):
        st, _, got = https("GET", SPEED_HOST, f"/__down?bytes={200_000 + i}", read_limit=True)
        return st == 200 and got == 200_000 + i
    t = time.monotonic()
    with cf.ThreadPoolExecutor(n) as ex:
        results = list(ex.map(lambda i: _safe(one, i), range(n)))
    ok = sum(results)
    r.add(f"{n} parallel streams", ok == n, f"{ok}/{n} complete in {time.monotonic() - t:.1f} s")


def check_churn(r, n):
    t, ok = time.monotonic(), 0
    for i in range(n):
        ok += _safe(lambda _: https("GET", "www.cloudflare.com", "/cdn-cgi/trace")[0] == 200, i)
    r.add(f"{n} reconnects", ok == n, f"{ok}/{n} in {time.monotonic() - t:.1f} s")


def check_long(r, seconds):
    t = time.monotonic()
    n = 4_000_000
    st, _, got = https("GET", SPEED_HOST, f"/__down?bytes={n}", timeout=seconds + 60,
                       read_limit=True, slow=n / seconds)
    dt = time.monotonic() - t
    r.add("long-lived stream", st == 200 and got == n, f"held {dt:.0f} s, {got} bytes intact")


def _safe(fn, arg):
    try:
        return bool(fn(arg))
    except Exception as exc:  # noqa: BLE001 - every failure counts as one failed attempt
        print(f"      attempt {arg}: {exc}", file=sys.stderr)
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("link")
    ap.add_argument("--xray", required=True, help="path to an xray binary for the client side")
    ap.add_argument("--mb", type=int, default=50, help="bulk transfer size")
    ap.add_argument("--parallel", type=int, default=64)
    ap.add_argument("--churn", type=int, default=150)
    ap.add_argument("--long", type=int, default=45, help="seconds to hold one stream open")
    ap.add_argument("--expect-ip", help="fail unless traffic leaves from this IP (the server's)")
    a = ap.parse_args()

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(client_config(a.link), f)
    proc = subprocess.Popen([a.xray, "run", "-c", f.name], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    time.sleep(1.5)
    if proc.poll() is not None:
        raise SystemExit("xray client failed to start:\n" + proc.stderr.read().decode())

    r = Report()
    try:
        ip = check_https(r)
        if a.expect_ip:
            r.add("no leak (egress = server)", ip == a.expect_ip, f"egress {ip}, server {a.expect_ip}")
        check_udp_dns(r)
        check_download(r, a.mb)
        check_upload(r, max(1, a.mb // 2))
        check_parallel(r, a.parallel)
        check_churn(r, a.churn)
        check_long(r, a.long)
    finally:
        proc.terminate()
        os.unlink(f.name)
    print(f"\n{len(r.rows) - r.failed}/{len(r.rows)} checks passed")
    sys.exit(1 if r.failed else 0)


if __name__ == "__main__":
    main()
