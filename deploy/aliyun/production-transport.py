#!/usr/bin/env python3
"""GitHub runner transport. Keys stay in a private temporary directory."""
import argparse, json, os, re, subprocess, tempfile
from pathlib import Path


def run(command, capture=False):
    return subprocess.run(command, check=True, text=True, stdout=subprocess.PIPE if capture else None, timeout=900).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--receiver', type=Path, required=True)
    args = parser.parse_args()
    folder = args.bundle.resolve()
    manifest = json.loads((folder / 'deployment.json').read_text())
    revision = manifest['revision']
    if not re.fullmatch('[a-f0-9]{40}', revision):
        raise ValueError('Invalid source revision')
    stage_id = manifest['packages']['frontend']['releaseId']
    if not re.fullmatch('github-[a-f0-9]{12}-[0-9]+-[0-9]+', stage_id):
        raise ValueError('Invalid staging identity')
    host = os.environ.get('PRODUCTION_SSH_HOST', '')
    user = os.environ.get('PRODUCTION_SSH_USER', '')
    port = os.environ.get('PRODUCTION_SSH_PORT') or '22'
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.:-]*', host) or not re.fullmatch(r'[a-z_][a-z0-9_-]*', user) or not port.isdigit() or not 1 <= int(port) <= 65535:
        raise ValueError('Missing or invalid production SSH settings')
    if not os.environ.get('PRODUCTION_SSH_KEY') or not os.environ.get('PRODUCTION_SSH_KNOWN_HOSTS'):
        raise ValueError('A deployment key and independently verified SSH host key are required')
    repo = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch('[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid repository identity')
    def latest():
        ref = json.loads(run(['gh', 'api', 'repos/' + repo + '/git/ref/heads/main'], capture=True))
        if ref['object']['sha'] != revision:
            raise ValueError('Candidate is no longer main HEAD; deploy the newer tested commit')
    latest()
    with tempfile.TemporaryDirectory(prefix='siyue-production-ssh-') as private:
        directory = Path(private)
        key, known = directory / 'identity', directory / 'known_hosts'
        for path, value in [(key, os.environ['PRODUCTION_SSH_KEY']), (known, os.environ['PRODUCTION_SSH_KNOWN_HOSTS'])]:
            with open(path, 'x', opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
                stream.write(value.rstrip() + '\n')
        options = ['-i', str(key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(known), '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
        target = user + '@' + ('[' + host + ']' if ':' in host else host)
        stage = '/opt/siyue-crm/incoming/' + stage_id
        def ssh(command):
            return run(['ssh', '-p', port, *options, target, command], capture=True)
        ssh('umask 077; mkdir -p /opt/siyue-crm/incoming; mkdir -m 0700 ' + stage)
        archives = []
        for package in manifest['packages'].values():
            name = package['archive']
            if not re.fullmatch(r'(?:auth-)?github-[a-f0-9]{12}-[0-9]+-[0-9]+\.tar\.gz', name):
                raise ValueError('Invalid archive name')
            archives.append(str(folder / name))
        run(['scp', '-P', port, *options, str(folder / 'deployment.json'), str(args.receiver.resolve()), *archives, target + ':' + stage + '/'])
        receiver = 'python3 ' + stage + '/production-deploy.py '
        plan = json.loads(ssh(receiver + 'plan --stage ' + stage))
        (folder / 'deployment-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
        deployed = plan.get('deployedCommit')
        if deployed:
            if not re.fullmatch('[a-f0-9]{40}', deployed):
                raise ValueError('Invalid production source identity')
            run(['git', 'merge-base', '--is-ancestor', deployed, revision])
        latest()
        result = json.loads(ssh(receiver + 'activate --stage ' + stage))
        (folder / 'deployment-result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))

if __name__ == '__main__':
    main()
