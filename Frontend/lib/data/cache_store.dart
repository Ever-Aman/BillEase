import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../core/canonical.dart';
import '../models/models.dart';
import 'app_database.dart';

abstract class CacheStore {
  Future<List<Json>> all(String scope, String kind);
  Future<Json?> get(String scope, String kind, String id);
  Future<void> put(String scope, String kind, String id, Json value);
  Future<void> remove(String scope, String kind, String id);
  Future<void> purgeScope(String scope);
  Future<void> replaceUnits(String scope, Json item);
  Future<Json?> unit(String scope, String id);
  Future<List<OutboxJob>> jobs(String scope);
  Future<void> saveJob(OutboxJob job);
  Future<T> atomic<T>(Future<T> Function() action);
  Future<void> close();

  // This reserved journal keeps unconfirmed intent under its original identity
  // after revocation. Normal catalogue/history selectors never read it; only an
  // explicit original-owner action restores it for review, without replay/upload.
  // Production storage is encrypted.
  static const retainedCatalogueCsvKind = '_retained_catalogue_csv';
  Future<void> _retainPendingCatalogueImport(String scope) async {
    final pending = await get(scope, '_meta', 'catalogue_csv_import');
    if (pending == null) return;
    final retainedId = const Uuid().v4();
    await put(scope, retainedCatalogueCsvKind, retainedId, {
      'id': retainedId,
      'originalJournal': pending,
      'originalScope': scope,
      'retainedAt': DateTime.now().toUtc().toIso8601String(),
      'recoveryState': 'retained_on_device_not_uploaded',
      'guidance': 'Keep this encrypted device data. CSV recovery upload is not supported. Sign in with the original account after owner access is restored, then open catalogue import and choose Review retained import. Do not recreate operation IDs or assume unconfirmed items failed.',
    });
  }

  Future<String> cursor(String scope) async =>
      '${(await get(scope, '_meta', 'cursor'))?['value'] ?? '0'}';
  Future<String?> notice(String scope) async =>
      (await get(scope, '_meta', 'notice'))?['value'] as String?;
  Future<void> clearNotice(String scope) => remove(scope, '_meta', 'notice');
  Future<void> enqueue(
    OutboxJob job, {
    String? localKind,
    String? localId,
    Json? localData,
  }) => atomic(() async {
    final old = (await jobs(job.scope))
        .where((x) => x.id == job.id)
        .firstOrNull;
    if (old != null) {
      if (_intent(old) != _intent(job)) {
        throw StateError('A submitted operation cannot change');
      }
      return;
    }
    await saveJob(job);
    if (localKind != null && localId != null && localData != null) {
      await put(job.scope, localKind, localId, localData);
    }
  });
  Future<void> updateJob(OutboxJob job) async {
    final old = (await jobs(job.scope))
        .where((x) => x.id == job.id)
        .firstOrNull;
    if (old == null || _intent(old) != _intent(job)) {
      throw StateError('Outbox intent is immutable');
    }
    await saveJob(job);
  }

  static String _intent(OutboxJob job) => canonicalJson({
    'method': job.method,
    'path': job.path,
    'kind': job.kind,
    'payload': job.payload,
    'dependencies': job.dependencies,
  });
  static void _staffSafe(Object? value) {
    const forbidden = {
      'total_minor',
      'unit_price_minor',
      'price_minor',
      'payments',
      'debt_minor',
      'advance_minor',
      'debtMinor',
      'advanceMinor',
      'customer_balance',
      'balance_snapshot',
    };
    if (value is Map) {
      if (value.keys.any(forbidden.contains)) {
        throw StateError('Owner data refused by staff cache');
      }
      for (final child in value.values) {
        _staffSafe(child);
      }
    } else if (value is List) {
      for (final child in value) {
        _staffSafe(child);
      }
    }
  }

