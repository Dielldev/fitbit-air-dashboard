"""Google Health API v4: OAuth (desktop loopback flow) and a thin REST client.

Standard library only. Tokens live in data/auth.json (mode 0600).
"""
import base64
import hashlib
import json
import os
import secrets
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://health.googleapis.com/v4/users/me"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE_SUFFIXES = (
    "activity_and_fitness.readonly",
    "health_metrics_and_measurements.readonly",
    "sleep.readonly",
    "profile.readonly",
    "settings.readonly",
)
SCOPES = [f"https://www.googleapis.com/auth/googlehealth.{s}" for s in SCOPE_SUFFIXES]
# OAuth apps in "Testing" status get refresh tokens that die after 7 days.
TESTING_REFRESH_TTL = 7 * 86400

def _ssl_context():
    ctx = ssl.create_default_context()
    if not ctx.cert_store_stats().get("x509_ca"):
        # python.org macOS builds ship without root certs; fall back to the system bundle.
        for cafile in ("/etc/ssl/cert.pem", "/opt/homebrew/etc/ca-certificates/cert.pem"):
            if os.path.exists(cafile):
                ctx.load_verify_locations(cafile)
                break
    return ctx


SSL = _ssl_context()

GHEALTH_DIR = Path(os.environ.get("GHEALTH_CONFIG_DIR", Path.home() / ".config" / "ghealth"))


class AuthRequired(Exception):
    """No usable token: the user has to sign in again."""


class ApiError(Exception):
    def __init__(self, status, body):
        self.status, self.body = status, body
        super().__init__(f"HTTP {status}: {body[:300]}")


