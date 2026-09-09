"""Generate least-privilege local development gateway services."""
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import subprocess
import tempfile

DNS_PORT = 5354
HTTPS_PORT = 8443
SUFFIX = 'herdr.test'


def command(arguments, **options):
    return subprocess.run(arguments, check=True, **options)


def executable(name):
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f'Missing {name}; install the server workspace prerequisites first.')
    return path


def tailscale_address():
    result = subprocess.run(['tailscale', 'status', '--json'], capture_output=True, text=True)
    if result.returncode:
        return None
    status = json.loads(result.stdout)
    addresses = status.get('TailscaleIPs') or []
    return next((address for address in addresses if ':' not in address), None)


def write_plist(path, label, arguments, logs, environment=None):
    settings = {'Label': label, 'ProgramArguments': arguments, 'RunAtLoad': True,
                'KeepAlive': True, 'ThrottleInterval': 10,
                'StandardOutPath': str(logs / f'{label}.log'),
                'StandardErrorPath': str(logs / f'{label}.log')}
    if environment:
        settings['EnvironmentVariables'] = environment
    path.write_bytes(plistlib.dumps(settings))


def install_agent(label, arguments, root, environment=None):
    directory = Path.home() / 'Library/LaunchAgents'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'{label}.plist'
    previous = path.read_bytes() if path.exists() else None
    write_plist(path, label, arguments, root / 'logs', environment)
    target = f'gui/{os.getuid()}/{label}'
    active = subprocess.run(['launchctl', 'print', target], capture_output=True).returncode == 0
    if active and previous == path.read_bytes():
        return
    subprocess.run(['launchctl', 'bootout', target], capture_output=True)
    command(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)])


def install_user_services(root):
    gateway = root / 'gateway'
    for directory in [root / 'logs', gateway / 'data', gateway / 'config']:
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    address = tailscale_address()
    dns_config = gateway / 'dnsmasq.conf'
    dns_config.write_text(f'port={DNS_PORT}\nlisten-address=127.0.0.1\nbind-interfaces\nno-resolv\nno-hosts\nlocal=/{SUFFIX}/\naddress=/{SUFFIX}/{address or "127.0.0.1"}\nlocal-ttl=30\n')
    environment = {'HOME': str(Path.home()), 'XDG_DATA_HOME': str(gateway / 'data'), 'XDG_CONFIG_HOME': str(gateway / 'config')}
    install_agent('dev.herdr.gateway', [executable('caddy'), 'run', '--config', str(gateway / 'Caddyfile'), '--adapter', 'caddyfile'], root, environment)
    install_agent('dev.herdr.dns', [executable('dnsmasq'), '--keep-in-foreground', '--conf-file=' + str(dns_config)], root)
    # dnsmasq does not reread address records on SIGHUP; restart only this private resolver.
    command(['launchctl', 'kickstart', '-k', f'gui/{os.getuid()}/dev.herdr.dns'])
    return address


def relay_plist(stage, root, address, family, public_port, target_port, user):
    key = address.replace('.', '-')
    label = f'dev.herdr.relay.{family.lower()}.{public_port}.{key}'
    operation = 'RECVFROM' if family == 'UDP4' else 'LISTEN'
    target = 'UDP4-SENDTO' if family == 'UDP4' else family
    listener = f'{family}-{operation}:{public_port},bind={address},reuseaddr,fork,su={user}'
    destination = f'{target}:127.0.0.1:{target_port}'
    path = stage / f'{label}.plist'
    write_plist(path, label, [executable('socat'), listener, destination], root / 'logs')
    return label, path


def admin_plan(root, address):
    stage = Path(tempfile.mkdtemp(prefix='studio-workspace-host-'))
    lines = ['#!/bin/sh', 'set -eu', 'mkdir -p /etc/resolver']
    lines += ["printf 'nameserver 127.0.0.1\\nport 53\\n' > /etc/resolver/herdr.test", 'chmod 644 /etc/resolver/herdr.test']
    user = os.environ['USER']
    addresses = ['127.0.0.1'] + ([address] if address else [])
    for bind_address in addresses:
        for family, public_port, target_port in [('TCP4', 443, HTTPS_PORT), ('TCP4', 53, DNS_PORT), ('UDP4', 53, DNS_PORT)]:
            label, path = relay_plist(stage, root, bind_address, family, public_port, target_port, user)
            lines += daemon_install_lines(label, path)
    lines.append('dscacheutil -flushcache')
    installer = stage / 'install-admin.sh'
    installer.write_text('\n'.join(lines) + '\n')
    installer.chmod(0o700)
    return installer


def daemon_install_lines(label, path):
    target = '/Library/LaunchDaemons/' + path.name
    return [f'cp {shlex.quote(str(path))} {shlex.quote(target)}',
            f'chown root:wheel {shlex.quote(target)}', f'chmod 644 {shlex.quote(target)}',
            f'launchctl bootout system/{label} >/dev/null 2>&1 || true',
            'attempt=0',
            f'until launchctl bootstrap system {shlex.quote(target)}; do',
            '  attempt=$((attempt + 1))',
            '  [ "$attempt" -lt 15 ] || exit 1',
            '  sleep 1',
            'done',
            f'launchctl enable system/{label}']
