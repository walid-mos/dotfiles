#!/usr/bin/env python3
"""Model-blind Infisical login store shared by the Pi and Hermes browser adapters.

Only `read` writes a password to stdout. Adapters must capture that pipe in
memory and never pass it to a tool result, transcript, log, or shell command.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

CONFIG_FILE = Path(__file__).with_name("config.json")
CLI = "/opt/homebrew/bin/infisical"
KEY_PREFIX = "WEB_LOGIN_"
HANDLE_PREFIX = "iw:"
KEY_PATTERN = re.compile(r"WEB_LOGIN_[A-F0-9]{32}\Z")
TIMEOUT_SECONDS = 25


class VaultUnavailable(Exception):
    """Safe-to-display store failure; never contains login or subprocess output."""


def _settings() -> dict:
    settings = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    if not all(settings.get(key) for key in ("projectId", "environment", "path")):
        raise VaultUnavailable("Web-login project configuration is incomplete")
    return settings


def _run_cli(arguments: list[str], *, payload: bytes | None = None) -> bytes:
    settings = _settings()
    environment = {key: os.environ[key] for key in
                   ("HOME", "PATH", "USER", "LOGNAME", "TMPDIR", "XDG_CONFIG_HOME", "INFISICAL_PROFILE")
                   if key in os.environ}
    argv = [CLI, *arguments, "--projectId=" + settings["projectId"],
            "--env=" + settings["environment"], "--path=" + settings["path"],
            "--telemetry=false", "--silent"]
    try:
        completed = subprocess.run(argv, input=payload, capture_output=True,
                                   env=environment, timeout=TIMEOUT_SECONDS, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise VaultUnavailable("Infisical is unavailable") from None
    if completed.returncode:
        raise VaultUnavailable("Infisical rejected the web-login operation")
    return completed.stdout


def normalize_origin(origin: str) -> str:
    try:
        parts = urlsplit(origin)
        hostname = parts.hostname
        port = parts.port
    except (TypeError, ValueError):
        raise VaultUnavailable("Invalid website origin") from None
    if (not hostname or parts.username or parts.password or parts.path not in ("", "/")
            or parts.query or parts.fragment or parts.scheme not in ("https", "http")):
        raise VaultUnavailable("A website login needs an exact http(s) origin")
    if parts.scheme == "http" and hostname not in ("localhost", "127.0.0.1", "::1"):
        raise VaultUnavailable("Unencrypted non-local website origins are refused")
    host = f"[{hostname}]" if ":" in hostname else hostname.lower()
    suffix = "" if port is None or port == {"http": 80, "https": 443}[parts.scheme] else f":{port}"
    return f"{parts.scheme}://{host}{suffix}"


def _key_for(origin: str, identifier: str) -> str:
    digest = hashlib.sha256((origin + "\0" + identifier).encode("utf-8")).hexdigest()[:32].upper()
    return KEY_PREFIX + digest


def _key_from_handle(handle: str) -> str:
    key = KEY_PREFIX + handle.removeprefix(HANDLE_PREFIX).upper()
    if not handle.startswith(HANDLE_PREFIX) or not KEY_PATTERN.fullmatch(key):
        raise VaultUnavailable("Invalid web-login handle")
    return key


def _validate_record(raw: object, key: str) -> dict:
    if not isinstance(raw, dict) or raw.get("schema") != 1:
        raise VaultUnavailable("Invalid web-login record")
    origin, identifier, password = (raw.get("origin"), raw.get("identifier"), raw.get("password"))
    if not isinstance(origin, str) or not isinstance(identifier, str) or not isinstance(password, str):
        raise VaultUnavailable("Incomplete web-login record")
    if not identifier or not password or len(password) > 4096 or len(identifier) > 256:
        raise VaultUnavailable("Invalid web-login fields")
    if normalize_origin(origin) != origin or _key_for(origin, identifier) != key:
        raise VaultUnavailable("Web-login binding verification failed")
    if not isinstance(raw.get("label"), str) or not isinstance(raw.get("otp_secret", ""), str):
        raise VaultUnavailable("Invalid web-login metadata")
    return raw


def _metadata(key: str, record: dict) -> dict:
    identifier = record["identifier"]
    return {"handle": HANDLE_PREFIX + key[len(KEY_PREFIX):].lower(), "origin": record["origin"],
            "label": record["label"], "identifier": identifier,
            "identifier_type": "email" if "@" in identifier else "username",
            "has_otp": bool(record.get("otp_secret"))}


def list_logins() -> list[dict]:
    output = _run_cli(["export", "--format=json", "--expand=false", "--include-imports=false",
                       "--secret-overriding=false"])
    try:
        entries = json.loads(output)
        if not isinstance(entries, list):
            raise ValueError("Expected a list")
        return [_metadata(entry["key"], _validate_record(json.loads(entry["value"]), entry["key"]))
                for entry in entries if isinstance(entry, dict) and KEY_PATTERN.fullmatch(entry.get("key", ""))]
    except (ValueError, TypeError, KeyError):
        raise VaultUnavailable("Infisical returned invalid web-login metadata") from None


def read_login(handle: str) -> dict:
    key = _key_from_handle(handle)
    output = _run_cli(["secrets", "get", key, "--plain", "--expand=false",
                       "--include-imports=false", "--secret-overriding=false"])
    try:
        return _validate_record(json.loads(output), key)
    except (ValueError, TypeError):
        raise VaultUnavailable("Web login not found or malformed") from None


def save_login(login: dict) -> dict:
    origin = normalize_origin(str(login.get("origin", "")))
    identifier = str(login.get("identifier", "")).strip()
    password = login.get("password")
    label = str(login.get("label") or urlsplit(origin).hostname)
    record = {"schema": 1, "origin": origin, "identifier": identifier,
              "password": password, "label": label,
              "otp_secret": str(login.get("otp_secret") or "")}
    key = _key_for(origin, identifier)
    _validate_record(record, key)
    payload = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    _run_cli(["secrets", "set", key + "=@/dev/stdin"], payload=payload)
    if read_login(HANDLE_PREFIX + key[len(KEY_PREFIX):].lower()) != record:
        raise VaultUnavailable("Web login could not be verified after saving")
    return _metadata(key, record)


def main() -> int:
    try:
        if sys.argv[1:] == ["list"]:
            print(json.dumps(list_logins(), ensure_ascii=False))
        elif len(sys.argv) == 3 and sys.argv[1] == "read":
            handle = sys.argv[2]
            record = read_login(handle)
            print(json.dumps({**_metadata(_key_from_handle(handle), record), **record}, ensure_ascii=False))
        elif sys.argv[1:] == ["save"]:
            print(json.dumps(save_login(json.load(sys.stdin)), ensure_ascii=False))
        else:
            raise VaultUnavailable("Expected list, read HANDLE or save")
    except (VaultUnavailable, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
