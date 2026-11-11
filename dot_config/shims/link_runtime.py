import json
import os
import shlex
import stat
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

PAIR_NAMES = ("mac-studio", "macbook-pro")
SSH_FLAGS = ("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
             "-o", "ConnectTimeout=5", "-o", "ForwardAgent=no",
             "-o", "ClearAllForwardings=yes", "-o", "ControlPath=none")
COMMAND_TIMEOUT = 15
TRANSFER_TIMEOUT = 60
TAILNET_LINK = Path.home() / ".local/bin/tailnet-link"


def run(arguments, **options):
    return subprocess.run(arguments, check=True, timeout=COMMAND_TIMEOUT,
                          text=True, capture_output=True, **options).stdout.strip()


def tailscale(*arguments):
    executable = run([str(Path(__file__).parent / "tsbin")])
    return run([executable, *arguments])


def snapshot():
    identity = json.loads(tailscale("status", "--json"))
    if not identity.get("Self", {}).get("DNSName"):
        raise ValueError("Tailscale has no self DNSName. Connect this machine to the tailnet.")
    return identity


def dns_name(node):
    return node["DNSName"].rstrip(".")


def nodes(identity):
    return [identity["Self"], *identity.get("Peer", {}).values()]


def find_node(identity, name):
    name = name.lower().rstrip(".")
    matches = [node for node in nodes(identity)
               if name in (dns_name(node).lower(), dns_name(node).split(".")[0].lower())
               or name in node.get("TailscaleIPs", [])]
    if len(matches) != 1:
        raise ValueError("Unknown or ambiguous Tailscale host: " + name)
    return matches[0]


def require_desktop(node):
    if node.get("OS") != "macOS":
        raise ValueError(dns_name(node) + " is not a supported macOS desktop. Open the HTTPS URL on that device manually.")
    if not node.get("Online"):
        raise ValueError(dns_name(node) + " is offline. Reconnect it before opening remotely.")


def caller_node(identity):
    connection = os.environ.get("SSH_CONNECTION", "")
    return find_node(identity, connection.split()[0]) if connection else identity["Self"]


def paired_node(identity):
    own_short = dns_name(identity["Self"]).split(".")[0]
    if own_short not in PAIR_NAMES:
        return None
    other = PAIR_NAMES[1 - PAIR_NAMES.index(own_short)]
    return next((node for node in nodes(identity)
                 if dns_name(node).split(".")[0] == other), None)


def ssh(node, command):
    require_desktop(node)
    return run(["ssh", *SSH_FLAGS, dns_name(node), command])


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    attributes = path.lstat()
    if not stat.S_ISDIR(attributes.st_mode) or attributes.st_uid != os.getuid():
        raise ValueError("Expected an owned, non-symlink cache directory: " + str(path))
    if stat.S_IMODE(attributes.st_mode) != 0o700:
        raise ValueError("Cache must have mode 0700. Review and chmod it: " + str(path))
    return path


def fetch_file(source, path):
    require_desktop(source)
    cache = private_directory(Path.home() / "Library/Caches/open-remote")
    descriptor, destination = tempfile.mkstemp(prefix="file-", suffix="-" + Path(path).name, dir=cache)
    command = "test -f {0} && test -r {0} && cat -- {0}".format(shlex.quote(path))
    try:
        with os.fdopen(descriptor, "wb") as output:
            subprocess.run(["ssh", *SSH_FLAGS, dns_name(source), command], stdout=output,
                           check=True, timeout=TRANSFER_TIMEOUT)
        return destination
    except BaseException:
        os.unlink(destination)
        raise


def stage_file(viewer, path):
    require_desktop(viewer)
    command = ('umask 077; cache="$HOME/Library/Caches/open-remote"; '
               'test ! -L "$cache" || { echo "open: cache is a symlink. Review $cache" >&2; exit 2; }; '
               'mkdir -p "$cache" || { echo "open: cannot create $cache" >&2; exit 2; }; '
               'test "$(stat -f %u "$cache")" = "$(id -u)" || '
               '{ echo "open: cache is not owned by this user. Review $cache" >&2; exit 2; }; '
               'test "$(stat -f %Lp "$cache")" = 700 || '
               '{ echo "open: cache permissions must be private. Review then run chmod 700 \\"$cache\\"" >&2; exit 2; }; '              
               'directory=$(mktemp -d "$cache/item-XXXXXXXX") && '
               'target="$directory"/' + shlex.quote(Path(path).name) + ' && '
               'if cat > "$target"; then printf "%s" "$target"; '
               'else rm -f "$target"; rmdir "$directory"; exit 2; fi')
    with open(path, "rb") as source:
        result = subprocess.run(["ssh", *SSH_FLAGS, dns_name(viewer), command],
                                stdin=source, stdout=subprocess.PIPE, text=True,
                                check=True, timeout=TRANSFER_TIMEOUT)
    destination = result.stdout
    prefix = "/Users/"
    if not destination.startswith(prefix) or "/Library/Caches/open-remote/item-" not in destination or "\n" in destination:
        raise ValueError("Remote file staging returned an invalid cache path.")
    return destination


def preview_url(local, mode):
    if mode == "dry":
        print("planned-preview: " + local)
        return local
    return subprocess.run([str(TAILNET_LINK), local], check=True, timeout=TRANSFER_TIMEOUT,
                          text=True, capture_output=True).stdout.strip()


def browser_url(argument, viewer, origin, identity, mode):
    parsed = urlsplit(argument)
    if parsed.scheme not in ("http", "https"):
        return argument
    if parsed.username or parsed.password:
        raise ValueError("Browser URLs must not contain credentials.")
    local_names = ("localhost", "127.0.0.1", "::1")
    own_names = (dns_name(identity["Self"]), *identity["Self"].get("TailscaleIPs", []))
    if parsed.hostname in local_names and dns_name(viewer) == dns_name(origin):
        return argument
    if parsed.hostname not in (*local_names, *own_names):
        return argument
    if parsed.hostname in local_names and dns_name(origin) != dns_name(identity["Self"]):
        raise ValueError("Ambiguous remote localhost URL. Run tailnet-link with it on the serving host and use the HTTPS URL it prints.")
    if parsed.scheme == "https" and parsed.hostname in own_names:
        return argument
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    local = urlunsplit(("http", "localhost:" + str(port), parsed.path, parsed.query, parsed.fragment))
    return preview_url(local, mode)


def report_error(error):
    if isinstance(error, subprocess.CalledProcessError):
        detail = (error.stderr or "").strip()
        return "Command failed: " + shlex.join(error.cmd) + ("\n" + detail if detail else "")
    if isinstance(error, PermissionError):
        return "macOS denied access. Export the file from its app to an accessible durable location, then retry. " + str(error)
    return str(error)
