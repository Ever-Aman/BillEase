import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/data/app_database.dart';
import 'package:billease_mobile/data/cache_store.dart';
import 'package:billease_mobile/models/models.dart';

Json item(int version, String price) => {
  'id': 'cement',
  'name': 'White cement',
  'canonicalUnit': 'kg',
  'version': version,
  'active': true,
  'units': [
    {
      'id': 'bag',
      'label': 'bag',
      'factor': '25',
      'priceMinor': price,
      'active': true,
    },
  ],
};
Json page(String cursor, String kind, Json data) => {
  'nextCursor': cursor,
  'hasMore': false,
  'changes': [
    {'kind': kind, 'data': data},
  ],
};
void main() {
  late DriftStore store;
  setUp(() => store = DriftStore(AppDatabase(NativeDatabase.memory())));
  tearDown(() => store.close());
  test('a price pull updates the actual unit row and cursor, keeping old bill snapshots', () async {
    const scope = 'user/shop/staff';
    await store.applyPage(
      scope,
      'staff',
      page('1', 'catalogue.item', item(1, '10000')),
    );
    await store.put(scope, 'owned_bill', 'bill', {
      'bill': {'id': 'bill', 'total_minor': '10000'},
      'lines': [
        {'unit_price_minor': '10000'},
      ],
    });
    await store.applyPage(
      scope,
      'staff',
      page('2', 'catalogue.item', item(2, '12500')),
    );
    expect((await store.unit(scope, 'bag'))!['priceMinor'], '12500');
    expect((await store.all(scope, 'catalogue')).single['version'], 2);
    expect(await store.cursor(scope), '2');
    expect(
      (await store.all(
        scope,
        'owned_bill',
      )).single['lines'][0]['unit_price_minor'],
      '10000',
    );
    expect(await store.notice(scope), contains('White cement'));
  });
  test(
    'staff cache rejects owner data and rolls back the whole page',
    () async {
      const scope = 'user/shop/staff';
      await expectLater(
        store.applyPage(scope, 'staff', {
          'nextCursor': '3',
          'changes': [
            {'kind': 'catalogue.item', 'data': item(1, '10000')},
            {
              'kind': 'bill',
              'data': {
                'bill': {'id': 'other', 'total_minor': '1234'},
                'payments': [],
              },
            },
          ],
        }),
        throwsStateError,
      );
      expect(await store.all(scope, 'catalogue'), isEmpty);
      expect(await store.cursor(scope), '0');
    },
  );
  for (final memory in [false, true]) {
    test(
      'purge retains unconfirmed CSV privately and clears financial caches (${memory ? 'memory' : 'drift'})',
      () async {
        final CacheStore target = memory ? MemoryStore() : store;
        const scope = 'original-user/shop/owner', other = 'new-user/shop/owner';
        final original = {
          'csv': 'item_id,operation_id\noriginal,unchanged\n',
          'state': 'review_required',
        };
        await target.put(scope, '_meta', 'catalogue_csv_import', original);
        await target.put(scope, 'catalogue_csv_history', 'closed', {
          'csv': 'resolved',
        });
        await target.put(scope, 'customer_balance', 'balance', {
          'amountMinor': 10000,
        });
        await target.applyPage(
          scope,
          'owner',
          page('1', 'catalogue.item', item(1, '12500')),
        );
        await target.purgeScope(scope);
        final retained = await target.all(
          scope,
          CacheStore.retainedCatalogueCsvKind,
        );
        expect(retained.single['originalJournal'], original);
        expect(retained.single['originalScope'], scope);
        expect(
          retained.single['recoveryState'],
          'retained_on_device_not_uploaded',
        );
        expect(
          await target.get(scope, '_meta', 'catalogue_csv_import'),
          isNull,
        );
        expect(await target.all(scope, 'catalogue'), isEmpty);
        expect(await target.unit(scope, 'bag'), isNull);
        expect(await target.all(scope, 'customer_balance'), isEmpty);
        expect(await target.all(scope, 'catalogue_csv_history'), isEmpty);
        expect(
          await target.all(other, CacheStore.retainedCatalogueCsvKind),
          isEmpty,
        );
        // Revocation and subsequent sign-out may both purge the old scope.
        await target.purgeScope(scope);
        expect(
          await target.all(scope, CacheStore.retainedCatalogueCsvKind),
          retained,
        );
        if (memory) await target.close();
      },
    );
  }
  test(
    'outbox payloads cannot change and cache purge preserves unsent work',
    () async {
      const scope = 'user/shop/owner';
      final job = OutboxJob(
        id: 'op',
        scope: scope,
        method: 'POST',
        path: '/bills',
        kind: 'bill',
        payload: {'operationId': 'op', 'value': 10},
      );
      await store.enqueue(
        job,
        localKind: 'owned_bill',
        localId: 'bill',
        localData: {
          'bill': {'id': 'bill'},
        },
      );
      await expectLater(
        store.enqueue(
          OutboxJob(
            id: 'op',
            scope: scope,
            method: 'POST',
            path: '/bills',
            kind: 'bill',
            payload: {'operationId': 'op', 'value': 20},
          ),
        ),
        throwsStateError,
      );
      await store.purgeScope(scope);
      expect(await store.all(scope, 'owned_bill'), isEmpty);
      expect((await store.jobs(scope)).single.payload['value'], 10);
    },
  );
}
