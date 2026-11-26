# Stand-in for Chromium in the tests of pi-chromium: records its arguments, then serves /json/version and /json/list on
# 127.0.0.1 and the port of --remote-debugging-port, until it is killed.
# FAKE_BROWSER_ARGS: the file its arguments are appended to, one start per line.
# FAKE_BROWSER_LIST: the file whose content /json/list answers ("[]" when the file is missing).
# FAKE_BROWSER_MUTE=1: never listen. FAKE_BROWSER_BAD_LIST=1: /json/list answers text that is not JSON.
import http.server
import os
import sys
import time

with open(os.environ["FAKE_BROWSER_ARGS"], "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")

if os.environ.get("FAKE_BROWSER_MUTE") == "1":
    while True:
        time.sleep(60)

port = int(next(a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--remote-debugging-port=")))


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/json/version":
            body = b'{"Browser": "FakeChrome/1.0", "webSocketDebuggerUrl": "ws://127.0.0.1/devtools/browser/fake"}'
        elif self.path == "/json/list":
            if os.environ.get("FAKE_BROWSER_BAD_LIST") == "1":
                body = b"<html>not json</html>"
            else:
                try:
                    with open(os.environ["FAKE_BROWSER_LIST"], "rb") as f:
                        body = f.read()
                except FileNotFoundError:
                    body = b"[]"
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
