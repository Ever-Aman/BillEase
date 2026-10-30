import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import 'core/config.dart';
import 'core/amount.dart';
import 'core/request_payload.dart';
import 'data/cache_store.dart';
import 'models/models.dart';
import 'platform/open_store.dart';
import 'platform/share_pdf.dart';
import 'services/api_client.dart';
import 'services/local_lock.dart';
import 'services/secure_vault.dart';
import 'services/session_service.dart';
import 'services/sync_service.dart';
import 'services/push_service.dart';
import 'services/device_identity.dart';
import 'services/recovery_payload.dart';

class AppController extends ChangeNotifier {
  final bool preview;
  final SecureVault vault;
  final ApiClient api;
  late final SessionService session;
  late final LocalLock localLock;
  final PushService push = PushService();
  CacheStore? store;
  SyncService? syncer;
  Business? business;
  bool booting = true,
      unlocked = false,
      pinSetup = false,
      syncing = false,
      connected = false,
      lease = false,
      openInbox = false;
  String? error, syncError, notice;
  List<Item> items = [];
  List<Json> customers = [], bills = [], requests = [];
  List<OutboxJob> outbox = [];
  DateTime? lastSync;
  Timer? _idle, _poll;
  Future<void>? _activeSync;
  AppController({this.preview = false, SecureVault? vault, ApiClient? api})
    : vault = vault ?? DeviceVault(),
      api = api ?? ApiClient(AppConfig.apiUrl) {
    session = SessionService(this.vault, this.api);
    localLock = LocalLock(this.vault);
    session.onInvalidated = () async {
      final data = session.data;
      // Known revocation locks the UI before any storage work can fail.
      unlocked = false;
      business = null;
      bills = [];
      customers = [];
      items = [];
      requests = [];
      outbox = [];
      connected = false;
      notifyListeners();
      if (data != null && store != null) {
        await this.vault.write(
          'recovery',
          jsonEncode({
            'email': data.email,
            'userId': data.userId,
            'businesses': data.businesses.map((b) => b.toJson()).toList(),
          }),
        );
        for (final b in data.businesses) {
          await store!.purgeScope(b.scope(data.userId));
        }
      }
      unlocked = false;
      business = null;
      bills = [];
      customers = [];
      items = [];
      connected = false;
      notifyListeners();
    };
  }
  bool get signedIn => session.data != null;
  bool get owner => business?.owner == true;
  String get userId => session.data?.userId ?? '';
  String get scope => business!.scope(userId);
  String get prefix => '/businesses/${business!.id}';
  String newId() => const Uuid().v4();
  int get pendingCount => outbox
      .where((j) => j.status != 'done' && j.status != 'quarantined')
      .length;
  int get approvalCount =>
      requests.where((r) => r['state'] == 'pending').length +
      bills
          .where(
            (b) =>
                billHeader(b)['review_state'] == 'credit_pending' ||
                objects(b['payments']).any(
                  (p) => p['state'] == 'pending' && p['corrected_at'] == null,
                ),
          )
          .length;

  Future<void> boot() async {
    try {
      await session.restore();
    } catch (_) {
      error = 'Secure storage could not be opened. Keep app data intact and try again.';
    } finally {
      booting = false;
      notifyListeners();
    }
  }

  Future<void> signIn(
    String email,
    String password, {
    String? mfa,
    String? recovery,
  }) async {
    error = null;
    if (syncing) {
      throw StateError('Let the current sync finish, then sign in again');
    }
    final previousUser = userId;
    await session.signIn(email, password, mfaCode: mfa, recoveryCode: recovery);
    if (previousUser != userId && store != null) {
      await push.stop();
      await store!.close();
      store = null;
      syncer = null;
      business = null;
      bills = [];
      customers = [];
      items = [];
      requests = [];
      outbox = [];
    }
    pinSetup = !session.data!.owner && !await localLock.hasPin(userId);
    unlocked = !pinSetup;
    if (unlocked) {
      try {
        await openAccount();
      } catch (_) {
        unlocked = false;
        rethrow;
      }
    }
    notifyListeners();
  }