  Future<void> applyPage(String scope, String role, Json page) =>
      atomic(() async {
        final next = '${page['nextCursor']}';
        if (!RegExp(r'^\d+$').hasMatch(next) ||
            BigInt.parse(next) < BigInt.parse(await cursor(scope))) {
          throw StateError('Invalid sync cursor');
        }
        final changed = <String>[];
        for (final change in objects(page['changes'])) {
          final kind = '${change['kind']}', data = object(change['data']);
          if (role != 'owner') {
            if (kind == 'customer_balance' || kind == 'quotation') {
              throw StateError('Owner-only projection refused');
            }
            if (kind == 'bill' || kind == 'customer') _staffSafe(data);
          }
          if (kind == 'catalogue.item') {
            final id = '${data['id']}',
                previous = await get(scope, 'catalogue', id);
            await put(
              scope,
              'catalogue_revision',
              '$id/${data['version']}',
              data,
            );
            if (previous == null ||
                integer(data['version']) >= integer(previous['version'])) {
              if (previous != null &&
                  canonicalJson(previous) != canonicalJson(data)) {
                changed.add('${data['name']}');
              }
              await put(scope, 'catalogue', id, data);
              await replaceUnits(scope, data);
            }
          } else if (kind == 'customer') {
            await put(scope, 'customer', '${data['id']}', data);
          } else if (kind == 'bill') {
            await put(scope, 'bill', '${object(data['bill'])['id']}', data);
          } else if (kind == 'customer_balance') {
            await put(scope, 'balance', '${data['customerId']}', data);
          } else if (kind == 'quotation') {
            await put(
              scope,
              'quotation',
              '${object(data['quotation'])['id']}',
              data,
            );
          } else {
            throw StateError('Unsupported sync record: $kind');
          }
        }
        await put(scope, '_meta', 'cursor', {'value': next});
        await put(scope, '_meta', 'lastSync', {
          'value': DateTime.now().toUtc().toIso8601String(),
        });
        if (changed.isNotEmpty) {
          await put(scope, '_meta', 'notice', {
            'value': 'Updated on this phone: ${changed.toSet().join(', ')}',
          });
        }
      });
}

class DriftStore extends CacheStore {
  final AppDatabase database;
  DriftStore(this.database);
  @override
  Future<List<Json>> all(String scope, String kind) async =>
      (await database
              .customSelect(
                'SELECT payload FROM cache_entries WHERE scope=? AND kind=? ORDER BY id',
                variables: [
                  Variable.withString(scope),
                  Variable.withString(kind),
                ],
              )
              .get())
          .map((x) => object(jsonDecode(x.read<String>('payload'))))
          .toList();
  @override
  Future<Json?> get(String scope, String kind, String id) async {
    final row = await database
        .customSelect(
          'SELECT payload FROM cache_entries WHERE scope=? AND kind=? AND id=?',
          variables: [
            Variable.withString(scope),
            Variable.withString(kind),
            Variable.withString(id),
          ],
        )
        .getSingleOrNull();
    return row == null ? null : object(jsonDecode(row.read<String>('payload')));
  }

  @override
  Future<void> put(String scope, String kind, String id, Json value) =>
      database.customStatement(
        'INSERT INTO cache_entries(scope,kind,id,payload) VALUES(?,?,?,?) ON CONFLICT(scope,kind,id) DO UPDATE SET payload=excluded.payload',
        [scope, kind, id, jsonEncode(value)],
      );
  @override
  Future<void> remove(String scope, String kind, String id) =>
      database.customStatement(
        'DELETE FROM cache_entries WHERE scope=? AND kind=? AND id=?',
        [scope, kind, id],
      );
  @override
  Future<void> purgeScope(String scope) => atomic(() async {
    await _retainPendingCatalogueImport(scope);
    await database.customStatement(
      'DELETE FROM cache_entries WHERE scope=? AND kind<>?',
      [scope, CacheStore.retainedCatalogueCsvKind],
    );
    await database.customStatement(
      'DELETE FROM catalogue_units WHERE scope=?',
      [scope],
    );
  });
  @override
  Future<void> replaceUnits(String scope, Json item) async {
    await database.customStatement(
      'DELETE FROM catalogue_units WHERE scope=? AND item_id=?',
      [scope, item['id']],
    );
    for (final unit in objects(item['units'])) {
      await database.customStatement(
        'INSERT INTO catalogue_units(scope,id,item_id,label,factor,price_minor,active) VALUES(?,?,?,?,?,?,?)',
        [
          scope,
          unit['id'],
          item['id'],
          unit['label'],
          '${unit['factor']}',
          '${unit['priceMinor']}',
          unit['active'] == false ? 0 : 1,
        ],
      );
    }
  }

