import 'dart:io';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:uuid/uuid.dart';
import 'package:billease_mobile/data/cache_store.dart';
import 'package:billease_mobile/core/request_payload.dart';
import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/services/api_client.dart';
import 'package:billease_mobile/services/session_service.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/services/sync_service.dart';

void main() {
  final env = Platform.environment;
  test(
    'Dart signs in to Node, uploads a bill, pulls safe delivery units and downloads a real PDF',
    () async {
      final api = ApiClient(env['FLUTTER_SMOKE_URL']!);
      final session = SessionService(MemoryVault(), api);
      try {
        await session.signIn(
          env['FLUTTER_SMOKE_OWNER']!,
          env['FLUTTER_SMOKE_PASSWORD']!,
        );
        final business = session.data!.businesses.single;
        expect(business.role, 'owner');
        final scope = business.scope(session.data!.userId),
            store = MemoryStore();
        final sync = SyncService(store, api);
        await sync.sync(scope, business);
        final item = Item.fromJson(
          (await store.all(scope, 'catalogue')).single,
        );
        final customer = (await store.all(scope, 'customer')).single;
        String id() => const Uuid().v4();
        final bill = id(), operation = id();
        final unit = item.units.firstWhere((u) => u.label == 'box');
        final body = {
          'id': bill,
          'customerId': customer['id'],
          'occurrenceAt': DateTime.now().toUtc().toIso8601String(),
          'lines': [
            {
              'id': id(),
              'itemId': item.id,
              'unitId': unit.id,
              'catalogueVersion': item.version,
              'quantityMilli': 1000,
            },
          ],
          'payments': [
            {'id': id(), 'method': 'cash', 'amountMinor': unit.price},
          ],
          'operationId': operation,
        };
        await store.enqueue(
          OutboxJob(
            id: operation,
            scope: scope,
            method: 'POST',
            path: '/bills',
            kind: 'bill',
            payload: body,
          ),
        );
        await sync.sync(scope, business);
        expect((await store.jobs(scope)).single.status, 'done');
        final saved = (await store.all(
          scope,
          'bill',
        )).singleWhere((b) => billId(b) == bill);
        expect(billHeader(saved)['invoice_number'], isNotNull);
        expect(billHeader(saved)['total_minor'], '1000');
        final delivery = object(saved['delivery']);
        expect(objects(objects(delivery['lines']).single['units']).length, 2);
        final bytes = await api.pdf(
          '/businesses/${business.id}/bills/$bill/pdf',
        );
        expect(utf8.decode(bytes.take(4).toList()), '%PDF');
        await session.signOut();
        await session.signIn(
          env['FLUTTER_SMOKE_STAFF']!,
          env['FLUTTER_SMOKE_PASSWORD']!,
        );
        final staffBusiness = session.data!.businesses.single,
            staffStore = MemoryStore();
        await SyncService(
          staffStore,
          api,
        ).sync(staffBusiness.scope(session.data!.userId), staffBusiness);
        final safe = await staffStore.all(
          staffBusiness.scope(session.data!.userId),
          'bill',
        );
        expect(safe, isNotEmpty);
        expect(
          RegExp('total_minor|price_minor|balance|payments')
              .hasMatch(jsonEncode(safe)),
          isFalse,
        );
        expect(
          objects(objects(safe.first['lines']).first['units']),
          isNotEmpty,
        );
        final lineId = objects(saved['lines']).single['id'];
        await api.request(
          'POST',
          '/businesses/${business.id}/delivery',
          body: {
            'id': id(),
            'billId': bill,
            'lineId': lineId,
            'unitId': unit.id,
            'quantityMilli': 1000,
            'occurrenceAt': DateTime.now().toUtc().toIso8601String(),
            'operationId': id(),
          },
        );
        final returnRequest = id(), cancelRequest = id();
        final originalBill = (await store.all(
          scope,
          'bill',
        )).firstWhere((b) => billId(b) != bill);
        await api.request(
          'POST',
          '/businesses/${business.id}/requests',
          body: {
            'id': returnRequest,
            'type': 'return',
            'targetId': bill,
            'reason': 'Staff return',
            'operationId': id(),
            'payload': staffPayload('return', {
              'id': id(),
              'billId': bill,
              'lineId': lineId,
              'unitId': unit.id,
              'quantityMilli': 1000,
              'disposition': 'restockable',
              'resolution': 'refund',
              'reason': 'not forwarded',
            }),
          },
        );
        await api.request(
          'POST',
          '/businesses/${business.id}/requests',
          body: {
            'id': cancelRequest,
            'type': 'bill_cancel',
            'targetId': billId(originalBill),
            'reason': 'Staff cancellation',
            'operationId': id(),
            'payload': staffPayload('bill_cancel', {
              'billId': billId(originalBill),
              'reason': 'not forwarded',
              'resolution': 'refund',
            }),
          },
        );
        await session.signOut();
        await session.signIn(
          env['FLUTTER_SMOKE_OWNER']!,
          env['FLUTTER_SMOKE_PASSWORD']!,
        );
        final app = AppController(vault: MemoryVault(), api: api);
        app.session.data = session.data;
        app.business = business;
        app.store = store;
        app.syncer = SyncService(store, api);
        app.unlocked = true;
        app.lease = true;
        final returned = await app.decideStaffRequest(
          {'id': returnRequest, 'type': 'return'},
          true,
          'Approved return',
          settlement: settlementAction('advance'),
        );
        expect(returned['state'], 'approved');
        final cancelled = await app.decideStaffRequest(
          {'id': cancelRequest, 'type': 'bill_cancel'},
          true,
          'Approved cancellation',
          settlement: settlementAction('advance'),
        );
        expect(cancelled['state'], 'approved');
        final result = await api.request(
          'GET',
          '/businesses/${business.id}/delivery/$bill',
        );
        expect(
          objects(result['lines']).single['returned_canonical'],
          '10.000000000',
        );
        app.dispose();
      } finally {
        api.close();
      }
    },
    skip: env['FLUTTER_SMOKE_URL'] == null
        ? 'Run Backend/scripts/flutter-smoke.mjs for the disposable real HTTP test'
        : false,
  );
}
