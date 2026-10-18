#!/usr/bin/env python3
"""Build allowlisted portable Windows tools with a hash-pinned official Node runtime."""
import argparse, hashlib, io, json, pathlib, subprocess, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
NODE = '24.21.0'
HASHES = {
    'x64': '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
    'arm64': '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921',
}
def sha(data): return hashlib.sha256(data).hexdigest()
def build(out, arch):
    pkg = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    # Reuse the npm package's reviewed runtime allowlist and metadata validator.
    expected = json.loads(subprocess.check_output(['node', '-e', "const b=require('./scripts/build-tools.cjs');b.assertMetadata(require('./package.json'));console.log(JSON.stringify(b.FILES))"], cwd=ROOT))
    name = f'siyue-tools-{pkg["version"]}-windows-{arch}'
    out = pathlib.Path(out).resolve(strict=True)
    if out == ROOT or ROOT in out.parents: raise ValueError('Output must be outside the repository')
    targets = [out / (name + suffix) for suffix in ('.zip', '.zip.sha256', '.manifest.json')]
    if any(p.exists() for p in targets): raise FileExistsError('Refusing to overwrite release files')
    url = f'https://nodejs.org/dist/v{NODE}/node-v{NODE}-win-{arch}.zip'
    with urllib.request.urlopen(url, timeout=120) as response: runtime = response.read(100_000_000)
    if sha(runtime) != HASHES[arch]: raise ValueError('Official Node archive checksum mismatch')
    files = {}
    for file in expected:
        source = ROOT / file
        if source.is_symlink() or not source.is_file(): raise ValueError(f'Unsafe source: {file}')
        files[file] = source.read_bytes()
    shipped = dict(pkg); shipped.pop('scripts', None)
    files['package.json'] = (json.dumps(shipped, ensure_ascii=False, indent=2)+'\n').encode()
    with zipfile.ZipFile(io.BytesIO(runtime)) as z:
        prefix = f'node-v{NODE}-win-{arch}/'
        for source, target in [('node.exe', 'runtime/node.exe'), ('LICENSE', 'runtime/LICENSE')]:
            files[target] = z.read(prefix + source)
    for command, entry in [('siyue-cli', 'cli\\siyue-cli.cjs'), ('siyue-mcp', 'mcp\\server.cjs')]:
        files[command + '.cmd'] = ('@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%~dp0runtime\\node.exe" "%~dp0' + entry + '" %*\r\nexit /b %errorlevel%\r\n').encode()
    files['Open-CLI.cmd'] = b'@echo off\r\nchcp 65001 >nul\r\nset "PATH=%~dp0;%PATH%"\r\ncd /d "%~dp0"\r\necho Siyue CLI - type: siyue-cli help\r\ncmd /K\r\n'
    files['README.txt'] = files['docs/windows-tools.md']
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    manifest = {'format':'siyue-windows-tools-v1', 'version':pkg['version'], 'architecture':arch, 'revision':revision,
                'nodeVersion':NODE, 'runtimeSource':url, 'runtimeArchiveSha256':HASHES[arch],
                'files':[{'path':p, 'bytes':len(b), 'sha256':sha(b)} for p,b in sorted(files.items())]}
    files['manifest.json'] = (json.dumps(manifest, indent=2)+'\n').encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file, data in sorted(files.items()):
            item = zipfile.ZipInfo(name + '/' + file, (2026,10,18,0,0,0)); item.compress_type=zipfile.ZIP_DEFLATED; item.external_attr=0o100644 << 16
            z.writestr(item, data)
    archive = buffer.getvalue(); manifest['archive']=targets[0].name; manifest['archiveSha256']=sha(archive)
    contents = [archive, (sha(archive)+'  '+targets[0].name+'\n').encode(), (json.dumps(manifest, indent=2)+'\n').encode()]
    for target, content in zip(targets, contents):
        with target.open('xb') as f: f.write(content)
    print(json.dumps({'archive':str(targets[0]),'sha256':sha(archive),'files':len(files)}, indent=2))
if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--arch',choices=HASHES,required=True)
    args=parser.parse_args();build(args.out,args.arch)
