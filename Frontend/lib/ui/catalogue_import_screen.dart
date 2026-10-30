import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../app_controller.dart';
import '../models/models.dart';
import '../data/cache_store.dart';
import '../core/amount.dart';
import 'common.dart';

class CatalogueImportScreen extends StatefulWidget {
  final AppController app;
  const CatalogueImportScreen({super.key, required this.app});
  @override
  State<CatalogueImportScreen> createState() => _CatalogueImportScreenState();
}

class _CatalogueImportScreenState extends State<CatalogueImportScreen> {
  final text = TextEditingController();
  late final String scope;
  late final CacheStore cache;
  Json? review;
  List<Json> history = [], retainedImports = [];
  bool busy = false;
  Json? preview;
  bool submitted = false, ready = false;
  String? status;
  AppController get app => widget.app;
  bool get active =>
      app.business != null &&
      app.signedIn &&
      app.owner &&
      app.scope == scope &&
      identical(app.store, cache);
  void check() {
    if (!active) {
      throw StateError('Business or access changed. Reopen the catalogue.');
    }
  }

  @override
  void initState() {
    super.initState();
    scope = app.scope;
    cache = app.store!;
    restore();
  }

  Future<void> restore() async {
    final saved = await cache.get(scope, '_meta', 'catalogue_csv_import');
    final retained = await cache.all(scope, 'catalogue_csv_history');
    final pendingRetained = await cache.all(
      scope,
      CacheStore.retainedCatalogueCsvKind,
    );
    if (!mounted || !active) return;
    setState(() {
      history = retained;
      retainedImports = pendingRetained;
      text.text = '${saved?['csv'] ?? ''}';
      submitted = saved != null;
      ready = true;
    });
  }

  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }

  Future<void> template() async {
    check();
    final csv = await app.catalogueText(
      '/catalogue/import-template',
      expectedScope: scope,
    ) as String;
    check();
    await SharePlus.instance.share(
      ShareParams(
        title: 'BillEase catalogue CSV template',
        files: [
          XFile.fromData(
            Uint8List.fromList(utf8.encode(csv)),
            mimeType: 'text/csv',
          ),
        ],
        fileNameOverrides: ['BillEase-catalogue-template.csv'],
      ),
    );
  }

  Future<void> pick() async {
    check();
    final files = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['csv'],
    );
    if (!mounted || files.isEmpty) return;
    check();
    final file = files.single;
    final bytes = BytesBuilder();
    await for (final chunk in file.readAsByteStream()) {
      if (bytes.length + chunk.length > 256 * 1024) {
        throw StateError('Choose a UTF-8 CSV file no larger than 256 KB.');
      }
      bytes.add(chunk);
    }
    final csv = utf8.decode(bytes.takeBytes());
    if (!mounted) return;
    check();
    setState(() {
      text.text = csv;
      preview = null;
      status = null;
    });
  }

  Future<void> validate() async {
    check();
    if (utf8.encode(text.text).length > 256 * 1024) {
      throw StateError('Maximum CSV size is 256 KB.');
    }
    final csv = text.text;
    final result = object(
      await app.catalogueText(
        '/catalogue/import-preview',
        csv: csv,
        expectedScope: scope,
      ),
    );
    if (!mounted || !active || text.text != csv || submitted) return;
    setState(() {
      preview = result;
      status = null;
    });
  }

  Future<void> import() => work(() async {
    await app.catalogueImportWork(() async {
      await sendImport();
    });
    await app.sync();
  });

  Future<void> work(Future<void> Function() action) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> sendImport() async {
    check();
    if (!submitted &&
        (preview == null || (preview!['errors'] as List? ?? []).isNotEmpty)) {
      throw StateError('Validate and correct all rows first.');
    }
    final csv = text.text;
    final existing = await cache.get(scope, '_meta', 'catalogue_csv_import');
    check();
    if (existing != null && existing['csv'] != csv) {
      throw StateError('The pending import changed. Reopen this screen.');
    }
    if (submitted && existing == null) {
      throw StateError(
        'This import has already been completed or closed. Reopen this screen.',
      );
    }
    // Persist the exact intention before sending. Per-item operation IDs are CSV fields.
    setState(() {
      submitted = true;
      review = null;
    });
    await cache.put(scope, '_meta', 'catalogue_csv_import', {
      'csv': csv,
      'state': 'submitted',
    });
    check();
    final result = object(
      await app.catalogueText(
        '/catalogue/import',
        csv: csv,
        expectedScope: scope,
      ),
    );
    check();
    await cache.atomic(() async {
      check();
      final saved = await cache.get(scope, '_meta', 'catalogue_csv_import');
      check();
      if (saved?['csv'] != csv) {
        throw StateError('The pending import changed. Reopen this screen.');
      }
      await cache.remove(scope, '_meta', 'catalogue_csv_import');
    });
    if (!mounted || !active) return;
    setState(() {
      submitted = false;
      preview = null;
      text.clear();
      status =
          '${result['imported']} items imported. Catalogue synchronization follows.';
    });
  }

  Future<void> reviewImport() => work(
    () => app.catalogueImportWork(() async {
      check();
      final csv = text.text;
      final saved = await cache.get(scope, '_meta', 'catalogue_csv_import');
      check();
      if (saved?['csv'] != csv) {
        throw StateError('The pending import changed. Reopen this screen.');
      }
      // Persist the pause before checking the server; an offline review stays safe.
      await cache.put(scope, '_meta', 'catalogue_csv_import', {
        ...saved!,
        'state': 'review_required',
      });
      final result = object(
        await app.catalogueText(
          '/catalogue/import-status',
          csv: csv,
          expectedScope: scope,
        ),
      );
      check();
      if (!mounted || text.text != csv) return;
      setState(() => review = result);
    }),
  );

  Future<void> resumeRetainedImport(Json entry) => work(
    () => app.catalogueImportWork(() async {
      check();
      final id = entry['id'] as String;
      final csv = object(entry['originalJournal'])['csv'] as String;
      await cache.atomic(() async {
        final retained = await cache.get(
          scope,
          CacheStore.retainedCatalogueCsvKind,
          id,
        );
        final pending = await cache.get(scope, '_meta', 'catalogue_csv_import');
        check();
        if (pending != null ||
            retained?['originalScope'] != scope ||
            object(retained?['originalJournal'])['csv'] != csv) {
          throw StateError('Saved work changed. Reopen this screen.');
        }
        await cache.put(scope, '_meta', 'catalogue_csv_import', {
          ...object(retained!['originalJournal']),
          'state': 'review_required',
        });
        check();
        await cache.remove(scope, CacheStore.retainedCatalogueCsvKind, id);
      });
      check();
      final remaining = await cache.all(
        scope,
        CacheStore.retainedCatalogueCsvKind,
      );
      check();
      if (!mounted) return;
      setState(() {
        text.text = csv;
        submitted = true;
        preview = null;
        review = null;
        retainedImports = remaining;
        status = 'Original CSV restored for review. Automatic retries remain paused.';
      });
      final result = object(
        await app.catalogueText(
          '/catalogue/import-status',
          csv: csv,
          expectedScope: scope,
        ),
      );
      check();
      if (mounted) setState(() => review = result);
    }),
  );

  Future<void> closeImport() async {
    check();
    if (review == null || busy) return;
    final reviewedCsv = text.text, reviewedStatus = review!;
    var note = '';
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Close reviewed import?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Accepted items stay accepted. Unapplied items will no longer retry. The original CSV and this status review are retained on this device.',
            ),
            TextField(
              onChanged: (value) => note = value,
              maxLength: 1000,
              decoration: const InputDecoration(labelText: 'Review note'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep pending'),
          ),
          TextButton(
            onPressed: () {
              if (note.trim().isNotEmpty) Navigator.pop(context, true);
            },
            child: const Text('Close and retain history'),
          ),
        ],
      ),
    );
    final reason = note.trim();
    if (accepted != true || !mounted) return;
    await work(
      () => app.catalogueImportWork(() async {
        check();
        await cache.atomic(() async {
          final saved = await cache.get(scope, '_meta', 'catalogue_csv_import');
          check();
          if (text.text != reviewedCsv ||
              saved?['csv'] != reviewedCsv ||
              saved?['state'] != 'review_required') {
            throw StateError('The pending import changed. Review it again.');
          }
          await cache.put(scope, 'catalogue_csv_history', app.newId(), {
            'csv': reviewedCsv,
            'review': reviewedStatus,
            'note': reason,
            'closedAt': DateTime.now().toUtc().toIso8601String(),
          });
          check();
          await cache.remove(scope, '_meta', 'catalogue_csv_import');
        });
        final retained = await cache.all(scope, 'catalogue_csv_history');
        check();
        if (!mounted) return;
        setState(() {
          history = retained;
          submitted = false;
          review = null;
          preview = null;
          text.clear();
          status = 'Reviewed import closed. Original CSV and status retained on this device.';
        });
      }),
    );
  }

  Widget statusItems(Json result) => Column(
    children: [
      for (final row in objects(result['items'])) ...[
        ListTile(
          title: Text('${object(row['intent'])['name']} · ${row['status']}'),
          subtitle: Text(
            'Original operation: ${object(row['intent'])['operationId']}\nExpected version: ${object(row['intent'])['expectedVersion'] ?? 'new'} · Current version: ${row['currentVersion'] ?? 'absent'}',
          ),
        ),
        for (final unit in objects(object(row['intent'])['units']))
          ListTile(
            title: Text('${unit['label']} · factor ${unit['factor']}'),
            trailing: Text(money(unit['priceMinor'])),
          ),
      ],
    ],
  );

  @override
  Widget build(BuildContext context) => ControllerPage(
    app: app,
    builder: (context) => Scaffold(
      appBar: AppBar(title: const Text('Import catalogue CSV')),
      body: !active
          ? const PageBody(
              children: [
                Text('Business or access changed. Reopen this screen.'),
              ],
            )
          : PageBody(
              children: [
                const Text(
                  'Import item and unit definitions only. Prices are in paise. Existing items require their current expected_version. Each item needs one unique operation_id shared across its unit rows; keep these IDs unchanged when retrying. Maximum 200 rows.',
                ),
                const SizedBox(height: 16),
                AsyncButton(
                  label: 'Download / share CSV template',
                  onPressed: template,
                ),
                const SizedBox(height: 16),
                if (ready && !submitted && retainedImports.isNotEmpty) ...[
                  const Text(
                    'Unconfirmed CSV retained when access changed. Owner access to the original account and business is now available. Review original operations before deciding whether to retry; nothing is replayed automatically.',
                  ),
                  for (final entry in retainedImports)
                    AsyncButton(
                      label: 'Review retained import',
                      onPressed: () => resumeRetainedImport(entry),
                    ),
                ],
                if (submitted)
                  const Text(
                    'An import is awaiting confirmation. Retry sends the exact saved CSV with the original IDs. Some rows may already be accepted; replay is safe.',
                  ),
                if (!submitted && ready)
                  OutlinedButton.icon(
                    onPressed: () => perform(context, pick),
                    icon: const Icon(Icons.file_open_outlined),
                    label: const Text('Choose CSV file'),
                  ),
                const SizedBox(height: 16),
                TextField(
                  controller: text,
                  enabled: ready && !submitted,
                  minLines: 8,
                  maxLines: 16,
                  decoration: const InputDecoration(
                    labelText: 'Paste UTF-8 CSV',
                  ),
                  onChanged: (_) => setState(() {
                    preview = null;
                    status = null;
                  }),
                ),
                const SizedBox(height: 16),
                if (ready && !submitted)
                  AsyncButton(
                    label: 'Validate and preview rows',
                    onPressed: validate,
                  ),
                if (preview != null) ...[
                  for (final error in preview!['errors'] as List? ?? [])
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text(
                        '$error',
                        style: const TextStyle(color: Colors.red),
                      ),
                    ),
                  for (final item in objects(preview!['items'])) ...[
                    ListTile(
                      title: Text('${item['name']}'),
                      subtitle: Text(
                        '${objects(item['units']).length} units · base ${item['canonicalUnit']} · ${item['expectedVersion'] == null ? 'new item' : 'replace revision ${item['expectedVersion']}'}',
                      ),
                    ),
                    for (final unit in objects(item['units']))
                      ListTile(
                        title: Text(
                          '${unit['label']} · ${unit['factor']} ${item['canonicalUnit']}',
                        ),
                        trailing: Text(money(unit['priceMinor'])),
                      ),
                  ],
                ],
                if (ready &&
                    (submitted ||
                        (preview != null &&
                            (preview!['errors'] as List? ?? []).isEmpty)))
                  AsyncButton(
                    label: submitted
                        ? 'Retry saved import'
                        : 'Import validated catalogue',
                    onPressed: import,
                  ),
                if (submitted) ...[
                  AsyncButton(
                    label: 'Review saved import status',
                    onPressed: reviewImport,
                  ),
                  if (review != null) ...[
                    const Text(
                      'Accepted means the original operation was recorded. Version conflict and not_applied have no matching recorded operation; they do not prove failure of an in-flight request.',
                    ),
                    statusItems(review!),
                    AsyncButton(
                      label: 'Close reviewed import',
                      onPressed: closeImport,
                    ),
                  ],
                ],
                for (final entry in history)
                  ExpansionTile(
                    title: Text('Closed import · ${entry['closedAt']}'),
                    children: [
                      Text('Review note: ${entry['note']}'),
                      statusItems(object(entry['review'])),
                      SelectableText('${entry['csv']}'),
                    ],
                  ),
                if (status != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Text(status!),
                  ),
              ],
            ),
    ),
  );
}
