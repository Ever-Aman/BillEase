import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/data/app_database.dart';
import 'package:billease_mobile/data/cache_store.dart';
import 'package:billease_mobile/models/models.dart';

void main() {
  test('an interrupted app can reopen encrypted work with the same immutable operation', () async {
    final directory = Directory.systemTemp.createTempSync('billease-outbox-');
    final file = File('${directory.path}/work.db');
    DriftStore open() => DriftStore(
      AppDatabase(
        NativeDatabase(
          file,
          setup: (db) {
            db.execute("PRAGMA key = 'local-test-key'");
          },
        ),
      ),
    );
    try {
      var store = open();
      await store.enqueue(
        OutboxJob(
          id: 'operation',
          scope: 'u/b/owner',
          method: 'POST',
          path: '/repayments',
          kind: 'payment',
          payload: {
            'amountMinor': 120050,
            'customerId': 'customer',
            'operationId': 'operation',
          },
        ),
        localKind: 'local_payment',
        localId: 'operation',
        localData: {'amountMinor': 120050},
      );
      await store.close();
      store = open();
      final job = (await store.jobs('u/b/owner')).single;
      expect(job.id, 'operation');
      expect(job.payload['amountMinor'], 120050);
      expect(
        (await store.get(
          'u/b/owner',
          'local_payment',
          'operation',
        ))!['amountMinor'],
        120050,
      );
      await store.purgeScope('u/b/owner');
      await store.close();
      store = open();
      expect((await store.jobs('u/b/owner')).single.id, 'operation');
      expect(
        await store.get('u/b/owner', 'local_payment', 'operation'),
        isNull,
      );
      await store.close();
    } finally {
      directory.deleteSync(recursive: true);
    }
  });
}
