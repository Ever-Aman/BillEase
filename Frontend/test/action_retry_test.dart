import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/data/cache_store.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/services/api_client.dart';
import 'package:billease_mobile/services/session_service.dart';
import 'package:billease_mobile/services/secure_vault.dart';

void main() {
  test('lost financial response preserves the intent and retries the identical operation', () async {
    final submitted = <String>[];
    var interrupted = true;
    final api = ApiClient(
      'https://example.test',
      transport: MockClient((request) async {
        if (request.method == 'POST') {
          submitted.add(request.body);
          if (interrupted) {
            interrupted = false;
            throw http.ClientException('Response lost');
          }
          return http.Response('{"id":"accepted"}', 201);
        }
        if (request.url.path.endsWith('/me/businesses')) {
          return http.Response(
            '{"businesses":[{"id":"b","name":"Shop","role":"owner"}]}',
            200,
          );
        }
        if (request.url.path.endsWith('/me')) {
          return http.Response('{"user":{"isAdmin":false}}', 200);
        }
        if (request.url.path.endsWith('/requests')) {
          return http.Response('{"requests":[]}', 200);
        }
        return http.Response('{"nextCursor":"0","changes":[]}', 200);
      }),
    );
    final app = AppController(vault: MemoryVault(), api: api);
    const business = Business('b', 'Shop', 'owner');
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
    app.lease = true;
    // No poll timer or Firebase is started by this unit fixture.
    final body = {
      'id': 'return',
      'operationId': 'original',
      'quantityMilli': 1000,
    };
    await expectLater(
      app.action('/returns', body, refresh: false),
      throwsA(isA<http.ClientException>()),
    );
    var jobs = await app.store!.jobs(app.scope);
    expect(jobs.single.status, 'uncertain');
    await expectLater(
      app.action('/returns', {
        ...body,
        'operationId': 'duplicate',
      }, refresh: false),
      throwsStateError,
    );
    expect(submitted.length, 1);
    // An absent SyncService only affects the optional follow-up pull, not the accepted write.
    await app.retryOnline(jobs.single);
    jobs = await app.store!.jobs(app.scope);
    expect(jobs.single.status, 'done');
    expect(submitted.length, 2);
    expect(jsonDecode(submitted[0]), jsonDecode(submitted[1]));
    app.dispose();
  });
  test(
    'an offline retry cannot clear uncertainty about a previously sent return',
    () async {
      final api = ApiClient(
        'https://example.test',
        transport: MockClient((request) async {
          throw http.ClientException('Connection lost');
        }),
      );
      final app = AppController(vault: MemoryVault(), api: api);
      const business = Business('b', 'Shop', 'owner');
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
      app.lease = true;
      await expectLater(
        app.action('/returns', {
          'id': 'return',
          'operationId': 'original',
        }, refresh: false),
        throwsA(isA<http.ClientException>()),
      );
      final saved = (await app.store!.jobs(app.scope)).single;
      app.session.data = SessionData.fromJson({
        ...app.session.data!.toJson(),
        'expires': now.subtract(const Duration(minutes: 1)).toIso8601String(),
      });
      await expectLater(
        app.retryOnline(saved),
        throwsA(isA<http.ClientException>()),
      );
      expect((await app.store!.jobs(app.scope)).single.status, 'uncertain');
      await expectLater(
        app.action('/returns', {
          'id': 'duplicate',
          'operationId': 'duplicate',
        }, refresh: false),
        throwsStateError,
      );
      app.dispose();
    },
  );
}
