#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Exact names only. Adding a runtime module requires an explicit packaging change.
const FILES = Object.freeze([
  'package.json',
  'cli/private-files.cjs', 'cli/desktop-config.cjs', 'docs/windows-tools.md',
  'cli/siyue-cli.cjs', 'cli/auth-client.cjs', 'cli/business-client.cjs',
  'cli/quick-fill.cjs', 'cli/account-admin.cjs', 'cli/report-query.cjs',
  'cli/admin-service.cjs', 'cli/query-client.cjs',
  'mcp/server.cjs', 'mcp/bridge.cjs', 'mcp/config.example.json', 'docs/siyue-cli-mcp.md'
]);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function regularPath(file, directory = false) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('构建路径不能包含符号链接：' + current);
  }
  const stat = fs.lstatSync(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error('构建路径类型不正确：' + absolute);
  return absolute;
}
function assertMetadata(pkg) {
  if (pkg.name !== 'siyue-platform-tools' || !/^\d+\.\d+\.\d+$/.test(pkg.version) || pkg.private !== true)
    throw Error('工具包名称、版本或 private 标记不正确');
  if (pkg.engines?.node !== '>=24.20.0' || JSON.stringify(pkg.bin) !== JSON.stringify({ 'siyue-cli': 'cli/siyue-cli.cjs', 'siyue-mcp': 'mcp/server.cjs' }))
    throw Error('工具包运行环境或命令入口不正确');
  if (['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies'].some(key => pkg[key] && Object.keys(pkg[key]).length))
    throw Error('工具包不允许包含 npm 依赖');
  if (JSON.stringify([...pkg.files || []].sort()) !== JSON.stringify(FILES.filter(file => file !== 'package.json').sort()))
    throw Error('package.json files 必须与工具包白名单完全一致');
  if (Object.keys(pkg.scripts || {}).some(key => !['build:tools', 'test:tools-package'].includes(key)))
    throw Error('工具包不允许配置安装或发布生命周期脚本');
}
function build(root, out, options = {}) {
  root = fs.realpathSync(root);
  if (!path.isAbsolute(out)) throw Error('--out 必须是仓库外的绝对目录');
  out = regularPath(out, true);
  if (out === root || out.startsWith(root + path.sep)) throw Error('工具包必须输出到仓库之外');
  const pkg = JSON.parse(fs.readFileSync(regularPath(path.join(root, 'package.json')), 'utf8'));
  assertMetadata(pkg);
  const versionTag = pkg.name + '-' + pkg.version;
  const final = {
    archive: path.join(out, versionTag + '.tgz'),
    checksum: path.join(out, versionTag + '.tgz.sha256'),
    manifest: path.join(out, versionTag + '.manifest.json')
  };
  for (const filename of Object.values(final)) if (fs.existsSync(filename)) throw Error('输出已存在，不覆盖：' + filename);
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'siyue-tools-build-'));
  fs.chmodSync(temporary, 0o700);
  const created = [];
  try {
    const stage = path.join(temporary, 'package'), artifacts = path.join(temporary, 'artifacts');
    fs.mkdirSync(stage, { mode: 0o700 }); fs.mkdirSync(artifacts, { mode: 0o700 });
    const entries = FILES.map(file => {
      const source = regularPath(path.join(root, file));
      let bytes = fs.readFileSync(source);
      // The installed tool package has no build/test scripts or lifecycle hooks.
      if (file === 'package.json') { const shipped = { ...pkg }; delete shipped.scripts; bytes = Buffer.from(JSON.stringify(shipped, null, 2) + '\n'); }
      const target = path.join(stage, file);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: file === pkg.bin['siyue-cli'] || file === pkg.bin['siyue-mcp'] ? 0o755 : 0o644 });
      return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
    });
    const userConfig = path.join(temporary, 'npm-userconfig'), globalConfig = path.join(temporary, 'npm-globalconfig');
    fs.writeFileSync(userConfig, '', { mode: 0o600 }); fs.writeFileSync(globalConfig, '', { mode: 0o600 });
    const env = { ...process.env, npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_ignore_scripts: 'true', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
    delete env.NODE_OPTIONS;
    const packed = JSON.parse(execFileSync(options.npm || 'npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', artifacts], { cwd: stage, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    if (!Array.isArray(packed) || packed.length !== 1 || packed[0].filename !== versionTag + '.tgz') throw Error('npm pack 返回了不符合预期的产物');
    const actual = packed[0].files.map(file => file.path).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...FILES].sort())) throw Error('工具包包含了白名单外文件或缺少运行文件');
    const archive = fs.readFileSync(regularPath(path.join(artifacts, packed[0].filename)));
    let revision = null;
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Source archive need not have a Git checkout. */ }
    const manifest = { format: 'siyue-tools-package-v1', name: pkg.name, version: pkg.version, revision, archive: path.basename(final.archive), archiveSha256: sha256(archive), files: entries };
    const contents = { archive, checksum: Buffer.from(manifest.archiveSha256 + '  ' + manifest.archive + '\n'), manifest: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') };
    for (const key of ['archive', 'checksum', 'manifest']) {
      const fd = fs.openSync(final[key], fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      created.push(final[key]); try { fs.writeFileSync(fd, contents[key]); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    return { ...manifest, ...final };
  } catch (error) {
    for (const file of created) fs.rmSync(file, { force: true });
    throw error;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--out') throw Error('用法：node scripts/build-tools.cjs --out /absolute/existing/directory');
    console.log(JSON.stringify(build(path.resolve(__dirname, '..'), process.argv[3]), null, 2));
  } catch (error) { console.error('BUILD_TOOLS_FAILED: ' + error.message); process.exitCode = 1; }
}
module.exports = { FILES, build, assertMetadata };
