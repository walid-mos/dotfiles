import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from link_runtime import (PAIR_NAMES, browser_url, caller_node, dns_name, fetch_file,
                          find_node, paired_node, report_error, require_desktop, run,
                          snapshot, ssh, stage_file)


def ancestry():
    process = os.getppid()
    names = set()
    while process > 1:
        try:
            names.add(Path(run(["ps", "-p", str(process), "-o", "comm="])).name)
            process = int(run(["ps", "-p", str(process), "-o", "ppid="]))
        except (subprocess.CalledProcessError, ValueError):
            break
    return names


def idle_seconds(output):
    for line in output.splitlines():
        if '"HIDIdleTime"' in line:
            return int(line.rsplit("=", 1)[1].strip())
    raise ValueError("HID idle time unavailable.")


def select_route(identity, mode, names):
    own = identity["Self"]
    origin = own
    if "herdr-core" in names:
        peer = paired_node(identity)
        if mode == "dry":
            print("branch: herdr-core; viewer routing unverified, remote HID skipped")
            return own, origin
        if not peer or not peer.get("Online"):
            print("open: paired desktop offline or absent, opening locally", file=sys.stderr)
            return own, origin
        own_idle = idle_seconds(run(["ioreg", "-c", "IOHIDSystem"]))
        try:
            peer_idle = idle_seconds(ssh(peer, "ioreg -c IOHIDSystem"))
        except (subprocess.SubprocessError, ValueError) as error:
            print("open: peer HID unavailable, opening locally: " + report_error(error), file=sys.stderr)
            return own, origin
        return (peer if peer_idle < own_idle else own), origin
    if "Herdr" in names:
        if dns_name(own).split(".")[0] == PAIR_NAMES[1]:
            origin = find_node(identity, PAIR_NAMES[0])
        if mode == "dry":
            print("branch: Herdr local viewer; origin=" + dns_name(origin))
        return own, origin
    if mode == "dry":
        print("branch: SSH caller" if os.environ.get("SSH_CONNECTION") else "branch: explicit source")
    return caller_node(identity), origin


def file_argument(argument, origin, identity):
    parsed = urlsplit(argument)
    if parsed.scheme != "file":
        return origin, str(Path(argument).expanduser().absolute())
    if parsed.query or parsed.fragment or parsed.username or parsed.password or parsed.port:
        raise ValueError("Use a file URL with only a Tailscale host and a percent-encoded absolute path.")
    source = origin if parsed.hostname in (None, "localhost") else find_node(identity, parsed.hostname)
    path = unquote(parsed.path, errors="strict")
    if not path.startswith("/") or "\x00" in path:
        raise ValueError("File URL must contain an absolute path without NUL bytes.")
    return source, path


def prepare_argument(argument, viewer, origin, identity, mode):
    parsed = urlsplit(argument)
    if parsed.scheme and parsed.scheme != "file":
        return browser_url(argument, viewer, origin, identity, mode)
    source, path = file_argument(argument, origin, identity)
    require_desktop(source)
    if mode == "dry":
        if dns_name(source) != dns_name(viewer):
            print("planned-file-transfer: " + json.dumps({"source": dns_name(source), "viewer": dns_name(viewer), "path": path}))
            return "<private viewer cache>/" + Path(path).name
        return path
    local = identity["Self"]
    if dns_name(source) == dns_name(viewer):
        return path
    if dns_name(source) != dns_name(local):
        path = fetch_file(source, path)
    if not Path(path).is_file():
        raise ValueError("Expected a readable regular file, not a directory or missing path: " + path)
    return stage_file(viewer, path) if dns_name(viewer) != dns_name(local) else path


def dry_command(command, own_name, viewer_name):
    print("self: " + own_name)
    print("viewer: " + viewer_name)
    print("argv: " + json.dumps(command))
    print("final-command: " + shlex.join(command))
    print("will-exit: 0; no SSH, fetch or write performed; remote activity unverified")


def dispatch(command, mode, identity=None, viewer=None):
    if mode == "dry":
        dry_command(command, dns_name(identity["Self"]) if identity else "local identity not required",
                    dns_name(viewer) if viewer else "local")
        return
    if identity and dns_name(viewer) != dns_name(identity["Self"]):
        ssh(viewer, "exec " + shlex.join(command))
        return
    subprocess.run(command, check=True)


def routed_open(values, mode, names):
    try:
        identity = snapshot()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise ValueError("Cannot resolve this routed open safely. Connect Tailscale first. " + report_error(error)) from error
    viewer, origin = select_route(identity, mode, names)
    require_desktop(viewer)
    if any(value.startswith("-") for value in values):
        if dns_name(viewer) != dns_name(origin) or any(urlsplit(value).scheme == "file" and urlsplit(value).hostname not in (None, "localhost") for value in values):
            raise ValueError("Native open flags are not supported on rewritten or remote routes. Use /usr/bin/open on the viewer.")
        dispatch(["/usr/bin/open", *values], mode, identity, viewer)
        return
    prepared = [prepare_argument(value, viewer, origin, identity, mode) for value in values]
    dispatch(["/usr/bin/open", *prepared], mode, identity, viewer)


def main():
    values = sys.argv[1:]
    if values == ["--help"]:
        parser = argparse.ArgumentParser(description="Open files and URLs with safe cross-machine routing. Native flags pass through only on unchanged local routes.")
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("arguments", nargs="*")
        parser.print_help()
        return
    mode = "dry" if values[:1] == ["--dry-run"] else "open"
    if mode == "dry":
        values = values[1:]
    if values[:1] == ["--"]:
        values = values[1:]
    if values == ["--viewer-host"]:
        identity = snapshot()
        viewer = caller_node(identity)
        require_desktop(viewer)
        if dns_name(viewer) != dns_name(identity["Self"]):
            print(dns_name(viewer))
        return
    if not values:
        raise ValueError("Provide a file path or URL. Use --help for usage.")
    names = ancestry()
    needs_identity = bool(os.environ.get("SSH_CONNECTION") or names.intersection({"Herdr", "herdr-core"}))
    has_remote_file = any(urlsplit(value).scheme == "file" and urlsplit(value).hostname not in (None, "localhost") for value in values)
    if not needs_identity and not has_remote_file:
        if mode == "dry":
            print("branch: plain local, independent of Tailscale")
        dispatch(["/usr/bin/open", *values], mode)
        return
    routed_open(values, mode, names)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print("open: " + report_error(error), file=sys.stderr)
        if sys.argv[1:2] == ["--dry-run"]:
            print("will-exit: 2")
        sys.exit(2)
