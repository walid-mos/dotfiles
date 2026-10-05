#!/usr/bin/env python3
"""Manage the dedicated Pi/Hermes browser without touching personal Brave."""
import argparse
import json
import os
import plistlib
import shutil
import socket
import subprocess
import sys
import time
from threading import Event
import urllib.request
from pathlib import Path

LABEL = "fr.nextnode.agent-browser"
PORT = 9222
ENDPOINT = "http://127.0.0.1:{}".format(PORT)
HOME = Path.home()
STATE = HOME / ".local/share/agent-browser"
PROFILE = STATE / "profile"
PLIST = HOME / "Library/LaunchAgents/{}.plist".format(LABEL)
SERVICE = "gui/{}/{}".format(os.getuid(), LABEL)
DOMAIN = "gui/{}".format(os.getuid())
BRAVE = Path("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser")


def launchctl(*arguments):
    return subprocess.run(
        ["/bin/launchctl", *arguments], capture_output=True, text=True
    )


def require_launchctl(*arguments):
    result = launchctl(*arguments)
    if result.returncode:
        raise RuntimeError("launchctl {} failed: {}".format(" ".join(arguments), result.stderr.strip()))
    return result


def is_loaded():
    return launchctl("print", SERVICE).returncode == 0


def install_service():
    if not BRAVE.is_file():
        raise RuntimeError("Install Brave in /Applications before installing the service.")
    if is_loaded():
        raise RuntimeError("Service already installed; use status or restart, not a second owner.")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", PORT))
    for directory in (STATE, PROFILE, STATE / "logs"):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    agent = {
        "Label": LABEL,
        "ProgramArguments": [
            str(BRAVE),
            "--headless=new",
            "--no-startup-window",
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port={}".format(PORT),
            "--user-data-dir={}".format(PROFILE),
            "--no-first-run",
            "--no-default-browser-check",
        ],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "ThrottleInterval": 5,
        "ExitTimeOut": 30,
        "Umask": 0o077,
        "StandardOutPath": str(STATE / "logs/stdout.log"),
        "StandardErrorPath": str(STATE / "logs/stderr.log"),
    }
    PLIST.write_bytes(plistlib.dumps(agent))
    PLIST.chmod(0o600)
    require_launchctl("bootstrap", DOMAIN, str(PLIST))
    wait_for_browser()
    print("Installed {}: {} -> {}".format(LABEL, ENDPOINT, PROFILE))


def configure_clients(hermes_profile):
    hermes = shutil.which("hermes")
    if not hermes:
        raise RuntimeError("Hermes CLI is not on PATH; no client configuration changed.")
    subprocess.run(
        [hermes, "--profile", hermes_profile, "config", "set", "browser.cdp_url", ENDPOINT],
        check=True,
    )
    config_path = HOME / ".pi/agent/frontend-check.json"
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    config["CDP_URL"] = ENDPOINT
    staged_path = config_path.with_suffix(".json.pending")
    with staged_path.open("x", encoding="utf-8") as staged_file:
        staged_file.write(json.dumps(config, indent=2) + "\n")
    try:
        staged_path.chmod(0o600)
        staged_path.replace(config_path)
    finally:
        staged_path.unlink(missing_ok=True)
    saved = json.loads(config_path.read_text())
    if saved["CDP_URL"] != ENDPOINT:
        raise RuntimeError("Pi configuration readback failed.")
    print("Configured Pi and Hermes profile {} for {}".format(hermes_profile, ENDPOINT))


READINESS_TIMEOUT_S = 40
POLL_INTERVAL_S = 0.25
REQUEST_TIMEOUT_S = 2


def browser_version():
    with urllib.request.urlopen(ENDPOINT + "/json/version", timeout=REQUEST_TIMEOUT_S) as response:
        return json.load(response)


def wait_for_browser(previous_endpoint=None):
    deadline = time.monotonic() + READINESS_TIMEOUT_S
    readiness = Event()
    while time.monotonic() < deadline:
        try:
            version = browser_version()
        except (OSError, ValueError):
            version = {}
        current_endpoint = version.get("webSocketDebuggerUrl")
        if current_endpoint and current_endpoint != previous_endpoint:
            return version
        readiness.wait(POLL_INTERVAL_S)
    raise RuntimeError("Managed browser did not become ready; inspect its launchd job and logs.")


def restart_service():
    if not PLIST.is_file():
        raise RuntimeError("Install the managed service first.")
    previous_endpoint = None
    if is_loaded():
        previous_endpoint = browser_version()["webSocketDebuggerUrl"]
        # Keep the job registered; launchd restarts it after a non-forced SIGTERM.
        # Unload/reload races with launchd's asynchronous job teardown.
        require_launchctl("kill", "SIGTERM", SERVICE)
    else:
        require_launchctl("bootstrap", DOMAIN, str(PLIST))
    wait_for_browser(previous_endpoint)
    print("Restarted {}; persistent profile retained; new browser endpoint verified.".format(LABEL))


def is_endpoint_released():
    try:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", PORT))
    except OSError:
        return False
    return True


def stop_service():
    require_launchctl("bootout", SERVICE)
    deadline = time.monotonic() + READINESS_TIMEOUT_S
    readiness = Event()
    while time.monotonic() < deadline:
        if is_endpoint_released() and not is_loaded():
            print("Stopped {}; profile retained.".format(LABEL))
            return
        readiness.wait(POLL_INTERVAL_S)
    raise RuntimeError("Managed browser did not stop; inspect launchd before installing another owner.")


def show_status():
    version = browser_version()
    print(json.dumps({
        "service_loaded": is_loaded(),
        "endpoint": ENDPOINT,
        "profile": str(PROFILE),
        "profile_mode": oct(PROFILE.stat().st_mode & 0o777),
        "browser": version["Browser"],
    }, indent=2))


def main():
    if sys.platform != "darwin":
        raise RuntimeError("This service manager requires macOS launchd.")
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("install", "configure", "status", "restart", "stop"))
    parser.add_argument("--hermes-profile")
    arguments = parser.parse_args()
    if arguments.command == "configure":
        if not arguments.hermes_profile:
            parser.error("configure requires --hermes-profile; other profiles are never changed.")
        configure_clients(arguments.hermes_profile)
        return
    commands = {
        "install": install_service,
        "status": show_status,
        "restart": restart_service,
        "stop": stop_service,
    }
    commands[arguments.command]()


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print("Shared browser: {}".format(error), file=sys.stderr)
        sys.exit(1)
