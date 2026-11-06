import filecmp
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from link_runtime import assert_no_funnel, dns_name, run, serve_config, tailscale

ROOT = Path.home() / "Public/deliverables"
MOUNT_PATH = "/deliverables"
PORT = 18791
BACKEND = "http://127.0.0.1:" + str(PORT)
LABEL = "fr.nextnode.deliverables"
PLIST = Path.home() / "Library/LaunchAgents" / (LABEL + ".plist")
LOG = Path.home() / "Library/Logs" / (LABEL + ".log")
READINESS_SECONDS = 10
HTTP_TIMEOUT = 5
SETUP_HINT = "Run once on this machine, no sudo needed: tailnet-link install-deliverables"


def fetch_status(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=HTTP_TIMEOUT) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except OSError:
        return None


def describe(status):
    return "does not answer" if status is None else "answers HTTP " + str(status)


def handler_key(identity):
    return dns_name(identity["Self"]) + ":443"


def expected_handler():
    return {"Proxy": BACKEND}


def served_handler(identity, config):
    return config.get("Web", {}).get(handler_key(identity), {}).get("Handlers", {}).get(MOUNT_PATH)


def base_url(identity):
    return "https://" + dns_name(identity["Self"]) + MOUNT_PATH + "/"


def launch_agent():
    return {
        "Label": LABEL,
        "ProgramArguments": ["/usr/bin/python3", "-I", "-m", "http.server", str(PORT),
                             "--bind", "127.0.0.1", "--directory", str(ROOT)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardErrorPath": str(LOG),
        "ProcessType": "Adaptive",
    }


def owned_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir() or path.lstat().st_uid != os.getuid():
        raise ValueError("Expected an owned, non-symlink directory: " + str(path))
    return path


def write_atomically(destination, source, mode):
    descriptor, pending = tempfile.mkstemp(prefix="." + destination.name + "-", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as writer:
            if isinstance(source, bytes):
                writer.write(source)
            else:
                with open(source, "rb") as reader:
                    shutil.copyfileobj(reader, writer)
        os.chmod(pending, mode)
        os.replace(pending, destination)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def wait_for_port_free():
    deadline = time.monotonic() + READINESS_SECONDS
    while fetch_status(BACKEND + "/") is not None:
        if time.monotonic() > deadline:
            raise ValueError("Another process answers on " + BACKEND + ". Stop it before installing the deliverables server.")
        time.sleep(0.2)


def load_launch_agent():
    domain = "gui/" + str(os.getuid())
    subprocess.run(["launchctl", "bootout", domain + "/" + LABEL], capture_output=True)
    wait_for_port_free()
    run(["launchctl", "enable", domain + "/" + LABEL])
    run(["launchctl", "bootstrap", domain, str(PLIST)])


def wait_for_backend():
    deadline = time.monotonic() + READINESS_SECONDS
    while fetch_status(BACKEND + "/") != 200:
        if time.monotonic() > deadline:
            raise ValueError("The deliverables server did not answer on " + BACKEND + " within " + str(READINESS_SECONDS)
                             + "s. Inspect: launchctl print gui/" + str(os.getuid()) + "/" + LABEL + " and " + str(LOG))
        time.sleep(0.2)


def ensure_served(identity):
    config = serve_config()
    assert_no_funnel(config)
    handler = served_handler(identity, config)
    if handler == expected_handler():
        return
    if handler is not None:
        raise ValueError(MOUNT_PATH + " already serves " + json.dumps(handler) + ". Review tailscale serve status; nothing was changed.")
    tailscale("serve", "--bg", "--set-path=" + MOUNT_PATH, BACKEND)
    expected = json.loads(json.dumps(config))
    expected.setdefault("TCP", {}).setdefault("443", {"HTTPS": True})
    expected.setdefault("Web", {}).setdefault(handler_key(identity), {"Handlers": {}})["Handlers"][MOUNT_PATH] = expected_handler()
    if serve_config() != expected:
        raise ValueError("Serve configuration differs from the requested addition. Review tailscale serve status.")


def install(identity):
    owned_directory(ROOT)
    content = plistlib.dumps(launch_agent(), sort_keys=False)
    unchanged = PLIST.is_file() and not PLIST.is_symlink() and PLIST.read_bytes() == content
    if not (unchanged and fetch_status(BACKEND + "/") == 200):
        write_atomically(PLIST, content, 0o644)
        load_launch_agent()
        wait_for_backend()
    ensure_served(identity)
    probe = ROOT / (".probe-" + os.urandom(4).hex())
    write_atomically(probe, b"ok\n", 0o644)
    try:
        status = fetch_status(base_url(identity) + probe.name)
    finally:
        probe.unlink()
    if status != 200:
        raise ValueError("The tailnet URL " + describe(status) + " for a probe file in the deliverables root. Review tailscale serve status.")
    print(base_url(identity))
    print("Deliverables root: " + str(ROOT) + ". Tailnet-only; peer access is not verified.", file=sys.stderr)


def relative_target(subdirectory, name):
    folder = PurePosixPath(subdirectory)
    parts = folder.parts if subdirectory else ()
    if folder.is_absolute() or any(part == ".." or "\x00" in part for part in parts) or "\x00" in name:
        raise ValueError("--dir must be a relative folder path without .. components.")
    return PurePosixPath(*parts, name)


def publish(source, subdirectory, identity):
    source = Path(source).expanduser()
    if not source.is_file():
        raise ValueError("Expected a readable regular file: " + str(source))
    if served_handler(identity, serve_config()) != expected_handler() or not ROOT.is_dir():
        raise ValueError("Deliverables are not served on this machine. " + SETUP_HINT)
    relative = relative_target(subdirectory, source.name)
    destination = ROOT.joinpath(*relative.parts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.parent.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError("Destination escapes the deliverables root: " + str(destination))
    if destination.exists():
        if not (destination.is_file() and filecmp.cmp(source, destination, shallow=False)):
            raise ValueError(str(destination) + " already exists with different content. Publish under another name or --dir.")
    else:
        write_atomically(destination, source, 0o644)
    encoded = quote(relative.as_posix())
    status = fetch_status(BACKEND + "/" + encoded)
    if status != 200:
        raise ValueError("Copied to " + str(destination) + ", but the deliverables server " + describe(status) + ". " + SETUP_HINT)
    print(base_url(identity) + encoded)
    print("Tailnet-only. Peer access is not verified; run tailnet-link verify '<url>' from the viewer device if needed.", file=sys.stderr)
