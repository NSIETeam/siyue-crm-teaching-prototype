#!/bin/sh
# Run on the authorized host after checksum-verified extraction. Never bootstrap or restore account data.
set -eu
root=/opt/siyue-crm
rid=${1-}
case "$rid" in auth-*[!A-Za-z0-9_-]*|'') exit 2;; auth-*) ;; *) exit 2;; esac
release="$root/auth-releases/$rid"
test -f "$release/auth-release-manifest.json"
test -s /var/lib/siyue-crm-auth/auth.json
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"
test -x "$node"
previous=$(readlink "$root/auth-current")
test -n "$previous"
backup="$root/incoming/$rid/activation-backup"
mkdir -m 0700 "$backup"
install -d -m 0700 /var/backups/siyue-crm
for file in /etc/nginx/snippets/siyue-crm.conf /etc/nginx/snippets/siyue-crm-auth.conf /etc/systemd/system/siyue-crm-auth.service /etc/systemd/system/siyue-crm-backup.service /etc/systemd/system/siyue-crm-backup.timer; do
 if test -f "$file"; then cp -p "$file" "$backup/$(basename "$file")"; fi
done
timer_was_enabled=$(systemctl is-enabled siyue-crm-backup.timer 2>/dev/null || true)
timer_was_active=$(systemctl is-active siyue-crm-backup.timer 2>/dev/null || true)
rollback() {
 trap - EXIT HUP INT TERM
 systemctl stop siyue-crm-backup.timer siyue-crm-backup.service siyue-crm-auth.service || true
 for file in /etc/nginx/snippets/siyue-crm.conf /etc/nginx/snippets/siyue-crm-auth.conf /etc/systemd/system/siyue-crm-auth.service /etc/systemd/system/siyue-crm-backup.service /etc/systemd/system/siyue-crm-backup.timer; do
  if test -f "$backup/$(basename "$file")"; then cp -p "$backup/$(basename "$file")" "$file"; else rm -f "$file"; fi
 done
 ln -sfn "$previous" "$root/auth-current.next"; mv -Tf "$root/auth-current.next" "$root/auth-current"
 systemctl daemon-reload
 systemctl start siyue-crm-auth.service || true
 if test "$timer_was_enabled" = enabled; then systemctl enable siyue-crm-backup.timer || true; else systemctl disable siyue-crm-backup.timer || true; fi
 if test "$timer_was_active" = active; then systemctl start siyue-crm-backup.timer || true; fi
 nginx -t && systemctl reload nginx || true
 printf 'Code and service configuration rolled back. Account and business data preserved.\n' >&2
 exit 1
}
trap rollback EXIT HUP INT TERM
systemctl stop siyue-crm-backup.timer siyue-crm-backup.service 2>/dev/null || true
systemctl stop siyue-crm-auth.service
install -m 0600 /var/lib/siyue-crm-auth/auth.json "$backup/auth-before.json"
if test -f /var/lib/siyue-crm-auth/business.sqlite; then
 SIYUE_AUTH_STORE=/var/lib/siyue-crm-auth/auth.json SIYUE_BUSINESS_STORE=/var/lib/siyue-crm-auth/business.sqlite SIYUE_BACKUP_DIR=/var/backups/siyue-crm "$node" "$release/backend/src/backup-business.cjs"
fi
ln -sfn "$release" "$root/auth-current.next"; mv -Tf "$root/auth-current.next" "$root/auth-current"
for name in siyue-crm-auth.service siyue-crm-backup.service siyue-crm-backup.timer; do install -m 0644 "$release/deploy/aliyun/$name" "/etc/systemd/system/$name"; done
systemctl daemon-reload
systemctl start siyue-crm-auth.service
python3 -I - <<'PY'
import urllib.request,json,time
for attempt in range(20):
 try:
  r=json.load(urllib.request.urlopen('http://127.0.0.1:8787/healthz',timeout=2))
  assert r['authenticationReady'] and r['businessReady'] and not r['paymentProviderReady']
  print('Authenticated business storage is healthy.'); break
 except Exception:
  if attempt==19: raise
  time.sleep(.25)
PY
install -m 0644 "$release/deploy/aliyun/auth-api.nginx.conf" /etc/nginx/snippets/siyue-crm-auth.conf
python3 -I - <<'PY'
from pathlib import Path
p=Path('/etc/nginx/snippets/siyue-crm.conf');s=p.read_text();line='include /etc/nginx/snippets/siyue-crm-auth.conf;'
if line not in s:p.write_text(s.rstrip()+'\n'+line+'\n')
PY
nginx -t
systemctl reload nginx
systemctl start siyue-crm-backup.service
systemctl enable siyue-crm-auth.service siyue-crm-backup.timer
systemctl start siyue-crm-backup.timer
for unit in siyue-crm-auth.service siyue-crm-backup.timer nginx siyue-question-bank.service postgresql; do systemctl is-active --quiet "$unit"; done
curl --connect-timeout 5 --max-time 15 -fsS https://www.siyuejn.com/crm-api/healthz | python3 -I -c 'import sys,json;r=json.load(sys.stdin);assert r["authenticationReady"] and r["businessReady"] and not r["paymentProviderReady"];print("Public API health verified.")' 
trap - EXIT HUP INT TERM
printf '\nBusiness deployment complete; existing account data preserved.\n'
