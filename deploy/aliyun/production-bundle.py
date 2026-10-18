#!/usr/bin/env python3
"""Build source-only immutable deployment artifacts; never contacts a server."""
import argparse, hashlib, json, re, subprocess, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def build(out, run_id):
    out = out.resolve()
    if out == ROOT or ROOT in out.parents or not re.fullmatch(r'[0-9]+-[0-9]+', run_id):
        raise ValueError('Use a numeric run id and an output directory outside the checkout')
    out.mkdir(parents=True, exist_ok=False)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    release = f'github-{revision[:12]}-{run_id}'
    result = {'schemaVersion': 1, 'revision': revision, 'baseline': json.loads((ROOT / 'production-version.json').read_text()), 'packages': {}}
    for kind, script, rid in [('frontend', 'build-release.cjs', release), ('backend', 'build-auth-release.cjs', 'auth-' + release)]:
        command = ['node', str(ROOT / 'deploy/aliyun' / script), '--out', str(out), '--release-id', rid]
        info = json.loads(subprocess.check_output(command, cwd=ROOT, text=True))
        if info['revision'] != revision:
            raise ValueError('Mixed source revisions')
        archive = Path(info['archive'])
        entries = {}
        with tarfile.open(archive, 'r:gz') as bundle:
            for member in bundle:
                if member.isdir():
                    continue
                if not member.isfile() or member.name in entries:
                    raise ValueError('Archive has non-regular or duplicate entries')
                data = bundle.extractfile(member).read()
                entries[member.name] = {'sha256': digest(data), 'bytes': len(data)}
        result['packages'][kind] = {'archive': archive.name, 'releaseId': rid, 'sha256': digest(archive.read_bytes()), 'entries': entries}
    (out / 'deployment.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'revision': revision, 'releaseId': release, 'manifest': str(out / 'deployment.json')}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    build(args.out, args.run_id)