def _write_private(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


def _post_form(url, fields):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            return {"error": json.loads(body).get("error", "http_error"), "status": e.code, "body": body}
        except ValueError:
            return {"error": "http_error", "status": e.code, "body": body}


class Auth:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.path = data_dir / "auth.json"
        self.lock = threading.Lock()
        self.pending = {}  # state -> (code_verifier, redirect_uri)
        self.client = self._load_client()
        self.tok = self._load_tokens()

    # ---- bootstrap -------------------------------------------------------
    def _load_client(self):
        own = self.data_dir / "client_secret.json"
        src = own if own.exists() else GHEALTH_DIR / "client_secret.json"
        if not src.exists():
            raise SystemExit(
                "No OAuth client found. Put your Desktop-app client_secret JSON at "
                f"{own} (or run `ghealth setup` first).")
        raw = json.loads(src.read_text())
        client = raw.get("installed") or raw.get("web")
        if src != own:
            _write_private(own, raw)
        return client

    def _load_tokens(self):
        if self.path.exists():
            return json.loads(self.path.read_text())
        # First run: adopt the login that `ghealth setup` already did.
        gh = GHEALTH_DIR / "credentials.json"
        if gh.exists():
            c = json.loads(gh.read_text())
            if c.get("refresh_token"):
                login_at = gh.stat().st_mtime
                tok = {
                    "access_token": c.get("access_token"),
                    "refresh_token": c["refresh_token"],
                    "access_expires_at": _parse_ts(c.get("expiry")) or 0,
                    "login_at": login_at,
                    "refresh_expires_at": login_at + TESTING_REFRESH_TTL,
                    "source": "ghealth",
                }
                _write_private(self.path, tok)
                return tok
        return {}

    # ---- status ----------------------------------------------------------
    def status(self):
        t = self.tok
        if not t.get("refresh_token"):
            return {"connected": False, "reason": "not_signed_in"}
        if t.get("dead"):
            return {"connected": False, "reason": t["dead"], "login_at": t.get("login_at")}
        return {
            "connected": True,
            "login_at": t.get("login_at"),
            "refresh_expires_at": t.get("refresh_expires_at"),
        }

    # ---- interactive login (loopback redirect) ----------------------------
    def login_url(self, redirect_uri):
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        state = secrets.token_urlsafe(24)
        self.pending[state] = (verifier, redirect_uri)
        q = {
            "client_id": self.client["client_id"],
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return AUTH_URL + "?" + urllib.parse.urlencode(q)

    def complete(self, code, state):
        if state not in self.pending:
            raise AuthRequired("Login link expired or was opened twice. Try again.")
        verifier, redirect_uri = self.pending.pop(state)
        r = _post_form(TOKEN_URL, {
            "code": code,
            "client_id": self.client["client_id"],
            "client_secret": self.client["client_secret"],
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        })
        if "access_token" not in r or "refresh_token" not in r:
            raise AuthRequired(f"Token exchange failed: {r.get('error')} {r.get('body', '')[:200]}")
        now = time.time()
        with self.lock:
            self.tok = {
                "access_token": r["access_token"],
                "refresh_token": r["refresh_token"],
                "access_expires_at": now + int(r.get("expires_in", 3600)),
                "login_at": now,
                "refresh_expires_at": now + int(r.get("refresh_token_expires_in", TESTING_REFRESH_TTL)),
                "source": "dashboard",
            }
            _write_private(self.path, self.tok)

    # ---- token for API calls ---------------------------------------------
    def access_token(self, force_refresh=False):
        with self.lock:
            t = self.tok
            if not t.get("refresh_token") or t.get("dead"):
                raise AuthRequired(t.get("dead") or "not_signed_in")
            if not force_refresh and t.get("access_token") and t.get("access_expires_at", 0) > time.time() + 60:
                return t["access_token"]
            r = _post_form(TOKEN_URL, {
                "client_id": self.client["client_id"],
                "client_secret": self.client["client_secret"],
                "refresh_token": t["refresh_token"],
                "grant_type": "refresh_token",
            })
            if "access_token" not in r:
                if r.get("error") in ("invalid_grant", "unauthorized_client", "invalid_client"):
                    t["dead"] = "expired"  # 7-day testing-mode limit, or access revoked
                    _write_private(self.path, t)
                    raise AuthRequired("expired")
                raise ApiError(r.get("status", 0), r.get("body", str(r)))
            t["access_token"] = r["access_token"]
            t["access_expires_at"] = time.time() + int(r.get("expires_in", 3600))
            _write_private(self.path, t)
            return t["access_token"]


def _parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


class Client:
    """Read-only calls against health.googleapis.com/v4/users/me."""

    def __init__(self, auth: Auth):
        self.auth = auth
        self.calls = 0

    def _request(self, method, path, params=None, body=None):
        url = f"{API}/{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        refreshed = False
        for attempt in range(5):
            token = self.auth.access_token()
            req = urllib.request.Request(url, data=data, method=method, headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if data else {}),
            })
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=60, context=SSL) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if e.code == 401 and not refreshed:
                    self.auth.access_token(force_refresh=True)
                    refreshed = True
                    continue
                if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                    time.sleep(min(2 ** attempt, 20))
                    continue
                raise ApiError(e.code, text) from None
            except urllib.error.URLError as e:
                if attempt < 4:
                    time.sleep(min(2 ** attempt, 20))
                    continue
                raise ApiError(0, f"network: {e.reason}") from None

    def get(self, path):
        return self._request("GET", path)

    def list(self, dtype, filter_expr, limit=20000):
        out, token = [], None
        while True:
            params = {"filter": filter_expr}
            if token:
                params["pageToken"] = token
            r = self._request("GET", f"dataTypes/{dtype}/dataPoints", params=params)
            out.extend(r.get("dataPoints") or [])
            token = r.get("nextPageToken")
            if not token or len(out) >= limit:
                return out

    def _paged_post(self, path, body, key="rollupDataPoints"):
        out = []
        while True:
            r = self._request("POST", path, body=body)
            out.extend(r.get(key) or [])
            token = r.get("nextPageToken")
            if not token:
                return out
            body = {**body, "pageToken": token}

    def daily_rollup(self, dtype, start, end_exclusive):
        """Totals per local (civil) day. start/end are datetime.date."""
        def d(x):
            return {"date": {"year": x.year, "month": x.month, "day": x.day}}
        body = {"range": {"start": d(start), "end": d(end_exclusive)}, "windowSizeDays": 1}
        return self._paged_post(f"dataTypes/{dtype}/dataPoints:dailyRollUp", body)

    def rollup(self, dtype, start_utc, end_utc, window_seconds):
        """Aggregates over fixed physical-time windows. start/end are aware datetimes."""
        def iso(x):
            return x.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        body = {"range": {"startTime": iso(start_utc), "endTime": iso(end_utc)},
                "windowSize": f"{int(window_seconds)}s"}
        return self._paged_post(f"dataTypes/{dtype}/dataPoints:rollUp", body)
