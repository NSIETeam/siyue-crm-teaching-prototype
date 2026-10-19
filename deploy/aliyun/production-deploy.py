#!/usr/bin/env python3
"""Receiver for an existing Node production installation; no account bootstrap."""
import argparse, fcntl, hashlib, json, os, re, shutil, signal, sqlite3, subprocess, tarfile, tempfile, time, urllib.error, urllib.request
from pathlib import Path, PurePosixPath

ORIGIN = 'https://www.siyuejn.com'
FRONT_FILE = re.compile(r'(?:[A-Za-z0-9_-]+\.(?:html|js|css|csv)|assets/[A-Za-z0-9_.-]+\.(?:png|svg|jpg|webp|woff2))\Z')
BACK_FILE = re.compile(r'(?:(?:academic-dictionary|promotion-content)\.js|backend/src/[A-Za-z0-9_-]+\.cjs|backend/contracts/(?:build\.cjs|(?:operations|openapi)\.json)|cli/(?:[A-Za-z0-9_-]+\.cjs|operations\.json)|deploy/aliyun/[A-Za-z0-9_.-]+\.(?:sh|service|timer|conf))\Z')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fingerprint(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def interrupted(signum, frame):
    # Finish recovery even if SSH disconnects or the runner is cancelled.
    for item in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(item, signal.SIG_IGN)
    raise RuntimeError('Deployment interrupted; recovering the existing version')


def atomic_json(target, value, private=False):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.deploy-', dir=target.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600 if private else 0o644)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def valid_member(name, kind):
    if not name or '\\' in name or PurePosixPath(name).is_absolute() or any(part in ('', '.', '..') for part in name.split('/')):
        return False
    if kind == 'frontend':
        return (name.startswith('public/') and FRONT_FILE.fullmatch(name[7:]) is not None) or name in ('release-manifest.json', 'public-files.list', 'SHA256SUMS')
    return BACK_FILE.fullmatch(name) is not None or name == 'auth-release-manifest.json'


def load_bundle(stage):
    stage = stage.resolve()
    manifest_path = stage / 'deployment.json'
    if manifest_path.is_symlink():
        raise ValueError('Linked deployment manifest')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('schemaVersion') != 1 or not re.fullmatch('[a-f0-9]{40}', manifest.get('revision', '')) or set(manifest.get('packages', {})) != {'frontend', 'backend'}:
        raise ValueError('Invalid deployment manifest')
    for kind, package in manifest['packages'].items():
        if not re.fullmatch(r'(?:auth-)?github-[a-f0-9]{12}-[0-9]+-[0-9]+', package['releaseId']):
            raise ValueError('Unsafe release id')
        if kind == 'backend' and not package['releaseId'].startswith('auth-'):
            raise ValueError('Invalid backend release id')
        archive_name = package['archive']
        if archive_name != package['releaseId'] + '.tar.gz':
            raise ValueError('Unsafe archive name')
        archive = stage / archive_name
        if archive.is_symlink() or archive.stat().st_size > 32 * 1024 * 1024 or sha(archive.read_bytes()) != package['sha256']:
            raise ValueError('Archive checksum mismatch')
        entries = package['entries']
        if not entries or len(entries) > 500 or any(not valid_member(name, kind) for name in entries):
            raise ValueError('Unsafe archive inventory')
        seen = set()
        total_size = 0
        with tarfile.open(archive, 'r:gz') as bundle:
            for member in bundle:
                # Bundlers may emit directory records. They must also be safe.
                if member.isdir():
                    name = member.name.rstrip('/')
                    if name.startswith('/') or '..' in name.split('/') or '\\' in name:
                        raise ValueError('Unsafe directory')
                    continue
                if not member.isfile() or member.name in seen or member.name not in entries or member.size > 5 * 1024 * 1024:
                    raise ValueError('Unexpected archive member')
                data = bundle.extractfile(member).read()
                total_size += len(data)
                if total_size > 32 * 1024 * 1024 or entries[member.name] != {'sha256': sha(data), 'bytes': len(data)}:
                    raise ValueError('Archive content mismatch')
                seen.add(member.name)
        if seen != set(entries):
            raise ValueError('Incomplete archive')
        metadata = 'release-manifest.json' if kind == 'frontend' else 'auth-release-manifest.json'
        with tarfile.open(archive, 'r:gz') as bundle:
            info = json.load(bundle.extractfile(metadata))
        if info.get('revision') != manifest['revision'] or info.get('releaseId') != package['releaseId']:
            raise ValueError('Package source revision mismatch')
        expected = {(('public/' if kind == 'frontend' else '') + item['path']): {'sha256': item['sha256'], 'bytes': item['bytes']} for item in info['files']}
        actual = {name: value for name, value in entries.items() if name not in ('release-manifest.json', 'auth-release-manifest.json', 'public-files.list', 'SHA256SUMS')}
        if expected != actual:
            raise ValueError('Package manifest does not match archive inventory')
    return manifest


def expected_source(manifest):
    files = {}
    for kind, package in manifest['packages'].items():
        for name, value in package['entries'].items():
            if kind == 'frontend' and name.startswith('public/'):
                files[name[7:]] = value['sha256']
            elif kind == 'backend' and name != 'auth-release-manifest.json':
                if name in files and files[name] != value['sha256']:
                    raise ValueError('Frontend/backend shared source differs')
                files[name] = value['sha256']
    return dict(sorted(files.items()))


class Services:
    def stop(self):
        subprocess.run(['systemctl', 'stop', 'siyue-crm-auth.service'], check=True, timeout=45)

    def start(self):
        subprocess.run(['systemctl', 'start', 'siyue-crm-auth.service'], check=True, timeout=45)

    def healthy(self):
        for attempt in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:8787/healthz', timeout=2) as response:
                    value = json.load(response)
                if value.get('authenticationReady') and value.get('businessReady') and not value.get('qaLoadMode'):
                    return
            except (OSError, ValueError):
                pass
            time.sleep(.5)
        raise RuntimeError('Authentication/business health check failed')

    def public(self, manifest, frontend):
        for name, value in manifest['packages']['frontend']['entries'].items():
            if not name.startswith('public/'):
                continue
            url = ORIGIN + '/crm/' + name[7:] + '?deploy-check=' + manifest['revision']
            with urllib.request.urlopen(url, timeout=15) as response:
                if sha(response.read()) != value['sha256']:
                    raise RuntimeError('Public asset checksum mismatch: ' + name)
        with urllib.request.urlopen(ORIGIN + '/crm-api/healthz', timeout=15) as response:
            health = json.load(response)
        if not health.get('businessReady') or not health.get('authenticationReady') or health.get('qaLoadMode'):
            raise RuntimeError('Public health check failed')
        for endpoint in ('v1/auth/me', 'v1/state', 'v1/catalog'):
            try:
                urllib.request.urlopen(ORIGIN + '/crm-api/' + endpoint, timeout=15)
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    continue
            raise RuntimeError('Unauthenticated API access did not return 401')


class Deployment:
    def __init__(self, root=Path('/opt/siyue-crm'), data=Path('/var/lib/siyue-crm-auth'), backups=Path('/var/backups/siyue-crm'), services=None):
        self.root, self.data, self.backups = root.resolve(), data.resolve(), backups.resolve()
        self.services = services or Services()

    def source(self):
        front, back = (self.root / 'current').resolve(strict=True), (self.root / 'auth-current').resolve(strict=True)
        if front.parent != self.root / 'releases' or back.parent != self.root / 'auth-releases':
            raise ValueError('Active release outside managed directories')
        files = {}
        for prefix, base in [('', front / 'public'), ('backend/src', back / 'backend/src'), ('backend/contracts', back / 'backend/contracts'), ('cli', back / 'cli'), ('deploy/aliyun', back / 'deploy/aliyun')]:
            for file in base.rglob('*'):
                if file.is_symlink():
                    raise ValueError('Linked production source')
                if file.is_file():
                    name = str(file.relative_to(base)) if not prefix else str(file.relative_to(back))
                    files[name] = sha(file.read_bytes())
        for name in ('academic-dictionary.js', 'promotion-content.js'):
            shared = back / name
            if shared.is_symlink():
                raise ValueError('Linked production source')
            if shared.exists() and files.get(shared.name) != sha(shared.read_bytes()):
                raise ValueError('Shared module drift: ' + name)
        return {'frontendRelease': front.name, 'backendRelease': back.name, 'files': dict(sorted(files.items()))}

    def plan(self, manifest):
        observed = self.source()
        marker = self.root / 'source-sync/current.json'
        deployed = None
        if marker.exists():
            record = json.loads(marker.read_text())
            baseline = {key: record[key] for key in observed}
            deployed = record['commit']
            if not re.fullmatch('[a-f0-9]{40}', deployed):
                raise ValueError('Invalid deployed source commit')
        else:
            baseline = {key: manifest['baseline'][key] for key in observed}
        if observed != baseline:
            raise ValueError('Production drift: sync current server source into GitHub before deploying')
        desired = expected_source(manifest)
        current_backend = {name: value for name, value in observed['files'].items() if name.startswith(('backend/', 'cli/', 'deploy/')) or name in ('academic-dictionary.js', 'promotion-content.js')}
        next_backend = {name: value for name, value in desired.items() if name.startswith(('backend/', 'cli/', 'deploy/')) or name in ('academic-dictionary.js', 'promotion-content.js')}
        return {'schemaVersion': 1, 'revision': manifest['revision'], 'baselineFingerprint': fingerprint(observed), 'bundleFingerprint': fingerprint(manifest), 'deployedCommit': deployed, 'current': observed, 'backendChanged': current_backend != next_backend, 'sourceChanged': observed['files'] != desired}

    def switch(self, name, target):
        link = self.root / ('.' + name + '-github-next')
        if link.exists() or link.is_symlink():
            raise ValueError('Stale deployment link')
        link.symlink_to(target)
        os.replace(link, self.root / name)

    def data_digest(self):
        auth = self.data / 'auth.json'
        if not auth.is_file():
            raise ValueError('Existing authentication store required')
        result = hashlib.sha256(auth.read_bytes())
        db = self.data / 'business.sqlite'
        if db.exists():
            with sqlite3.connect('file:' + str(db) + '?mode=ro', uri=True) as connection:
                for line in connection.iterdump():
                    result.update(line.encode())
                    result.update(b'\n')
        return result.hexdigest()

    def backup(self, release):
        folder = self.backups / release
        folder.mkdir(parents=True, mode=0o700, exist_ok=False)
        os.chmod(folder, 0o700)
        auth = folder / 'auth-before.json'
        shutil.copyfile(self.data / 'auth.json', auth)
        os.chmod(auth, 0o600)
        db = self.data / 'business.sqlite'
        if db.exists():
            target = folder / 'business-before.sqlite'
            # Reserve a private file before SQLite writes any business data.
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
            with sqlite3.connect('file:' + str(db) + '?mode=ro', uri=True) as source, sqlite3.connect(target) as output:
                source.backup(output)
                if output.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Private database backup integrity failed')
        return folder

    def activate(self, stage, manifest, approved_plan):
        with open(self.root / '.github-deploy.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            plan = self.plan(manifest)
            if plan != approved_plan:
                raise ValueError('Deployment plan changed; obtain a fresh plan')
            original_front = (self.root / 'current').resolve()
            original_back = (self.root / 'auth-current').resolve()
            desired = expected_source(manifest)
            if not plan['sourceChanged']:
                self.services.healthy()
                self.services.public(manifest, original_front)
                record = {**self.source(), 'commit': manifest['revision'], 'treeSource': 'GitHub Actions', 'noCodeSwitch': True}
                atomic_json(self.root / 'source-sync/current.json', record)
                return {'revision': manifest['revision'], 'status': 'already-current', 'serviceRestarted': False}
            targets = {}
            for kind, package in manifest['packages'].items():
                target = self.root / ('releases' if kind == 'frontend' else 'auth-releases') / package['releaseId']
                target.mkdir(parents=True, exist_ok=False)
                archive = stage / package['archive']
                if archive.is_symlink() or sha(archive.read_bytes()) != package['sha256']:
                    raise ValueError('Archive changed after planning')
                seen = set()
                with tarfile.open(archive, 'r:gz') as bundle:
                    for member in bundle:
                        if member.isdir():
                            continue
                        if not member.isfile() or not valid_member(member.name, kind) or member.name in seen or member.name not in package['entries'] or member.size > 5 * 1024 * 1024:
                            raise ValueError('Archive member changed after planning')
                        content = bundle.extractfile(member).read()
                        if package['entries'][member.name] != {'sha256': sha(content), 'bytes': len(content)}:
                            raise ValueError('Archive content changed after planning')
                        dest = target / member.name
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        with open(dest, 'xb') as stream:
                            stream.write(content)
                        os.chmod(dest, 0o644)
                        seen.add(member.name)
                if seen != set(package['entries']):
                    raise ValueError('Archive changed after planning')
                targets[kind] = target
            if fingerprint(self.source()) != plan['baselineFingerprint']:
                raise ValueError('Concurrent production change before activation')
            stopped = False
            baseline_data = None
            switched_front = switched_back = False
            backup = None
            try:
                if plan['backendChanged']:
                    self.services.stop()
                    stopped = True
                    # The comparison baseline is captured after writes have stopped.
                    baseline_data = self.data_digest()
                    backup = self.backup(manifest['packages']['frontend']['releaseId'])
                    if fingerprint(self.source()) != plan['baselineFingerprint']:
                        raise ValueError('Concurrent production change after snapshot')
                    self.switch('auth-current', targets['backend'])
                    switched_back = True
                    self.services.start()
                    stopped = False
                    self.services.healthy()
                else:
                    self.services.healthy()
                expected_backend = targets['backend'] if switched_back else original_back
                if (self.root / 'auth-current').resolve() != expected_backend:
                    raise ValueError('Concurrent backend activation')
                if (self.root / 'current').resolve() != original_front:
                    raise ValueError('Concurrent frontend activation')
                self.switch('current', targets['frontend'])
                switched_front = True
                self.services.public(manifest, targets['frontend'])
                actual = self.source()
                if actual['files'] != desired:
                    raise ValueError('Activated source differs from reviewed package')
                record = {**actual, 'commit': manifest['revision'], 'treeSource': 'GitHub Actions'}
                atomic_json(self.root / 'source-sync/current.json', record)
                return {'revision': manifest['revision'], 'status': 'deployed', 'frontend': actual['frontendRelease'], 'backend': actual['backendRelease'], 'serviceRestarted': plan['backendChanged'], 'privateBackupCreated': backup is not None, 'publicAssetsVerified': True, 'previousFrontend': original_front.name, 'previousBackend': original_back.name}
            except Exception as error:
                # Never roll an unrelated concurrent deployment back.
                front_owned = (self.root / 'current').resolve() in (original_front, targets['frontend'])
                back_owned = (self.root / 'auth-current').resolve() in (original_back, targets['backend'])
                if not (front_owned and back_owned):
                    raise RuntimeError('Concurrent activation detected; no unrelated release or service was rolled back') from error
                if (self.root / 'current').resolve() == targets['frontend']:
                    self.switch('current', original_front)
                if back_owned and plan['backendChanged']:
                    if switched_back or not stopped:
                        self.services.stop()
                        stopped = True
                    if not switched_back or (baseline_data is not None and self.data_digest() == baseline_data):
                        self.switch('auth-current', original_back)
                        self.services.start()
                        stopped = False
                        self.services.healthy()
                    else:
                        raise RuntimeError('Deployment failed after data changed; service remains stopped. Keep private backup and recover manually; no database was restored.') from error
                raise


def main():
    for item in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(item, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['plan', 'activate'])
    parser.add_argument('--stage', required=True, type=Path)
    args = parser.parse_args()
    stage = args.stage.resolve()
    # The CLI is intentionally tied to the one existing production installation.
    incoming = Path('/opt/siyue-crm/incoming')
    if stage.parent != incoming or not re.fullmatch(r'github-[a-f0-9]{12}-[0-9]+-[0-9]+', stage.name):
        raise ValueError('Invalid incoming staging directory')
    manifest = load_bundle(stage)
    deployment = Deployment()
    if args.action == 'plan':
        plan = deployment.plan(manifest)
        atomic_json(stage / 'plan.json', plan)
        print(json.dumps(plan))
    else:
        result = deployment.activate(stage, manifest, json.loads((stage / 'plan.json').read_text()))
        atomic_json(stage / 'result.json', result)
        print(json.dumps(result))

if __name__ == '__main__':
    main()
