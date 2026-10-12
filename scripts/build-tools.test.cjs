'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { build, FILES } = require('./build-tools.cjs');
const source = path.resolve(__dirname, '..');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'siyue-package-test-'));
  fs.chmodSync(temp, 0o700);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'repo'), output = path.join(temp, 'output');
  fs.mkdirSync(repo); fs.mkdirSync(output);
  for (const name of FILES) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.copyFileSync(path.join(source, name), path.join(repo, name));
  }
  return { temp, repo, output };
}
function npmEnvironment(temp) {
  const env = { ...process.env, npm_config_cache: path.join(temp, 'npm-cache'), npm_config_userconfig: path.join(temp, 'npm-userconfig'), npm_config_globalconfig: path.join(temp, 'npm-globalconfig'), npm_config_ignore_scripts: 'true', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  delete env.NODE_OPTIONS;
  fs.writeFileSync(env.npm_config_userconfig, ''); fs.writeFileSync(env.npm_config_globalconfig, '');
  return env;
}
test('tarball ships only explicit runtime files and installs both commands offline', t => {
  const f = fixture(t);
  const marker = 'FAKE_SESSION_MUST_NOT_SHIP_20261012';
  for (const name of ['session.json', 'cli/session.json', 'mcp/state.json', 'README.md', '.npmrc', 'backend/auth-store.json', 'deploy/private.json', 'docs/real-students.json', 'cli/temp.test.cjs']) {
    fs.mkdirSync(path.dirname(path.join(f.repo, name)), { recursive: true });
    fs.writeFileSync(path.join(f.repo, name), marker);
  }
  const result = build(f.repo, f.output);
  assert.equal(result.files.length, FILES.length);
  assert.deepEqual(result.files.map(file => file.path).sort(), [...FILES].sort());
  const archive = fs.readFileSync(result.archive);
  assert.equal(crypto.createHash('sha256').update(archive).digest('hex'), result.archiveSha256);
  assert.equal(fs.readFileSync(result.checksum, 'utf8'), result.archiveSha256 + '  ' + path.basename(result.archive) + '\n');
  const listed = execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(listed, FILES.map(file => 'package/' + file).sort());
  for (const file of [result.archive, result.checksum, result.manifest]) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const install = path.join(f.temp, 'install');
  const installed = spawnSync('npm', ['install', '--prefix', install, '--offline', '--ignore-scripts', '--no-package-lock', '--omit=dev', result.archive], { encoding: 'utf8', env: npmEnvironment(f.temp) });
  assert.equal(installed.status, 0, installed.stderr);
  const packageRoot = path.join(install, 'node_modules', 'siyue-platform-tools');
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts, undefined);
  assert.equal(pkg.dependencies, undefined);
  for (const entry of result.files) {
    const bytes = fs.readFileSync(path.join(packageRoot, entry.path));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.includes(marker), false);
  }
  for (const [name, args] of [['siyue-cli', ['help']], ['siyue-mcp', ['--help']]]) {
    const bin = path.join(install, 'node_modules', '.bin', name);
    assert.equal(fs.realpathSync(bin), path.join(packageRoot, pkg.bin[name]));
    const response = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, SIYUE_CONFIG_DIR: path.join(f.temp, 'uninitialized-session') } });
    assert.equal(response.status, 0, response.stderr);
    assert.match(response.stdout, new RegExp(name));
    assert.equal(fs.existsSync(path.join(f.temp, 'uninitialized-session')), false);
  }
  const before = fs.readFileSync(result.archive);
  assert.throws(() => build(f.repo, f.output), /输出已存在/);
  assert.deepEqual(fs.readFileSync(result.archive), before);
});
test('package rejects repo output, symbolic links and metadata that broadens packaging', t => {
  const f = fixture(t);
  assert.throws(() => build(f.repo, f.repo), /仓库之外/);
  const linked = path.join(f.temp, 'linked-output'); fs.symlinkSync(f.output, linked);
  assert.throws(() => build(f.repo, linked), /符号链接/);
  const server = path.join(f.repo, 'mcp', 'server.cjs');
  fs.renameSync(server, server + '.original'); fs.symlinkSync(server + '.original', server);
  assert.throws(() => build(f.repo, f.output), /符号链接/);
  fs.unlinkSync(server); fs.renameSync(server + '.original', server);
  const packageFile = path.join(f.repo, 'package.json'), original = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  for (const changed of [ { ...original, files: [...original.files, 'session.json'] }, { ...original, scripts: { ...original.scripts, postinstall: 'unexpected' } }, { ...original, dependencies: { unexpected: '*' } } ]) {
    fs.writeFileSync(packageFile, JSON.stringify(changed));
    assert.throws(() => build(f.repo, f.output), /白名单|生命周期|npm 依赖/);
  }
  assert.deepEqual(fs.readdirSync(f.output), []);
});
test('all relative runtime imports stay in the package except explicitly source-only simulation', () => {
  for (const name of FILES.filter(file => file.endsWith('.cjs'))) {
    const content = fs.readFileSync(path.join(source, name), 'utf8');
    for (const match of content.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
      if (name === 'cli/siyue-cli.cjs' && relative === 'cli/lesson-consumption-simulation.cjs') continue;
      assert.ok(FILES.includes(relative), name + ' imports unpackaged module ' + relative);
    }
  }
});
