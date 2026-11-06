import argparse
import fcntl
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deliverables
from link_runtime import (assert_no_funnel, dns_name, https_url, private_directory,
                          report_error, run, serve_config, snapshot, tailscale)

LOOPBACK_ADDRESSES = {"127.0.0.1", "[::1]"}
HTTP_TIMEOUT = 8
PORT_MIN = 1024
PORT_MAX = 65535


def port_number(value):
    try:
        port = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("Port must be an integer.") from error
    if not PORT_MIN <= port <= PORT_MAX:
        raise argparse.ArgumentTypeError("Use an unprivileged port from 1024 through 65535.")
    return port


def listener_check(port):
    output = run(["/usr/sbin/lsof", "-nP", "-iTCP:" + str(port), "-sTCP:LISTEN", "-F", "n"])
    addresses = [line[1:].rsplit(":", 1)[0] for line in output.splitlines() if line.startswith("n")]
    if not addresses or any(address not in LOOPBACK_ADDRESSES for address in addresses):
        raise ValueError("Expected a loopback-only backend owned by this user on port " + str(port) + ". Bind it to 127.0.0.1, not a tailnet IP or 0.0.0.0. lsof cannot prove other users have no listeners.")
    return output


def expected_entries(port, identity):
    authority = dns_name(identity["Self"]) + ":" + str(port)
    tcp = {"HTTPS": True}
    web = {"Handlers": {"/": {"Proxy": "http://127.0.0.1:" + str(port)}}}
    return authority, tcp, web


def write_receipt(path, receipt):
    descriptor, pending = tempfile.mkstemp(prefix=".receipt-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump(receipt, output)
        os.replace(pending, path)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def receipt_path(root, port):
    path = root / (str(port) + ".json")
    if path.is_symlink():
        raise ValueError("Refusing a symlink ownership receipt: " + str(path))
    return path


def assert_owned(config, receipt):
    port = str(receipt["port"])
    authority = receipt["authority"]
    if (config.get("TCP", {}).get(port) != receipt["tcp"]
            or config.get("Web", {}).get(authority) != receipt["web"]):
        raise ValueError("Preview mapping changed since creation. Review tailscale serve status before removing it manually.")
    sibling_authorities = [name for name in config.get("Web", {})
                           if name.endswith(":" + port) and name != authority]
    if sibling_authorities:
        raise ValueError("Other Serve handlers share this port. Refusing to remove it.")


def has_port(config, port):
    return str(port) in config.get("TCP", {}) or any(name.endswith(":" + str(port)) for name in config.get("Web", {}))


def preview(port, identity, root):
    listener_check(port)
    config = serve_config()
    assert_no_funnel(config)
    authority, tcp, web = expected_entries(port, identity)
    path = receipt_path(root, port)
    receipt = {"port": port, "authority": authority, "tcp": tcp, "web": web}
    if path.exists():
        if json.loads(path.read_text()) != receipt:
            raise ValueError("Ownership receipt does not match this host and port. Review it before proceeding.")
        if has_port(config, port):
            assert_owned(config, receipt)
            print(https_url(port, identity, config))
            return
    elif has_port(config, port):
        raise ValueError("Serve port " + str(port) + " already belongs to another configuration. Choose another backend port.")
    write_receipt(path, receipt)
    tailscale("serve", "--bg", "--https=" + str(port), "http://127.0.0.1:" + str(port))
    updated = serve_config()
    expected = json.loads(json.dumps(config))
    expected.setdefault("TCP", {})[str(port)] = tcp
    expected.setdefault("Web", {})[authority] = web
    if updated != expected:
        raise ValueError("Serve configuration differs from the requested addition. Review status. Ownership receipt retained for safe cleanup.")
    print(https_url(port, identity, updated))
    print("Tailnet-only. Peer access is not verified. Run tailnet-link verify from the viewer device.", file=sys.stderr)


def remove(port, identity, root):
    path = receipt_path(root, port)
    if not path.exists():
        raise ValueError("No ownership receipt for this port. Existing Serve handlers will not be removed.")
    receipt = json.loads(path.read_text())
    authority, tcp, web = expected_entries(port, identity)
    if receipt != {"port": port, "authority": authority, "tcp": tcp, "web": web}:
        raise ValueError("Ownership receipt does not match this host and port. Review it before proceeding.")
    config = serve_config()
    assert_no_funnel(config)
    if not has_port(config, port):
        path.unlink()
        print("Removed stale ownership receipt. No Serve handler was changed.")
        return
    assert_owned(config, receipt)
    tailscale("serve", "--bg", "--https=" + str(port), "off")
    updated = serve_config()
    expected = json.loads(json.dumps(config))
    del expected["TCP"][str(port)]
    del expected["Web"][authority]
    expected = {key: value for key, value in expected.items() if value}
    if updated != expected:
        raise ValueError("Unexpected Serve change during removal. Review status. Ownership receipt retained.")
    path.unlink()
    print("Removed owned preview: https://" + authority + "/")


def verify(url, expected):
    from urllib.parse import urlsplit
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".ts.net"):
        raise ValueError("Verify requires an HTTPS Tailscale DNS URL.")
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are not allowed.")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=HTTP_TIMEOUT) as response:
        body = response.read().decode("utf-8")
        if response.status != 200 or (expected is not None and expected not in body):
            raise ValueError("Expected HTTP 200 and the specified response text.")
        print(json.dumps({"url": url, "status": response.status, "tls": "verified", "body_matches": expected is None or expected in body}))


def main():
    parser = argparse.ArgumentParser(description="Tailnet-only HTTPS previews and deliverable publication. Serves only preview backends and the deliverables root, never enables Funnel.")
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("preview", "remove"):
        commands.add_parser(action).add_argument("port", type=port_number)
    verifier = commands.add_parser("verify")
    verifier.add_argument("url")
    verifier.add_argument("--expect")
    publisher = commands.add_parser("publish", description="Copy one file into the served deliverables root and print its tailnet HTTPS URL.")
    publisher.add_argument("file")
    publisher.add_argument("--dir", default="", help="Relative folder inside the deliverables root, such as a project slug.")
    commands.add_parser("install-deliverables", description="One-time setup: loopback static server as a LaunchAgent plus the Serve path mapping. Idempotent, no sudo.")
    arguments = parser.parse_args()
    if arguments.action == "verify":
        verify(arguments.url, arguments.expect)
        return
    identity = snapshot()
    if arguments.action == "publish":
        deliverables.publish(arguments.file, arguments.dir, identity)
        return
    root = private_directory(Path.home() / "Library/Application Support/tailnet-link")
    lock = root / "lock"
    descriptor = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        if arguments.action == "install-deliverables":
            deliverables.install(identity)
        else:
            {"preview": preview, "remove": remove}[arguments.action](arguments.port, identity, root)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print("tailnet-link: " + report_error(error), file=sys.stderr)
        sys.exit(2)
