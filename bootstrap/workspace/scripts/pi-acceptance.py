"""Probe real Pi RPC shell routing without making model requests."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

DEADLINE_SECONDS = 30


class Pi:
    def __init__(self, cwd):
        self.process = subprocess.Popen(['pi', '--mode', 'rpc', '--offline', '--no-session', '--no-approve'], cwd=cwd,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.pending = b''
        self.events = []

    def command(self, command):
        identifier = str(len(self.events))
        request = {'id': identifier, 'type': 'bash', 'command': command}
        self.process.stdin.write((json.dumps(request) + '\n').encode())
        self.process.stdin.flush()
        deadline = time.monotonic() + DEADLINE_SECONDS
        while time.monotonic() < deadline:
            event = self.next_event(deadline)
            self.events.append(event)
            if event.get('type') == 'response' and event.get('id') == identifier:
                return event
        raise TimeoutError('Pi RPC command')

    def next_event(self, deadline):
        while b'\n' not in self.pending:
            if not self.selector.select(max(0, deadline - time.monotonic())):
                raise TimeoutError('Pi RPC response')
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise EOFError(self.process.stderr.read().decode())
            self.pending += chunk
        line, self.pending = self.pending.split(b'\n', 1)
        return json.loads(line)

    def close(self):
        self.process.terminate()
        self.process.wait(timeout=10)
        self.selector.close()
        assert not any(event.get('type') == 'agent_start' for event in self.events), 'Unexpected model run'


def probe(path, expected):
    instance = Pi(path)
    try:
        response = instance.command('uname -s; pwd')
        output = response.get('data', {}).get('output', '')
        if expected == 'blocked':
            assert 'Darwin' not in output and 'Linux' not in output, response
            assert not response.get('success') or response.get('data', {}).get('exitCode') != 0, response
        else:
            assert response['success'], response
            assert output.startswith(expected + '\n'), response
        print('PASS:', path, expected, response)
    finally:
        instance.close()


if __name__ == '__main__':
    home = Path.home()
    root = home / '.local/share/studio-workspace/workspaces'
    records = [json.loads(path.read_text()) for path in root.glob('*.json')]
    workspace = next(record for record in records if record['branch'] == 'dev-a' and record['phase'] == 'ready')
    probe(home, 'Darwin')
    probe(workspace['project']['root'], 'blocked')
    probe(workspace['path'], 'Linux')
    probe(Path(workspace['path']) / 'apps/front', 'Linux')
