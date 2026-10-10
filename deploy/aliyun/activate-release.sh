#!/bin/sh
# Local Linux server action only after inventory and authorized upload/extraction.
# Does not install packages, change Nginx, reload services, or remove old releases.
set -eu
app_root=${1-}
release_id=${2-}
case "$app_root" in /*) ;; *) echo 'Expected absolute application directory' >&2; exit 2;; esac
case "$app_root" in /|*[!A-Za-z0-9_/-]*|*/../*|*/./*|*/ ) echo 'Unsafe application directory' >&2; exit 2;; esac
case "$release_id" in ''|*[!A-Za-z0-9_-]*) echo 'Unsafe release ID' >&2; exit 2;; esac
for utility in sha256sum find sort cmp readlink ln mv grep sed mkdir rm; do command -v "$utility" >/dev/null || exit 2; done
release="$app_root/releases/$release_id"
[ -d "$release/public" ] && [ -f "$release/public/index.html" ] || { echo 'Release is incomplete' >&2; exit 2; }
[ -f "$release/SHA256SUMS" ] && [ -f "$release/public-files.list" ] || exit 2
[ -z "$(find "$release" -type l -print)" ] || { echo 'Release cannot contain symlinks' >&2; exit 2; }
if grep -Ev '^([A-Za-z0-9_-]+\.(html|js|css)|assets/[A-Za-z0-9_.-]+\.(png|svg|jpg|webp|woff2))$' "$release/public-files.list"; then echo 'Invalid release file list' >&2; exit 2; fi
if grep -Ev '^[a-f0-9]{64}  public/([A-Za-z0-9_-]+\.(html|js|css)|assets/[A-Za-z0-9_.-]+\.(png|svg|jpg|webp|woff2))$' "$release/SHA256SUMS"; then echo 'Invalid checksum list' >&2; exit 2; fi
temp="$app_root/.siyue-activation-$$"
mkdir "$temp"
trap 'rm -f "$temp/actual" "$temp/expected" "$temp/checksum-paths" "$temp/current" "$temp/previous"; rmdir "$temp"' EXIT HUP INT TERM
(cd "$release/public" && find . -type f | sed 's|^./||' | LC_ALL=C sort) > "$temp/actual"
LC_ALL=C sort "$release/public-files.list" > "$temp/expected"
sed 's/^[a-f0-9]*  public\///' "$release/SHA256SUMS" | LC_ALL=C sort > "$temp/checksum-paths"
cmp "$temp/actual" "$temp/expected" && cmp "$temp/expected" "$temp/checksum-paths" || { echo 'Unexpected or missing public files' >&2; exit 2; }
(cd "$release" && sha256sum -c SHA256SUMS)
for link in current previous; do
 if [ -e "$app_root/$link" ] && [ ! -L "$app_root/$link" ]; then echo "Refusing to replace existing directory/file: $link" >&2; exit 2; fi
done
old=''
if [ -L "$app_root/current" ]; then
 old=$(readlink "$app_root/current")
 case "$old" in releases/*) ;; *) echo 'Current link is outside managed releases' >&2; exit 2;; esac
 case "${old#releases/}" in ''|*[!A-Za-z0-9_-]*) echo 'Unsafe previous release target' >&2; exit 2;; esac
 [ -d "$app_root/$old/public" ] || { echo 'Current release is missing' >&2; exit 2; }
fi
if [ "$old" = "releases/$release_id" ]; then echo "Already active: $release_id"; exit 0; fi
if [ -n "$old" ]; then ln -s "$old" "$temp/previous"; mv -Tf "$temp/previous" "$app_root/previous"; fi
ln -s "releases/$release_id" "$temp/current"
mv -Tf "$temp/current" "$app_root/current"
echo "Active release: $release_id"
if [ -n "$old" ]; then echo "Rollback: sh activate-release.sh $app_root ${old#releases/}"; fi
