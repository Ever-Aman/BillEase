import 'dart:convert';

import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/data/cache_store.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/services/api_client.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/services/session_service.dart';
import 'package:billease_mobile/services/sync_service.dart';
import 'package:billease_mobile/ui/outbox_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const business = Business('b', 'Shop', 'owner');
const savedScope = 'u/b/owner';
const setupError = 'No active invoice document series for this financial year';

OutboxJob bill({String status = 'pending', String? error}) => OutboxJob(
  id: 'original-operation',
  scope: savedScope,
  method: 'POST',
  path: '/bills',
  kind: 'bill',
  payload: {
    'id': 'original-bill',
    'operationId': 'original-operation',
    'lines': [
      {'unitId': 'unit', 'quantityMilli': 1000, 'priceMinor': 100},
    ],
  },
  status: status,
  error: error,
);

AppController controller(ApiClient api) {
  final app = AppController(vault: MemoryVault(), api: api);
  final now = DateTime.now().toUtc();
  app.session.data = SessionData(
    userId: 'u',
    email: 'u@example.test',
    access: 'a',
    refresh: 'r',
    expires: now.add(const Duration(hours: 1)),
    offlineExpires: now.add(const Duration(days: 7)),
    businesses: [business],
  );
  app.store = MemoryStore();
  app.business = business;
  app.unlocked = true;
  app.syncer = SyncService(app.store!, api);
  return app;
}

http.Response pull(http.Request request) {
  if (request.url.path.endsWith('/me/businesses')) {
    return http.Response(
      '{"businesses":[{"id":"b","name":"Shop","role":"owner"}]}',
      200,
    );
  }
  if (request.url.path.endsWith('/requests')) {
    return http.Response('{"requests":[]}', 200);
  }
  return http.Response('{"nextCursor":"0","changes":[]}', 200);
}

void main() {
  test(
    'setup 409 saves the exact reason and ordinary sync leaves it blocked',
    () async {
      var uploads = 0;
      final api = ApiClient(
        'https://example.test',
        transport: MockClient((request) async {
          if (request.method == 'POST') {
            uploads++;
            return http.Response(jsonEncode({'error': setupError}), 409);
          }
          return pull(request);
        }),
      );
      final store = MemoryStore();
      await store.enqueue(bill());
      final syncer = SyncService(store, api);
      await syncer.sync(savedScope, business);
      expect((await store.jobs(savedScope)).single.status, 'rejected');
      expect((await store.jobs(savedScope)).single.error, setupError);
      await syncer.sync(savedScope, business);
      expect(uploads, 1);
      api.close();
    },
  );

  for (final status in ['rejected', 'review_required']) {
    test(
      'explicit $status retry uses persisted payload and operation after setup is fixed',
      () async {
        final submitted = <Json>[];
        final api = ApiClient(
          'https://example.test',
          transport: MockClient((request) async {
            if (request.method == 'POST') {
              submitted.add(object(jsonDecode(request.body)));
              return http.Response('{"invoiceNumber":"INV-1"}', 201);
            }
            return pull(request);
          }),
        );
        final app = controller(api);
        final original = bill(status: status, error: setupError);
        await app.store!.enqueue(original);
        // A stale UI object must never replace the persisted financial intent.
        final stale = OutboxJob.fromJson({
          ...original.toJson(),
          'payload': {'id': 'changed'},
        });
        await app.retryBill(stale);
        expect(submitted.single, original.payload);
        final accepted = (await app.store!.jobs(savedScope)).single;
        expect(accepted.id, original.id);
        expect(accepted.status, 'done');
        app.dispose();
      },
    );
  }

  test('retry does not bypass an actual financial conflict', () async {
    final api = ApiClient(
      'https://example.test',
      transport: MockClient((request) async {
        if (request.method == 'POST') {
          return http.Response(
            '{"error":"Version conflict","outcome":"review_required"}',
            409,
          );
        }
        return pull(request);
      }),
    );
    final app = controller(api);
    final original = bill(status: 'review_required');
    await app.store!.enqueue(original);
    await app.retryBill(original);
    final saved = (await app.store!.jobs(savedScope)).single;
    expect(saved.status, 'review_required');
    expect(saved.error, 'Version conflict');
    expect(saved.payload, original.payload);
    app.dispose();
  });

  test(
    'retry rejects foreign scope, staff access, and already accepted work',
    () async {
      final api = ApiClient(
        'https://example.test',
        transport: MockClient((_) async {
          fail('Rejected retries must not send requests');
        }),
      );
      final app = controller(api);
      final original = bill(status: 'rejected');
      await app.store!.enqueue(original);
      final foreign = OutboxJob.fromJson({
        ...original.toJson(),
        'scope': 'u/other/owner',
      });
      await expectLater(app.retryBill(foreign), throwsStateError);
      app.business = const Business('b', 'Shop', 'staff');
      await expectLater(app.retryBill(original), throwsStateError);
      app.business = business;
      await app.store!.updateJob(original.copy(status: 'done'));
      await expectLater(app.retryBill(original), throwsStateError);
      expect((await app.store!.jobs(savedScope)).single.status, 'done');
      app.dispose();
    },
  );

  testWidgets(
    'outbox exposes server reason, legacy fallback, and owner retry',
    (tester) async {
      final app = controller(ApiClient('https://example.test'));
      app.outbox = [bill(status: 'rejected', error: setupError)];
      await tester.pumpWidget(MaterialApp(home: OutboxScreen(app: app)));
      expect(find.text(setupError), findsOneWidget);
      expect(find.text('Retry original bill'), findsOneWidget);
      app.outbox = [bill(status: 'review_required')];
      await tester.pumpWidget(
        MaterialApp(
          home: OutboxScreen(key: UniqueKey(), app: app),
        ),
      );
      expect(
        find.textContaining('No error details were saved.'),
        findsOneWidget,
      );
      app.business = const Business('b', 'Shop', 'staff');
      await tester.pumpWidget(
        MaterialApp(
          home: OutboxScreen(key: UniqueKey(), app: app),
        ),
      );
      expect(find.text('Retry original bill'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      app.dispose();
    },
  );
}
