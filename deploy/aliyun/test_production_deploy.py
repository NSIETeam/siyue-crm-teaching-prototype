import fcntl, importlib.util, io, json, os, sqlite3, tarfile, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('production_deploy', Path(__file__).with_name('production-deploy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeServices:
    def __init__(self, data):
        self.data, self.events = data, []
        self.fail_health, self.fail_public, self.change_on_start, self.change_on_stop = 0, False, False, False
        self.concurrent = None

    def stop(self):
        self.events.append('stop')
        if self.change_on_stop:
            self.change_on_stop = False
            (self.data / 'auth.json').write_text('{"lastBeforeStop":true}')

    def start(self):
        self.events.append('start')
        if self.change_on_start:
            self.change_on_start = False
            with sqlite3.connect(self.data / 'business.sqlite') as db:
                db.execute("INSERT INTO records VALUES ('migration-preserved')")

    def healthy(self):
        self.events.append('health')
        if self.fail_health:
            self.fail_health -= 1
            raise RuntimeError('unhealthy fixture')

    def public(self, manifest, frontend):
        self.events.append('public')
        if self.concurrent:
            self.concurrent()
        if self.fail_public:
            raise RuntimeError('public fixture failed')


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name).resolve()
        self.root, self.data, self.backups, self.stage = [self.parent / name for name in ('root', 'data', 'backups', 'stage')]
        self.data.mkdir()
        self.stage.mkdir()
        self.front, self.back = self.root / 'releases/old-front', self.root / 'auth-releases/old-back'
        (self.front / 'public').mkdir(parents=True)
        (self.back / 'backend/src').mkdir(parents=True)
        (self.front / 'public/index.html').write_text('old frontend')
        (self.front / 'public/academic-dictionary.js').write_text('shared')
        (self.back / 'academic-dictionary.js').write_text('shared')
        (self.back / 'backend/src/server.cjs').write_text('old backend')
        (self.root / 'current').symlink_to(self.front)
        (self.root / 'auth-current').symlink_to(self.back)
        (self.data / 'auth.json').write_text('{"users":["synthetic-existing"]}')
        with sqlite3.connect(self.data / 'business.sqlite') as db:
            db.execute('CREATE TABLE records(value TEXT)')
            db.execute("INSERT INTO records VALUES ('existing-record')")
        self.services = FakeServices(self.data)
        self.deploy = module.Deployment(self.root, self.data, self.backups, self.services)
        self.baseline = self.deploy.source()

    def package(self, backend=True, frontend=True):
        revision = 'a' * 40
        manifest = {'schemaVersion': 1, 'revision': revision, 'baseline': self.baseline, 'packages': {}}
        for kind, contents in [('frontend', {'public/index.html': b'new frontend' if frontend else b'old frontend', 'public/academic-dictionary.js': b'shared'}), ('backend', {'backend/src/server.cjs': b'new backend' if backend else b'old backend', 'academic-dictionary.js': b'shared'})]:
            rid = ('auth-' if kind == 'backend' else '') + 'github-' + revision[:12] + '-17-1'
            info = {'revision': revision, 'releaseId': rid, 'files': [{'path': name[7:] if kind == 'frontend' else name, 'bytes': len(value), 'sha256': module.sha(value)} for name, value in contents.items()]}
            contents['release-manifest.json' if kind == 'frontend' else 'auth-release-manifest.json'] = json.dumps(info).encode()
            archive = self.stage / (rid + '.tar.gz')
            with tarfile.open(archive, 'w:gz') as bundle:
                for name, value in contents.items():
                    entry = tarfile.TarInfo(name)
                    entry.size = len(value)
                    bundle.addfile(entry, io.BytesIO(value))
            manifest['packages'][kind] = {'releaseId': rid, 'archive': archive.name, 'sha256': module.sha(archive.read_bytes()), 'entries': {name: {'bytes': len(value), 'sha256': module.sha(value)} for name, value in contents.items()}}
        (self.stage / 'deployment.json').write_text(json.dumps(manifest))
        return module.load_bundle(self.stage)

    def test_bundle_checksums_and_source_inventory_are_verified(self):
        bundle = self.package()
        self.assertEqual(len(module.expected_source(bundle)), 3)
        package = bundle['packages']['frontend']
        with open(self.stage / package['archive'], 'ab') as stream:
            stream.write(b'tampered')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            module.load_bundle(self.stage)

    def test_archive_traversal_links_and_private_paths_are_rejected(self):
        for path in ('../auth.json', '/etc/passwd', 'public/../auth.json', 'public/.env', 'public/auth.json', 'backend/src/../../auth.json', 'backend/src/auth.json', 'public/x\\y.js'):
            self.assertFalse(module.valid_member(path, 'frontend'))
            self.assertFalse(module.valid_member(path, 'backend'))
        bundle = self.package()
        package = bundle['packages']['frontend']
        archive = self.stage / package['archive']
        with tarfile.open(archive, 'w:gz') as output:
            item = tarfile.TarInfo('public/index.html')
            item.type, item.linkname = tarfile.SYMTYPE, '/etc/passwd'
            output.addfile(item)
        bundle['packages']['frontend']['sha256'] = module.sha(archive.read_bytes())
        (self.stage / 'deployment.json').write_text(json.dumps(bundle))
        with self.assertRaisesRegex(ValueError, 'member'):
            module.load_bundle(self.stage)

    def test_plan_refuses_drift_without_stopping_services(self):
        bundle = self.package()
        (self.front / 'public/index.html').write_text('concurrent edit')
        with self.assertRaisesRegex(ValueError, 'drift'):
            self.deploy.plan(bundle)
        self.assertEqual(self.services.events, [])

    def test_activation_refuses_a_stale_plan(self):
        bundle = self.package()
        plan = self.deploy.plan(bundle)
        plan['revision'] = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'plan changed'):
            self.deploy.activate(self.stage, bundle, plan)
        self.assertEqual(self.services.events, [])

    def test_success_preserves_records_and_creates_private_verified_backup(self):
        bundle = self.package()
        before = self.deploy.data_digest()
        result = self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(before, self.deploy.data_digest())
        self.assertEqual(self.services.events, ['stop', 'start', 'health', 'public'])
        self.assertEqual(self.deploy.source()['files'], module.expected_source(bundle))
        backup = self.backups / bundle['packages']['frontend']['releaseId']
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup / 'auth-before.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual((backup / 'business-before.sqlite').stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((self.root / 'source-sync/current.json').read_text())['commit'], bundle['revision'])

    def test_snapshot_is_taken_after_stop_including_last_account_write(self):
        bundle = self.package()
        self.services.change_on_stop = True
        self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        backup = self.backups / bundle['packages']['frontend']['releaseId'] / 'auth-before.json'
        self.assertEqual(json.loads(backup.read_text()), {'lastBeforeStop': True})

    def test_frontend_only_change_does_not_restart_backend(self):
        bundle = self.package(backend=False)
        result = self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        self.assertFalse(result['serviceRestarted'])
        self.assertEqual((self.root / 'auth-current').resolve(), self.back)
        self.assertEqual(self.services.events, ['health', 'public'])

    def test_identical_code_only_records_provenance_without_switch(self):
        bundle = self.package(backend=False, frontend=False)
        result = self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        self.assertEqual(result['status'], 'already-current')
        self.assertEqual((self.root / 'current').resolve(), self.front)
        self.assertFalse(self.backups.exists())

    def test_failed_health_restores_code_only_if_data_is_unchanged(self):
        bundle = self.package()
        self.services.fail_health = 1
        before = self.deploy.data_digest()
        with self.assertRaisesRegex(RuntimeError, 'unhealthy fixture'):
            self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        self.assertEqual((self.root / 'current').resolve(), self.front)
        self.assertEqual((self.root / 'auth-current').resolve(), self.back)
        self.assertEqual(before, self.deploy.data_digest())
        self.assertEqual(self.services.events[-2:], ['start', 'health'])

    def test_failed_health_after_migration_never_restores_database(self):
        bundle = self.package()
        self.services.fail_health = 1
        self.services.change_on_start = True
        with self.assertRaisesRegex(RuntimeError, 'data changed; service remains stopped'):
            self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        with sqlite3.connect(self.data / 'business.sqlite') as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM records').fetchone()[0], 2)
        self.assertEqual(self.services.events[-1], 'stop')
        self.assertNotEqual((self.root / 'auth-current').resolve(), self.back)

    def test_frontend_failure_restores_frontend_without_service_restart(self):
        bundle = self.package(backend=False)
        self.services.fail_public = True
        with self.assertRaisesRegex(RuntimeError, 'public fixture failed'):
            self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        self.assertEqual((self.root / 'current').resolve(), self.front)
        self.assertNotIn('stop', self.services.events)

    def test_concurrent_foreign_activation_is_never_rolled_back(self):
        bundle = self.package()
        other = self.root / 'releases/foreign'
        (other / 'public').mkdir(parents=True)
        self.services.concurrent = lambda: self.deploy.switch('current', other)
        self.services.fail_public = True
        with self.assertRaisesRegex(RuntimeError, 'Concurrent activation'):
            self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        self.assertEqual((self.root / 'current').resolve(), other)
        self.assertEqual(self.services.events.count('stop'), 1)

    def test_matching_marker_allows_future_descendant_plan_and_drift_still_fails(self):
        bundle = self.package()
        record = {**self.baseline, 'commit': 'b' * 40}
        module.atomic_json(self.root / 'source-sync/current.json', record)
        plan = self.deploy.plan(bundle)
        self.assertEqual(plan['deployedCommit'], 'b' * 40)
        (self.back / 'backend/src/server.cjs').write_text('unrecorded hotfix')
        with self.assertRaisesRegex(ValueError, 'drift'):
            self.deploy.plan(bundle)

    def test_another_deployment_lock_prevents_any_service_operation(self):
        bundle = self.package()
        plan = self.deploy.plan(bundle)
        with open(self.root / '.github-deploy.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.deploy.activate(self.stage, bundle, plan)
        self.assertEqual(self.services.events, [])

    def test_backup_failure_restarts_original_service_without_switching(self):
        bundle = self.package()
        def fail_backup(release):
            raise OSError('backup fixture failed')
        self.deploy.backup = fail_backup
        with self.assertRaisesRegex(OSError, 'backup fixture failed'):
            self.deploy.activate(self.stage, bundle, self.deploy.plan(bundle))
        self.assertEqual((self.root / 'auth-current').resolve(), self.back)
        self.assertEqual((self.root / 'current').resolve(), self.front)
        self.assertEqual(self.services.events, ['stop', 'start', 'health'])

    def test_archives_are_rechecked_after_planning_before_extraction(self):
        bundle = self.package()
        plan = self.deploy.plan(bundle)
        archive = self.stage / bundle['packages']['frontend']['archive']
        archive.write_bytes(b'changed after plan')
        with self.assertRaisesRegex(ValueError, 'changed after planning'):
            self.deploy.activate(self.stage, bundle, plan)
        self.assertEqual(self.services.events, [])


if __name__ == '__main__':
    unittest.main()
