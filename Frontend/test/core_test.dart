import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:billease_mobile/core/amount.dart';
import 'package:billease_mobile/data/cache_store.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/services/api_client.dart';
import 'package:billease_mobile/services/session_service.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/services/sync_service.dart';

void main() {
  test(
    'money stays exact at large values and rounds fractional quantities once',
    () {
      expect(parseAmount('90,071,992,547,409.91'), maximumMinor);
      expect(amountInput(maximumMinor), '90071992547409.91');
      expect(lineAmount(101, 500), 51);
      expect(money(123456789), '₹12,34,567.89');
      expect(() => parseAmount('1.001'), throwsFormatException);
      expect(() => parseAmount('90071992547409.92'), throwsFormatException);
      expect(parseQuantity('0.001'), 1);
      expect(() => parseQuantity('0'), throwsFormatException);
    },
  );
  test('conflicting upload does not prevent independent work or catalogue row refresh', () async {
    final store = MemoryStore();
    const business = Business('b', 'Test', 'owner');
    const scope = 'u/b/owner';
    await store.enqueue(
      OutboxJob(
        id: 'first',
        scope: scope,
        method: 'POST',
        path: '/bills',
        kind: 'bill',
        payload: {'id': 'bad'},
      ),
    );
    await store.enqueue(
      OutboxJob(
        id: 'second',
        scope: scope,
        method: 'POST',
        path: '/repayments',
        kind: 'payment',
        payload: {'amountMinor': 100},
      ),
    );
    final seen = <String>[];
    final api = ApiClient(
      'https://example.test',
      transport: MockClient((request) async {
        seen.add(request.url.path);
        if (request.url.path.endsWith('/bills')) {
          return http.Response('{"error":"Version conflict"}', 409);
        }
        if (request.url.path.endsWith('/repayments')) {
          return http.Response('{}', 201);
        }
        if (request.url.path.endsWith('/requests')) {
          return http.Response('{"requests":[]}', 200);
        }
        return http.Response(
          jsonEncode({
            'nextCursor': '1',
            'changes': [
              {
                'kind': 'catalogue.item',
                'data': {
                  'id': 'i',
                  'name': 'Cement',
                  'version': 2,
                  'canonicalUnit': 'kg',
                  'units': [
                    {
                      'id': 'unit',
                      'label': 'kg',
                      'factor': '1',
                      'priceMinor': '1200',
                    },
                  ],
                },
              },
            ],
          }),
          200,
        );
      }),
    );
    await SyncService(store, api).sync(scope, business);
    final jobs = await store.jobs(scope);
    expect(jobs.firstWhere((j) => j.id == 'first').status, 'review_required');
    expect(jobs.firstWhere((j) => j.id == 'second').status, 'done');
    expect((await store.unit(scope, 'unit'))!['priceMinor'], '1200');
    expect(await store.cursor(scope), '1');
    expect(seen, contains('/v1/businesses/b/repayments'));
    api.close();
  });
  test('session lease refuses expired access and clock rollback', () async {
    final vault = MemoryVault(), api = ApiClient('https://example.test');
    final session = SessionService(vault, api);
    final now = DateTime.now().toUtc();
    SessionData data(DateTime end) => SessionData(
      userId: 'u',
      email: 'a@b.test',
      access: 'a',
      refresh: 'r',
      expires: now,
      offlineExpires: end,
      businesses: [],
    );
    session.data = data(now.add(const Duration(days: 1)));
    expect(await session.leaseValid(), isTrue);
    await vault.write(
      'lastObserved',
      now.add(const Duration(hours: 1)).toIso8601String(),
    );
    expect(await session.leaseValid(), isFalse);
    await vault.delete('lastObserved');
    session.data = data(now.subtract(const Duration(seconds: 1)));
    expect(await session.leaseValid(), isFalse);
    api.close();
  });
}
