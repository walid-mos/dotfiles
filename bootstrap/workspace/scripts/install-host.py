#!/usr/bin/env python3
"""Install Studio-only launch services. Invoke through the host administration tool."""
import argparse
import importlib.util
import os
from pathlib import Path
import shlex
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('host_services', SOURCE / 'scripts/host-services.py')
services = importlib.util.module_from_spec(spec)
spec.loader.exec_module(services)


def install_launcher():
    destination = Path.home() / '.local/bin/wt'
    destination.parent.mkdir(parents=True, exist_ok=True)
    node = services.executable('node')
    destination.write_text(f'#!/bin/sh\nexec {shlex.quote(node)} {shlex.quote(str(SOURCE / "src/cli.ts"))} "$@"\n')
    destination.chmod(0o755)


def wait_for_certificate(root):
    certificate = root / 'gateway/data/caddy/pki/authorities/local/root.crt'
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if certificate.exists():
            return
        time.sleep(0.1)
    raise RuntimeError(f'Gateway CA was not created. Inspect {root}/logs/dev.herdr.gateway.log')


def authorize(installer, mode):
    if mode == 'none':
        print('Administrator installation deferred:', installer)
        return
    if mode == 'sudo':
        services.command(['sudo', '/bin/sh', str(installer)])
        return
    command = '/bin/sh ' + shlex.quote(str(installer))
    escaped = command.replace('\\', '\\\\').replace('"', '\\"')
    services.command(['osascript', '-e', f'do shell script "{escaped}" with administrator privileges'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--admin', choices=['prompt', 'sudo', 'none'], default='prompt')
    options = parser.parse_args()
    root = Path(os.environ.get('WT_STATE_HOME', Path.home() / '.local/share/studio-workspace'))
    for executable in ['node', 'caddy', 'dnsmasq', 'socat', 'tailscale']:
        services.executable(executable)
    install_launcher()
    services.command([str(Path.home() / '.local/bin/wt'), 'gateway'])
    address = services.install_user_services(root)
    wait_for_certificate(root)
    installer = services.admin_plan(root, address)
    authorize(installer, options.admin)
    certificate = root / 'gateway/data/caddy/pki/authorities/local/root.crt'
    services.command(['security', 'add-trusted-cert', '-r', 'trustRoot', '-k', str(Path.home() / 'Library/Keychains/login.keychain-db'), str(certificate)])
    print('Local private gateway configured. CA certificate:', certificate)
    if address:
        print(f'Tailscale split DNS: restricted nameserver {address}, domain herdr.test.')
    else:
        print('REMOTE ACCESS PENDING: tailscaled is not authenticated. After login, rerun this installer to bind the private tailnet address.')
    print('MacBook: trust only the exported root.crt, never copy the CA private key.')


if __name__ == '__main__':
    main()