  @override
  Future<Json?> unit(String scope, String id) async {
    final row = await database
        .customSelect(
          'SELECT * FROM catalogue_units WHERE scope=? AND id=?',
          variables: [Variable.withString(scope), Variable.withString(id)],
        )
        .getSingleOrNull();
    if (row == null) return null;
    return {
      'id': row.data['id'],
      'factor': row.data['factor'],
      'priceMinor': row.data['price_minor'],
      'label': row.data['label'],
      'active': row.data['active'] == 1,
    };
  }

  @override
  Future<List<OutboxJob>> jobs(String scope) async =>
      (await database
              .customSelect(
                'SELECT record FROM outbox WHERE scope=? ORDER BY rowid',
                variables: [Variable.withString(scope)],
              )
              .get())
          .map(
            (x) => OutboxJob.fromJson(
              object(jsonDecode(x.read<String>('record'))),
            ),
          )
          .toList();
  @override
  Future<void> saveJob(OutboxJob job) => database.customStatement(
    'INSERT INTO outbox(scope,id,intent,record) VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET record=excluded.record',
    [job.scope, job.id, CacheStore._intent(job), jsonEncode(job.toJson())],
  );
  @override
  Future<T> atomic<T>(Future<T> Function() action) =>
      database.transaction(action);
  @override
  Future<void> close() => database.close();
}

// Only UI_PREVIEW uses this store. Production never falls back to plaintext.
class MemoryStore extends CacheStore {
  Map<String, Json> _entries = {}, _units = {};
  Map<String, OutboxJob> _jobs = {};
  String _key(String scope, String kind, String id) => '$scope|$kind|$id';
  Json _clone(Json j) => object(jsonDecode(jsonEncode(j)));
  @override
  Future<List<Json>> all(String scope, String kind) async => _entries.entries
      .where((x) => x.key.startsWith('$scope|$kind|'))
      .map((x) => _clone(x.value))
      .toList();
  @override
  Future<Json?> get(String scope, String kind, String id) async {
    final value = _entries[_key(scope, kind, id)];
    return value == null ? null : _clone(value);
  }

  @override
  Future<void> put(String scope, String kind, String id, Json value) async =>
      _entries[_key(scope, kind, id)] = _clone(value);
  @override
  Future<void> remove(String scope, String kind, String id) async =>
      _entries.remove(_key(scope, kind, id));
  @override
  Future<void> purgeScope(String scope) => atomic(() async {
    await _retainPendingCatalogueImport(scope);
    _entries.removeWhere(
      (k, _) =>
          k.startsWith('$scope|') &&
          !k.startsWith('$scope|${CacheStore.retainedCatalogueCsvKind}|'),
    );
    _units.removeWhere((k, _) => k.startsWith('$scope|'));
  });

  @override
  Future<void> replaceUnits(String scope, Json item) async {
    _units.removeWhere(
      (k, v) => k.startsWith('$scope|') && v['itemId'] == item['id'],
    );
    for (final u in objects(item['units'])) {
      _units['$scope|${u['id']}'] = {...u, 'itemId': item['id']};
    }
  }

  @override
  Future<Json?> unit(String scope, String id) async => _units['$scope|$id'];
  @override
  Future<List<OutboxJob>> jobs(String scope) async => _jobs.values
      .where((x) => x.scope == scope)
      .map((x) => OutboxJob.fromJson(x.toJson()))
      .toList();
  @override
  Future<void> saveJob(OutboxJob job) async => _jobs['${job.scope}|${job.id}'] =
      OutboxJob.fromJson(_clone(job.toJson()));
  @override
  Future<T> atomic<T>(Future<T> Function() action) async {
    final entries = Map<String, Json>.from(_entries),
        units = Map<String, Json>.from(_units),
        jobs = Map<String, OutboxJob>.from(_jobs);
    try {
      return await action();
    } catch (_) {
      _entries = entries;
      _units = units;
      _jobs = jobs;
      rethrow;
    }
  }

  @override
  Future<void> close() async {}
}