  Future<void> setPin(String pin) async {
    await localLock.setPin(userId, pin);
    pinSetup = false;
    unlocked = true;
    try {
      await openAccount();
    } catch (_) {
      unlocked = false;
      rethrow;
    }
    notifyListeners();
  }

  Future<void> unlock({String? pin}) async {
    final accepted = session.data!.owner
        ? await localLock.deviceUnlock()
        : await localLock.verifyPin(userId, pin ?? '');
    if (!accepted) throw StateError('Unlock was not successful');
    unlocked = true;
    try {
      await openAccount();
    } catch (_) {
      unlocked = false;
      rethrow;
    }
    notifyListeners();
  }

  Future<void> openAccount() async {
    store ??= await openStore(vault, userId);
    syncer ??= SyncService(store!, api);
    lease = await session.leaseValid();
    final selected = await vault.read('selected.$userId');
    business =
        session.data!.businesses.where((b) => b.id == selected).firstOrNull ??
        session.data!.businesses.firstOrNull;
    if (business != null) await reload();
    touch();
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(minutes: 1), (_) {
      if (unlocked && business != null) unawaited(sync());
    });
    if (business != null) unawaited(sync());
    if (session.data!.owner && !preview) {
      unawaited(
        push
            .start(api, session.identity!.id, (data) {
              final membership = session.data?.businesses
                  .where((b) => b.id == data['businessId'] && b.owner)
                  .firstOrNull;
              if (membership == null) return;
              notice = 'Staff work needs your review.';
              if (data['opened'] == true) {
                openInbox = true;
                unawaited(chooseBusiness(membership));
              } else {
                unawaited(sync());
              }
              notifyListeners();
            })
            .catchError((_) {
              /* Token can be registered again after reconnect. */
            }),
      );
    }
  }

  Future<void> chooseBusiness(Business selected) async {
    if (!session.data!.businesses.any(
      (b) => b.id == selected.id && b.role == selected.role,
    )) {
      throw StateError('Business access unavailable');
    }
    business = selected;
    await vault.write('selected.$userId', selected.id);
    await reload();
    notifyListeners();
    if (!syncing) unawaited(sync());
  }

  void touch() {
    if (!unlocked || preview) return;
    _idle?.cancel();
    _idle = Timer(const Duration(minutes: 5), lock);
  }

  void lock() {
    if (!signedIn || preview) return;
    unlocked = false;
    _idle?.cancel();
    notifyListeners();
  }

  Future<void> resume() async {
    if (signedIn) lease = await session.leaseValid();
    if (unlocked && business != null) unawaited(sync());
    notifyListeners();
  }

  Future<void> requireWork() async {
    final before = business == null ? null : scope, db = store;
    if (preview) return;
    if (!unlocked) throw StateError('Unlock this phone first');
    lease = await session.leaseValid();
    if (before != null && db != null) _checkWorkspace(before, db);
    if (!lease) {
      notifyListeners();
      throw StateError(
        'Reconnect to renew this phone’s seven-day access before recording new work. Saved work is kept.',
      );
    }
  }

  Future<void> reload() async {
    if (business == null || store == null || session.data == null) return;
    final s = scope, db = store!, isOwner = owner;
    final localItems =
        (await db.all(
            s,
            'catalogue',
          )).map(Item.fromJson).where((x) => x.active).toList()
          ..sort((a, b) => a.name.compareTo(b.name));
    final localCustomers =
        (await db.all(
            s,
            'customer',
          )).where((x) => x['active'] != false).toList()
          ..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    final remote = await db.all(s, 'bill'), own = await db.all(s, 'owned_bill');
    final combined = {for (final row in remote) billId(row): row};
    for (final row in own) {
      final server = combined[billId(row)];
      if (server == null) {
        combined[billId(row)] = row;
      } else if (!isOwner) {
        combined[billId(row)] = {
          ...row,
          'bill': {...billHeader(row), ...billHeader(server)},
          'delivery': server,
          'localOwned': true,
        };
      }
    }
    final localBills = combined.values.toList()
      ..sort(
        (a, b) => '${billHeader(b)['issued_at'] ?? ''}'.compareTo(
          '${billHeader(a)['issued_at'] ?? ''}',
        ),
      );
    final localRequests = objects(
      (await db.get(s, '_meta', 'requests'))?['rows'],
    );
    final localJobs = await db.jobs(s);
    final syncedAt = DateTime.tryParse(
      '${(await db.get(s, '_meta', 'lastSync'))?['value']}',
    );
    final localNotice = await db.notice(s);
    if (session.data == null ||
        business == null ||
        scope != s ||
        !identical(store, db)) {
      return;
    }
    items = localItems;
    customers = localCustomers;
    bills = localBills;
    requests = localRequests;
    outbox = localJobs;
    lastSync = syncedAt;
    notice = localNotice;
    notifyListeners();
  }

  Future<void> sync() async {
    if (_activeSync != null) return _activeSync;
    final task = _sync();
    _activeSync = task;
    try {
      await task;
    } finally {
      _activeSync = null;
    }
  }

  Future<void> _sync() async {
    if (preview) {
      notice = 'Preview data stays in this browser. Use the Android app to connect to your backend.';
      notifyListeners();
      return;
    }
    if (syncing || business == null || !unlocked || session.data == null) {
      return;
    }
    syncing = true;
    syncError = null;
    notifyListeners();
    final selected = business!, previous = session.data!.businesses;
    try {
      await session.ensureOnline();
      await session.loadMemberships();
      for (final old in previous) {
        if (!session.data!.businesses.any(
          (b) => b.id == old.id && b.role == old.role,
        )) {
          await vault.write(
            'recovery',
            jsonEncode({
              'email': session.data!.email,
              'userId': userId,
              'businesses': previous.map((b) => b.toJson()).toList(),
            }),
          );
          await store!.purgeScope(old.scope(userId));
        }
      }
      if (!session.data!.businesses.any(
        (b) => b.id == selected.id && b.role == selected.role,
      )) {
        business = session.data!.businesses.firstOrNull;
        notice =
            'Business access changed. Unsent work is preserved for recovery.';
      } else {
        final savedScope = selected.scope(userId), db = store!;
        await catalogueImportWork(() async {
          _checkWorkspace(savedScope, db);
          final pendingImport = await db.get(
            savedScope,
            '_meta',
            'catalogue_csv_import',
          );
          if (selected.owner &&
              business?.id == selected.id &&
              pendingImport?['state'] == 'submitted') {
            final originalCsv = pendingImport!['csv'] as String;
            try {
              _checkWorkspace(savedScope, db);
              await catalogueText(
                '/catalogue/import',
                csv: originalCsv,
                expectedScope: savedScope,
              );
              await db.atomic(() async {
                _checkWorkspace(savedScope, db);
                final current = await db.get(
                  savedScope,
                  '_meta',
                  'catalogue_csv_import',
                );
                _checkWorkspace(savedScope, db);
                if (current?['csv'] == originalCsv &&
                    current?['state'] == 'submitted') {
                  await db.remove(savedScope, '_meta', 'catalogue_csv_import');
                }
              });
            } catch (_) {
              syncError = 'Catalogue import remains saved for retry. Open catalogue import to review it.';
            }
          }
        });
        await syncer!.sync(selected.scope(userId), selected);
      }
      lease = await session.leaseValid();
      connected = true;
    } on ApiFailure catch (e) {
      connected = false;
      syncError = e.message;
    } catch (_) {
      connected = false;
      syncError =
          'Could not reach the server. Your saved work is kept on this phone.';
    } finally {
      syncing = false;
      if (session.data != null && business != null) await reload();
      notifyListeners();
    }
  }

  Future<void> acknowledgeNotice() async {
    if (store != null && business != null) await store!.clearNotice(scope);
    notice = null;
    notifyListeners();
  }

  Future<void> saveDraft(String id, Json draft) async {
    await requireWork();
    await store!.put(scope, 'draft', id, draft);
  }

  Future<Json?> draft(String id) => store!.get(scope, 'draft', id);
  Future<void> discardDraft(String id) => store!.remove(scope, 'draft', id);
  Future<String> saveCustomer(
    String name,
    String phone,
    String locality, {
    String? id,
    String? gstin,
    String? address,
    String? stateCode,
  }) async {
    await requireWork();
    final customerId = id ?? newId(), op = newId();
    final db = store!, savedScope = scope;
    final previous = id == null
        ? null
        : await db.get(savedScope, 'customer', id);
    final jobs = id == null ? <OutboxJob>[] : await db.jobs(savedScope);
    _checkWorkspace(savedScope, db);
    gstin ??= previous?['gstin'] as String?;
    address ??= previous?['address'] as String?;
    stateCode ??= previous?['stateCode'] as String?;
    final body = {
      'id': customerId,
      'name': name.trim(),
      'phone': phone.trim(),
      'locality': locality.trim(),
      if (gstin != null && gstin.trim().isNotEmpty)
        'gstin': gstin.trim().toUpperCase(),
      if (address != null && address.trim().isNotEmpty)
        'address': address.trim(),
      if (stateCode != null && stateCode.trim().isNotEmpty)
        'stateCode': stateCode.trim(),
      'expectedVersion': previous?['version'],
      'active': true,
      'operationId': op,
    };
    await db.enqueue(
      OutboxJob(
        id: op,
        scope: savedScope,
        method: 'PUT',
        path: '/customers/$customerId',
        kind: 'customer',
        payload: body,
        dependencies: jobs
            .where(
              (j) =>
                  j.kind == 'customer' &&
                  j.payload['id'] == customerId &&
                  j.status != 'done',
            )
            .map((j) => j.id)
            .toList(),
      ),
      localKind: 'customer',
      localId: customerId,
      localData: {...body, 'version': integer(previous?['version']) + 1},
    );
    await reload();
    if (!preview) unawaited(sync());
    return customerId;
  }

  Future<String> submitBill(
    String id,
    List<DraftLine> lines,
    String? customerId,
    Map<String, int> amounts, {
    String? quotationId,
    String? placeOfSupply,
  }) async {
    await requireWork();
    if (lines.isEmpty) throw StateError('Add at least one item');
    if (['composition', 'regular_gst'].contains(business?.documentMode) &&
        !RegExp(r'^\d{2}$').hasMatch(placeOfSupply ?? '')) {
      throw StateError('Enter the two digit place of supply state code');
    }
    final savedScope = scope, db = store!, actor = userId;
    final total = lines.fold(0, (sum, l) => sum + l.total);
    if (total <= 0 || total > maximumMinor) {
      throw StateError(
        'Bill total must be positive and within the supported range',
      );
    }
    final paid = amounts.values.fold(0, (a, b) => a + b),
        cash = amounts['cash'] ?? 0;
    if ((!owner || customerId == null) && paid > total) {
      throw StateError('Payment cannot exceed the current sale');
    }
    if (customerId == null && cash < total) {
      throw StateError(
        'A walk-in sale needs full confirmed cash. Select a saved customer for credit or digital verification.',
      );
    }
    final occurrence = DateTime.now().toUtc().toIso8601String(), op = newId();
    final payments = [
      for (final p in amounts.entries.where((p) => p.value > 0))
        {'id': newId(), 'method': p.key, 'amountMinor': p.value},
    ];
    final payload = {
      'id': id,
      'customerId': customerId,
      'quotationId': ?quotationId,
      if (placeOfSupply != null && placeOfSupply.isNotEmpty)
        'placeOfSupply': placeOfSupply,
      'occurrenceAt': occurrence,
      'lines': lines.map((l) => l.payload(owner: owner)).toList(),
      'payments': payments,
      'operationId': op,
    };
    final dependencies = (await db.jobs(savedScope))
        .where(
          (j) =>
              j.kind == 'customer' &&
              j.payload['id'] == customerId &&
              j.status != 'done',
        )
        .map((j) => j.id)
        .toList();
    _checkWorkspace(savedScope, db);
    final customer = customers.where((c) => c['id'] == customerId).firstOrNull;
    final local = {
      'bill': {
        'id': id,
        'customer_id': customerId,
        'actor_id': actor,
        'customer_snapshot': customer,
        'issued_at': occurrence,
        'total_minor': '$total',
        'lifecycle': 'local_pending',
        'review_state': !owner && cash < total
            ? 'credit_pending'
            : 'not_required',
      },
      'lines': lines
          .map(
            (l) => {
              'id': l.id,
              'item_id': l.item.id,
              'unit_id': l.unit.id,
              'item_name': l.item.name,
              'unit_label': l.unit.label,
              'factor': l.unit.factor,
              'canonical_unit': l.item.canonicalUnit,
              'quantity_milli': l.quantityMilli,
              'unit_price_minor': '${l.priceMinor}',
              'line_total_minor': '${l.total}',
              'catalogue_version': l.item.version,
              'units': l.item.units.map((u) => u.toJson()).toList(),
            },
          )
          .toList(),
      'payments': payments
          .map(
            (p) => {
              ...p,
              'amount_minor': '${p['amountMinor']}',
              'state': p['method'] == 'cash' ? 'confirmed' : 'pending',
            },
          )
          .toList(),
      'localOwned': true,
    };
    await db.atomic(() async {
      await db.enqueue(
        OutboxJob(
          id: op,
          scope: savedScope,
          method: 'POST',
          path: '/bills',
          kind: 'bill',
          payload: payload,
          dependencies: dependencies,
        ),
        localKind: 'owned_bill',
        localId: id,
        localData: local,
      );
      await db.remove(savedScope, 'draft', id);
    });
    await reload();
    if (!preview) unawaited(sync());
    return id;
  }

  Future<Json> bill(String id) async =>
      bills.firstWhere((b) => billId(b) == id);
  Json delivery(Json bill) =>
      object(bill['delivery'] ?? (bill.containsKey('events') ? bill : null));
  Future<List<Unit>> billUnits(Json bill, Json line) async {
    if (line['units'] != null) {
      return objects(line['units']).map(Unit.fromJson).toList();
    }
    final itemId = line['item_id'];
    if (itemId != null) {
      final revision = await store!.get(
        scope,
        'catalogue_revision',
        '$itemId/${line['catalogue_version']}',
      );
      if (revision != null) return Item.fromJson(revision).units;
    }
    return [
      Unit(
        id: '${line['unit_id'] ?? ''}',
        label: '${line['unit_label']}',
        factor: '${line['factor']}',
        price: integer(line['unit_price_minor']),
      ),
    ];
  }

  Future<void> recordDelivery(
    Json bill,
    Json line,
    Unit unit,
    int milli,
  ) async {
    await requireWork();
    if (unit.id.isEmpty) {
      throw StateError(
        'Reconnect to load the saved delivery units for this bill',
      );
    }
    if (milli <= 0 || milli > 100000000) {
      throw StateError('Invalid delivery quantity');
    }
    final id = newId(),
        op = newId(),
        canonical =
            nanos(unit.factor) * BigInt.from(milli) ~/ BigInt.from(1000);
    final d = delivery(bill), authorization = object(d['authorization']);
    if (billHeader(bill)['lifecycle'] == 'local_pending') {
      final billed =
          nanos('${line['factor']}') *
          BigInt.from(integer(line['quantity_milli'])) ~/
          BigInt.from(1000);
      if (canonical + await pendingDelivered(bill, '${line['id']}') > billed) {
        throw StateError('Delivery exceeds this phone’s saved billed quantity');
      }
    }
    final allowed = objects(authorization['lines'])
        .where((l) => l['lineId'] == line['id'])
        .firstOrNull;
    final extra = await pendingDelivered(bill, '${line['id']}');
    if (allowed != null &&
        canonical >
            nanos('${allowed['permittedAdditionalCanonical']}') - extra) {
      throw StateError(
        'This exceeds the delivery permission saved on this phone. Sync or ask an owner to release credit.',
      );
    }
    if (allowed == null && billHeader(bill)['lifecycle'] != 'local_pending') {
      throw StateError('Sync this bill before recording delivery');
    }
    if (allowed == null &&
        objects(bill['payments']).any((p) => p['state'] == 'pending')) {
      throw StateError(
        'Digital payment needs verification or a synced delivery permission',
      );
    }
    final dependencies = (await store!.jobs(scope))
        .where(
          (j) =>
              j.kind == 'bill' &&
              j.payload['id'] == billId(bill) &&
              j.status != 'done',
        )
        .map((j) => j.id)
        .toList();
    final payload = {
      'id': id,
      'billId': billId(bill),
      'lineId': line['id'],
      'unitId': unit.id,
      'quantityMilli': milli,
      'occurrenceAt': DateTime.now().toUtc().toIso8601String(),
      'operationId': op,
      if (authorization['revision'] != null)
        'authorizationRevision': authorization['revision'],
    };
    await store!.enqueue(
      OutboxJob(
        id: op,
        scope: scope,
        method: 'POST',
        path: '/delivery',
        kind: 'delivery',
        payload: payload,
        dependencies: dependencies,
      ),
      localKind: 'local_delivery',
      localId: id,
      localData: {...payload, 'canonical': canonicalQuantity(canonical)},
    );
    await reload();
    if (!preview) unawaited(sync());
  }

  Future<BigInt> pendingDelivered(Json bill, String lineId) async {
    final known = objects(delivery(bill)['events']).map((e) => e['id']).toSet();
    return (await store!.all(scope, 'local_delivery'))
        .where(
          (e) =>
              e['billId'] == billId(bill) &&
              e['lineId'] == lineId &&
              !known.contains(e['id']),
        )
        .fold<BigInt>(
          BigInt.zero,
          (sum, e) => sum + nanos('${e['canonical']}'),
        );
  }

  Future<void> staffRequest(
    String type,
    String targetId,
    Json payload,
    String reason,
  ) async {
    await requireWork();
    final id = newId(), op = newId();
    final body = {
      'id': id,
      'type': type,
      'targetId': targetId,
      'payload': staffPayload(type, payload),
      'reason': reason,
      'operationId': op,
    };
    await store!.enqueue(
      OutboxJob(
        id: op,
        scope: scope,
        method: 'POST',
        path: '/requests',
        kind: 'request',
        payload: body,
      ),
      localKind: 'local_request',
      localId: id,
      localData: {...body, 'state': 'pending_upload'},
    );
    await reload();
    if (!preview) unawaited(sync());
  }

  Future<Json> decideStaffRequest(
    Json request,
    bool approve,
    String reason, {
    Json? settlement,
  }) async {
    if (approve &&
        ['return', 'bill_cancel'].contains(request['type']) &&
        settlement == null) {
      throw StateError('Choose how to settle the whole remainder');
    }
    return action('/requests/${request['id']}/decision', {
      'id': request['id'],
      'approve': approve,
      'reason': reason,
      'operationId': newId(),
      if (approve && settlement != null) 'action': settlement,
    });
  }

  Future<Json?> balance(String customerId) =>
      store!.get(scope, 'balance', customerId);
  Future<Json> action(
    String path,
    Json body, {
    String method = 'POST',
    bool refresh = true,
  }) async {
    final savedScope = scope, savedStore = store!;
    await requireWork();
    _checkWorkspace(savedScope, savedStore);
    if (!owner) {
      throw StateError('Owner access required');
    }
    if (preview) {
      throw StateError(
        'Preview only. This action is wired to your backend in the Android app.',
      );
    }
    final uncertain = (await savedStore.jobs(savedScope))
        .where(
          (job) =>
              job.kind == 'online_action' &&
              job.path == path &&
              ['uncertain', 'sending_online'].contains(job.status),
        )
        .firstOrNull;
    _checkWorkspace(savedScope, savedStore);
    if (uncertain != null) {
      throw StateError(
        'The previous action has an unconfirmed outcome. Open Saved work & sync and retry that original action first.',
      );
    }
    final operation = '${body['operationId'] ?? newId()}';
    final job = OutboxJob(
      id: operation,
      scope: savedScope,
      method: method,
      path: path,
      kind: 'online_action',
      payload: body,
      status: 'sending_online',
    );
    await savedStore.enqueue(job);
    return _sendOnline(job, refresh: refresh);
  }

  Future<Json> retryOnline(OutboxJob job) async {
    await requireWork();
    if (!owner ||
        job.scope != scope ||
        job.kind != 'online_action' ||
        !['uncertain', 'sending_online'].contains(job.status)) {
      throw StateError('This action cannot be retried here');
    }
    return _sendOnline(job, wasUncertain: true);
  }

  Future<Json> _sendOnline(
    OutboxJob job, {
    bool refresh = true,
    bool wasUncertain = false,
  }) async {
    final savedStore = store!;
    _checkWorkspace(job.scope, savedStore);
    final businessId = job.scope.split('/')[1];
    late Json result;
    var dispatched = false;
    try {
      await session.ensureOnline();
      _checkWorkspace(job.scope, savedStore);
      dispatched = true;
      result = await api.request(
        job.method,
        '/businesses/$businessId${job.path}',
        body: job.payload,
      );
      await savedStore.updateJob(job.copy(status: 'done'));
    } catch (error) {
      final definitive =
          !wasUncertain &&
          (!dispatched ||
              (error is ApiFailure &&
                  error.status >= 400 &&
                  error.status < 500));
      await savedStore.updateJob(
        job.copy(
          status: definitive ? 'rejected' : 'uncertain',
          error: friendlyActionError(error),
        ),
      );
      if (business != null &&
          scope == job.scope &&
          identical(store, savedStore)) {
        await reload();
      }
      rethrow;
    }
    _checkWorkspace(job.scope, savedStore);
    connected = true;
    if (refresh) await sync();
    return result;
  }

  String friendlyActionError(Object error) => error is ApiFailure
      ? error.message
      : 'Response interrupted. Retry this saved original action to confirm the result; do not enter it again.';

  void _checkWorkspace(String expectedScope, CacheStore expectedStore) {
    if (session.data == null ||
        business == null ||
        scope != expectedScope ||
        !identical(store, expectedStore)) {
      throw StateError(
        'The workspace changed. Reopen this page in the selected business.',
      );
    }
  }

  Future<Json> fetch(String path, {String? cacheKey}) async {
    final savedScope = scope, savedPrefix = prefix, savedStore = store!;
    if (preview) {
      return (await savedStore.get(savedScope, '_preview', cacheKey ?? path)) ??
          {};
    }
    try {
      await session.ensureOnline();
      _checkWorkspace(savedScope, savedStore);
      final result = await api.request('GET', '$savedPrefix$path');
      _checkWorkspace(savedScope, savedStore);
      if (cacheKey != null) {
        await savedStore.put(savedScope, '_online', cacheKey, {
          'data': result,
          'fetchedAt': DateTime.now().toUtc().toIso8601String(),
        });
      }
      _checkWorkspace(savedScope, savedStore);
      return result;
    } catch (error) {
      // Never return old business data after a scope change or known access denial.
      _checkWorkspace(savedScope, savedStore);
      if (error is ApiFailure && (error.status == 401 || error.status == 403)) {
        await session.onInvalidated?.call();
        await session.clearTokens();
        rethrow;
      }
      if (cacheKey != null) {
        final old = await savedStore.get(savedScope, '_online', cacheKey);
        _checkWorkspace(savedScope, savedStore);
        if (old != null) {
          return {
            ...object(old['data']),
            '_stale': true,
            '_fetchedAt': old['fetchedAt'],
          };
        }
      }
      rethrow;
    }
  }

  Future<void> repayment(String customerId, int amount, String note) async {
    await requireWork();
    if (!owner) throw StateError('Owner access required');
    final op = newId();
    final payload = {
      'customerId': customerId,
      'amountMinor': amount,
      'note': note,
      'occurrenceAt': DateTime.now().toUtc().toIso8601String(),
      'operationId': op,
    };
    await store!.enqueue(
      OutboxJob(
        id: op,
        scope: scope,
        method: 'POST',
        path: '/repayments',
        kind: 'payment',
        payload: payload,
      ),
      localKind: 'local_payment',
      localId: op,
      localData: payload,
    );
    await reload();
    if (!preview) unawaited(sync());
  }

  Future<void> saveItem(Json input) async {
    final id = '${input['id']}';
    final result = await action(
      '/catalogue/items/$id',
      input,
      method: 'PUT',
      refresh: false,
    );
    await store!.applyPage(scope, business!.role, {
      'nextCursor': await store!.cursor(scope),
      'changes': [
        {'kind': 'catalogue.item', 'data': result},
      ],
    });
    await reload();
    unawaited(sync());
  }

  // One queue covers journal mutation and network confirmation for both automatic
  // and manual CSV work, so review/close cannot race an in-flight retry.
  Future<void> _catalogueImportTail = Future<void>.value();
  Future<T> catalogueImportWork<T>(Future<T> Function() action) async {
    final previous = _catalogueImportTail;
    final released = Completer<void>();
    _catalogueImportTail = released.future;
    await previous;
    try {
      return await action();
    } finally {
      released.complete();
    }
  }

  Future<dynamic> catalogueText(
    String path, {
    String? csv,
    String? expectedScope,
  }) async {
    final savedScope = scope, db = store!, base = prefix;
    if (expectedScope != null && savedScope != expectedScope) {
      throw StateError('Open the original business to resume this import');
    }
    if (!owner) throw StateError('Owner access required');
    if (preview) {
      throw StateError('Connect the Android app to import a catalogue');
    }
    await requireWork();
    await session.ensureOnline();
    _checkWorkspace(savedScope, db);
    if (![
      '/catalogue/import-template',
      '/catalogue/import-preview',
      '/catalogue/import-status',
      '/catalogue/import',
    ].contains(path)) {
      throw StateError('Unknown catalogue operation');
    }
    final response = await api.send(
      csv == null ? 'GET' : 'POST',
      '$base$path',
      rawBody: csv,
      contentType: 'text/csv; charset=utf-8',
    );
    _checkWorkspace(savedScope, db);
    return csv == null ? response.body : object(jsonDecode(response.body));
  }

  Future<void> pdf(
    String id, {
    bool history = false,
    bool payments = false,
    bool priorDebt = false,
    bool quotation = false,
  }) async {
    if (!owner) throw StateError('Only owners can share documents');
    if (preview) {
      throw StateError(
        'Document sharing is available from the connected Android app',
      );
    }
    final path = quotation
        ? '/quotations/$id/pdf'
        : history
        ? '/bills/$id/adjustments/pdf'
        : '/bills/$id/pdf?showPayments=$payments&showPriorDebt=$priorDebt';
    await sharePdf(await api.pdf('$prefix$path'), id);
  }

  Future<int> recover() async {
    final encoded = await vault.read('recovery');
    if (encoded == null) {
      throw StateError('No revoked work is registered on this phone');
    }
    final saved = object(jsonDecode(encoded));
    final db = await openStore(vault, '${saved['userId']}');
    try {
      final identity = await DeviceIdentity.load(vault, '${saved['email']}');
      var count = 0;
      for (final b in objects(saved['businesses']).map(Business.fromJson)) {
        for (final job in (await db.jobs(
          b.scope('${saved['userId']}'),
        )).where((j) => !['done', 'quarantined'].contains(j.status))) {
          if (![
            'customer',
            'online_action',
            'bill',
            'delivery',
            'request',
            'payment',
            'return',
          ].contains(job.kind)) {
            continue;
          }
          final message = {
            'deviceId': identity.id,
            'businessId': b.id,
            'operationId': job.id,
            'payloadType': job.kind,
            'payload': recoveryPayload(job),
            'originalRole': b.role,
            'dependencies': job.dependencies,
          };
          await api.request(
            'POST',
            '/recovery/upload',
            authenticated: false,
            body: {...message, 'signature': await identity.sign(message)},
          );
          await db.updateJob(job.copy(status: 'quarantined'));
          count++;
        }
      }
      return count;
    } finally {
      await db.close();
    }
  }

  Future<void> signOut() async {
    unlocked = false;
    notifyListeners();
    await _activeSync;
    _idle?.cancel();
    _poll?.cancel();
    await push.stop();
    await session.signOut();
    if (store != null) await store!.close();
    store = null;
    syncer = null;
    business = null;
    unlocked = false;
    bills = [];
    customers = [];
    items = [];
    outbox = [];
    requests = [];
    notifyListeners();
  }

  @override
  void dispose() {
    _idle?.cancel();
    _poll?.cancel();
    api.close();
    super.dispose();
  }
}
