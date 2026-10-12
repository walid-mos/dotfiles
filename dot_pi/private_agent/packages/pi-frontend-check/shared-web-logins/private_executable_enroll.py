#!/usr/bin/env python3
"""Terminal enrollment into the shared web-login vault: the password is typed into masked prompts and never reaches an agent."""

from __future__ import annotations

import getpass
import json
import sys

from broker import VaultUnavailable, save_login


def main() -> int:
    if not sys.stdin.isatty():
        print("Run enroll.py in an interactive terminal", file=sys.stderr)
        return 1
    login = {
        "origin": input("Origin of the password form (https://host): ").strip(),
        "identifier": input("Identifier: ").strip(),
        "label": input("Label (optional): ").strip(),
        "password": getpass.getpass("Password: "),
        "otp_secret": getpass.getpass("OTP secret (optional): "),
    }
    try:
        print(json.dumps(save_login(login), ensure_ascii=False))
    except VaultUnavailable as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
