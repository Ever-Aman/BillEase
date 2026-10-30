import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('code_graph', Path(__file__).with_name('code_graph.py'))
graph = importlib.util.module_from_spec(spec)
spec.loader.exec_module(graph)


class CodeGraphTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.original = graph.ROOT, graph.MAP
        graph.ROOT = Path(self.directory.name)
        graph.MAP = graph.ROOT / '.codex/project-map.json'
        self.addCleanup(self.restore)
        self.source = graph.ROOT / 'Backend/src'
        self.source.mkdir(parents=True)

    def restore(self):
        graph.ROOT, graph.MAP = self.original

    def test_symbols_routes_imports_and_unchanged_sync(self):
        (self.source / 'b.js').write_text('export function helper() {}\n')
        (self.source / 'a.js').write_text("import { helper } from './b.js';\nexport async function run() { helper(); }\nrouter.post('/work', run);\n")
        files, changed, deleted = graph.sync()
        self.assertEqual(len(changed), 2)
        self.assertFalse(deleted)
        self.assertEqual(files['Backend/src/a.js']['dependencies'], ['Backend/src/b.js'])
        self.assertEqual(files['Backend/src/a.js']['symbols'][0]['name'], 'run')
        self.assertEqual(files['Backend/src/a.js']['routes'][0]['method'], 'POST')
        self.assertIn('helper', files['Backend/src/a.js']['references'])
        modified = graph.MAP.stat().st_mtime_ns
        again, changed, deleted = graph.sync()
        self.assertEqual(files, again)
        self.assertFalse(changed)
        self.assertFalse(deleted)
        self.assertEqual(modified, graph.MAP.stat().st_mtime_ns)

    def test_dart_relative_and_internal_package_imports(self):
        library = graph.ROOT / 'Frontend/lib'
        library.mkdir(parents=True)
        (library / 'core.dart').write_text('class Core {}\n')
        (library / 'app.dart').write_text("import 'core.dart';\nimport 'dart:async';\nclass App {}\n")
        tests = graph.ROOT / 'Frontend/test'
        tests.mkdir(parents=True)
        (tests / 'app_test.dart').write_text("import 'package:billease_mobile/app.dart';\n")
        files, _, _ = graph.sync()
        self.assertEqual(files['Frontend/lib/app.dart']['dependencies'], ['Frontend/lib/core.dart'])
        self.assertEqual(files['Frontend/test/app_test.dart']['dependencies'], ['Frontend/lib/app.dart'])

    def test_only_changed_source_is_reparsed(self):
        a, b = self.source / 'a.js', self.source / 'b.js'
        a.write_text('function original() {}\n')
        b.write_text('function unaffected() {}\n')
        before, _, _ = graph.sync()
        a.write_text('function replacement() { unaffected(); }\n')
        after, changed, _ = graph.sync()
        self.assertEqual(changed, ['Backend/src/a.js'])
        self.assertEqual(after['Backend/src/b.js'], before['Backend/src/b.js'])
        self.assertEqual(after['Backend/src/a.js']['symbols'][0]['name'], 'replacement')

    def test_edges_follow_added_and_deleted_targets_without_importer_edit(self):
        a, b = self.source / 'a.js', self.source / 'b.js'
        a.write_text("import './b.js';\n")
        first, _, _ = graph.sync()
        self.assertEqual(first['Backend/src/a.js']['dependencies'], [])
        b.write_text('class Imported {}\n')
        added, changed, _ = graph.sync()
        self.assertEqual(changed, ['Backend/src/b.js'])
        self.assertEqual(added['Backend/src/a.js']['dependencies'], ['Backend/src/b.js'])
        b.unlink()
        removed, changed, deleted = graph.sync()
        self.assertFalse(changed)
        self.assertEqual(deleted, ['Backend/src/b.js'])
        self.assertEqual(removed['Backend/src/a.js']['dependencies'], [])


if __name__ == '__main__':
    unittest.main()
