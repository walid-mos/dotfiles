import json
import os
import re
import subprocess
import sys
from pathlib import Path

VAULT_CONFIG = Path.home() / ".config/agent-secrets/core-vault.json"
TIMEOUT_SECONDS = 30
KEY_WRITER = "import os,sys; sys.stdout.write(os.environ[sys.argv[1]])"


def resolve_key(name):
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*_API_KEY", name):
        raise ValueError("Invalid provider key name")
    config = json.loads(VAULT_CONFIG.read_text())
    paths = [path for path, names in config["exports"].items() if name in names]
    if len(paths) != 1:
        raise ValueError("Provider key must have exactly one vault binding")
    command = [
        "infisical", "run", "--projectId", config["projectId"],
        "--env", config["environment"], "--path", paths[0], "--silent",
        "--", "python3", "-c", KEY_WRITER, name,
    ]
    environment = {key: value for key, value in os.environ.items() if key != name}
    result = subprocess.run(command, capture_output=True, timeout=TIMEOUT_SECONDS, env=environment)
    if result.returncode or not result.stdout or any(byte in b" \t\r\n" for byte in result.stdout):
        raise RuntimeError("Provider key could not be loaded from Infisical")
    return result.stdout


try:
    if len(sys.argv) != 2:
        raise ValueError("Expected one provider key name")
    sys.stdout.buffer.write(resolve_key(sys.argv[1]))
except BaseException:
    sys.stderr.write("Provider key unavailable. Check the Infisical login, binding and secret.\n")
    sys.exit(1)
