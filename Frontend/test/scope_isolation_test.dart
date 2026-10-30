import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/data/cache_store.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/services/api_client.dart';
import 'package:billease_mobile/services/session_service.dart';
import 'package:billease_mobile/services/secure_vault.dart';

class FailingRecoveryVault extends MemoryVault {
  @override
  Future<void> write(String key, String value) async {
    if (key == 'recovery') throw StateError('Secure storage unavailable');
    await super.write(key, value);
  }
}

void main() {
  test(
    'a late owner report cannot enter a different business or staff cache',
    () async {
      final response = Completer<http.Response>(), started = Completer<void>();
      final api = ApiClient(
        'https://example.test',
        transport: MockClient((request) {
          started.complete();
          return response.future;
        }),
      );
      final app = AppController(vault: MemoryVault(), api: api);
      const a = Business('a', 'A', 'owner'), b = Business('b', 'B', 'staff');
      final now = DateTime.now().toUtc();
      app.session.data = SessionData(
        userId: 'u',
        email: 'u@example.test',
        access: 'a',
        refresh: 'r',
        expires: now.add(const Duration(hours: 1)),
        offlineExpires: now.add(const Duration(days: 7)),
        businesses: [a, b],
      );
      app.store = MemoryStore();
      app.business = a;
      app.unlocked = true;
      final future = app.fetch('/reports/overview', cacheKey: 'overview');
      final assertion = expectLater(future, throwsStateError);
      await started.future;
      app.business = b;
      response.complete(
        http.Response('{"sales":[{"total_minor":"12300"}]}', 200),
      );
      await assertion;
      expect(await app.store!.get(b.scope('u'), '_online', 'overview'), isNull);
      app.dispose();
    },
  );
  test('revocation locks and clears credentials even if saving recovery metadata fails', () async {
    final api = ApiClient(
      'https://example.test',
      transport: MockClient(
        (_) async => http.Response('{"error":"Revoked"}', 401),
      ),
    );
    final app = AppController(vault: FailingRecoveryVault(), api: api);
    const business = Business('a', 'A', 'owner');
    final now = DateTime.now().toUtc();
    app.session.data = SessionData(
      userId: 'u',
      email: 'u@example.test',
      access: 'a',
      refresh: 'r',
      expires: now.subtract(const Duration(minutes: 1)),
      offlineExpires: now.add(const Duration(days: 7)),
      businesses: [business],
    );
    app.store = MemoryStore();
    app.business = business;
    app.unlocked = true;
    await expectLater(app.session.ensureOnline(), throwsStateError);
    expect(app.unlocked, isFalse);
    expect(app.business, isNull);
    expect(app.session.data, isNull);
    app.dispose();
  });
}
