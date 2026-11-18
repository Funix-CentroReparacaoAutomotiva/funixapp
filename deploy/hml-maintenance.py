"""Generate a restrictive HML gateway policy. No live file or Docker mutation.

Install only with the public gateway stopped; keep this policy active until
acceptance/rollback is durable. Use a fresh, private credential per operation.
"""
import base64
import hashlib
import secrets


ROUTES = {
    "/": "http://funix-hml-web-1:8080",
    "/api/ready": "http://funix-hml-api-1:8787",
    "/release.json": "http://funix-hml-web-1:8080",
    "/healthz": "http://funix-hml-web-1:8080",
}
USERNAME = "funix-maintenance"


def new_credential():
    """Return private login and separate Nginx htpasswd record, never log either."""
    password = secrets.token_urlsafe(32)
    salt = secrets.token_bytes(16)
    # Nginx's RFC 2307 SSHA format; high-entropy ephemeral password only.
    digest = hashlib.sha1(password.encode() + salt).digest()
    record = USERNAME + ":{SSHA}" + base64.b64encode(digest + salt).decode() + "\n"
    return {"username": USERNAME, "password": password}, record


def server_config():
    """A complete server block, not a patch to an arbitrary Nginx configuration."""
    blocks = ["""server {
    listen 8080;
    server_name hml.funix.com.br;
    access_log off;
    auth_basic "FUNIX maintenance";
    auth_basic_user_file /etc/nginx/hml.htpasswd;
    satisfy all;
    location / { return 503; }
"""]
    for route, upstream in ROUTES.items():
        blocks.append(f'''    location = {route} {{
        if ($request_method != GET) {{ return 503; }}
        if ($request_uri != "{route}") {{ return 503; }}
        proxy_pass {upstream}{route};
        proxy_pass_request_headers off;
        proxy_pass_request_body off;
        proxy_set_header Host hml.funix.com.br;
        proxy_set_header Content-Length "";
        proxy_set_header Connection close;
        proxy_ignore_headers X-Accel-Redirect;
        proxy_hide_header Set-Cookie;
    }}
''')
    return "".join(blocks) + "}\n"
