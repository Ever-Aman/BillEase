#!/usr/bin/env python3
"""Incremental lexical code map. No daemon, database, network or dependencies."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAP = ROOT / '.codex' / 'project-map.json'
ROOTS = ['Backend/src', 'Backend/migrations', 'Backend/test', 'Frontend/lib', 'Frontend/test', 'Frontend/Admin']
SYMBOL = re.compile(r'^[ \t]*(?:(?:export|async|static|factory|override)\s+)*(?:(class|function)\s+([A-Za-z_]\w*)|(?:Future(?:<[^\n]+?>)?|void|String|bool|int|Json|Widget|Map<[^\n]+?>|List<[^\n]+?>|State<[^\n]+?>)\s+([A-Za-z_]\w*)\s*\()', re.M)
IMPORT = re.compile(r'''(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?|\bpart\s+(?:of\s+)?)["']([^"']+)["']''')
CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
IGNORE = {'if', 'for', 'while', 'switch', 'catch', 'return', 'function'}


def sync():
    old = json.loads(MAP.read_text()) if MAP.exists() else {'files': {}}
    if old.get('format') != 2:
        old = {'files': {}}
    files, changed = {}, []
    for directory in ROOTS:
        for path in sorted((ROOT / directory).rglob('*')):
            if path.suffix not in {'.js', '.mjs', '.dart', '.sql'} or not path.is_file():
                continue
            relative, stat = path.relative_to(ROOT).as_posix(), path.stat()
            previous = old['files'].get(relative)
            # Metadata gates the hash read; changed bytes gate symbol extraction.
            if previous and previous['mtime_ns'] == stat.st_mtime_ns and previous['size'] == stat.st_size:
                files[relative] = previous
                continue
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if previous and previous['sha256'] == digest:
                files[relative] = {**previous, 'mtime_ns': stat.st_mtime_ns, 'size': stat.st_size}
                continue
            source = data.decode('utf-8')
            imports = IMPORT.findall(source)
            dependencies = []
            for item in imports:
                if item.startswith('.'):
                    target = (path.parent / item).resolve()
                    if target.is_relative_to(ROOT) and target.exists():
                        dependencies.append(target.relative_to(ROOT).as_posix())
            symbols = [{'name': m.group(2) or m.group(3), 'kind': m.group(1) or 'method', 'line': source.count('\n', 0, m.start()) + 1} for m in SYMBOL.finditer(source)]
            routes = [{'method': m.group(1).upper(), 'path': m.group(2), 'line': source.count('\n', 0, m.start()) + 1} for m in re.finditer(r'''\b(?:router|api|app)\.(get|post|put|delete|patch|use)\(\s*["']([^"']+)["']''', source)]
            files[relative] = {'sha256': digest, 'mtime_ns': stat.st_mtime_ns, 'size': stat.st_size, 'imports': imports, 'dependencies': sorted(set(dependencies)), 'symbols': symbols, 'routes': routes, 'references': sorted(set(CALL.findall(source)) - IGNORE)}
            changed.append(relative)
    # Relationships can change when an imported file is added/deleted without
    # changing the importer. Refresh edges from cached import names, not source.
    for relative, node in list(files.items()):
        dependencies = []
        for item in node['imports']:
            target = None
            if item.startswith('.'):
                target = ((ROOT / relative).parent / item).resolve()
            elif item.startswith('package:billease_mobile/'):
                target = ROOT / 'Frontend/lib' / item.removeprefix('package:billease_mobile/')
            elif relative.endswith('.dart') and ':' not in item:
                target = ((ROOT / relative).parent / item).resolve()
            if target and target.is_relative_to(ROOT):
                resolved = target.relative_to(ROOT).as_posix()
                if resolved in files:
                    dependencies.append(resolved)
        dependencies = sorted(set(dependencies))
        if dependencies != node['dependencies']:
            files[relative] = {**node, 'dependencies': dependencies}
    deleted = sorted(set(old['files']) - set(files))
    MAP.parent.mkdir(exist_ok=True)
    if old.get('files') != files:
        MAP.write_text(json.dumps({'format': 2, 'kind': 'lexical; references are candidates, not resolved calls', 'files': files}, indent=2) + '\n')
    return files, changed, deleted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['sync', 'find', 'file'])
    parser.add_argument('query', nargs='?', default='')
    args = parser.parse_args()
    if args.command != 'sync' and not args.query:
        parser.error('A symbol or path query is required')
    files, changed, deleted = sync()  # Every lookup checks freshness first.
    if args.command == 'sync':
        print(json.dumps({'files': len(files), 'updated': len(changed), 'updated_files': changed[:20], 'removed': deleted}))
    elif args.command == 'file':
        print(json.dumps({p: v for p, v in files.items() if args.query in p}, indent=2))
    else:
        matches = []
        for path, node in files.items():
            for symbol in node['symbols']:
                if args.query.lower() in symbol['name'].lower():
                    matches.append({'file': path, **symbol, 'dependencies': node['dependencies'], 'referenced_by': [p for p, n in files.items() if symbol['name'] in n['references'] and p != path]})
        print(json.dumps(matches, indent=2))


if __name__ == '__main__':
    main()
