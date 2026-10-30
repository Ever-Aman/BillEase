import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/core/amount.dart';
import 'package:billease_mobile/preview.dart';

void main() {
  test(
    'editing customer name retains cached GST metadata and version',
    () async {
      final app = await previewController();
      final id = await app.saveCustomer(
        'Buyer',
        '9876543210',
        'Town',
        gstin: '29ABCDE1234F1Z5',
        address: 'Road',
        stateCode: '29',
      );
      final original = (await app.store!.jobs(app.scope)).last.toJson();
      await app.saveCustomer('Renamed', '9876543210', 'Town', id: id);
      final jobs = await app.store!.jobs(app.scope);
      final job = jobs.lastWhere((j) => j.kind == 'customer');
      expect(job.payload['id'], id);
      expect(job.dependencies, contains(original['id']));
      expect(jobs.firstWhere((j) => j.id == original['id']).toJson(), original);
      expect(job.payload['expectedVersion'], 1);
      expect(job.payload['gstin'], '29ABCDE1234F1Z5');
      expect(job.payload['address'], 'Road');
      expect(job.payload['stateCode'], '29');
      app.dispose();
    },
  );

  test(
    'GST bill queues explicit place of supply with stable operation identity',
    () async {
      final app = await previewController();
      final old = app.business!;
      app.business = Business(
        old.id,
        old.name,
        old.role,
        documentMode: 'regular_gst',
      );
      final item = app.items.first;
      final line = DraftLine(
        id: app.newId(),
        item: item,
        unit: item.units.first,
        quantityMilli: 1000,
      );
      await expectLater(
        app.submitBill(app.newId(), [line], null, {'cash': line.total}),
        throwsStateError,
      );
      await app.submitBill(
        app.newId(),
        [line],
        null,
        {'cash': line.total},
        placeOfSupply: '29',
      );
      final jobs = await app.store!.jobs(app.scope);
      final job = jobs.lastWhere((j) => j.kind == 'bill');
      expect(job.payload['placeOfSupply'], '29');
      expect(job.payload['operationId'], job.id);
      app.dispose();
    },
  );
  test('customer legal metadata is queued and cached without changing operation IDs', () async {
    final app = await previewController();
    final id = await app.saveCustomer(
      'Buyer',
      '9876543210',
      'Town',
      gstin: '29abcde1234f1z5',
      address: 'Road',
      stateCode: '29',
    );
    final job = (await app.store!.jobs(app.scope))
        .lastWhere((j) => j.kind == 'customer');
    expect(job.payload['gstin'], '29ABCDE1234F1Z5');
    expect(job.payload['stateCode'], '29');
    expect(job.payload['address'], 'Road');
    expect(job.payload['operationId'], job.id);
    expect(
      (await app.store!.get(app.scope, 'customer', id))!['gstin'],
      '29ABCDE1234F1Z5',
    );
    app.dispose();
  });

  test('business classification survives cache round trip', () {
    final b = Business.fromJson({
      'id': 'b',
      'role': 'owner',
      'documentMode': 'regular_gst',
      'stateCode': '29',
    });
    expect(b.toJson()['documentMode'], 'regular_gst');
    expect(b.toJson()['stateCode'], '29');
    expect(
      Business.fromJson({'id': 'old', 'role': 'owner'})
          .toJson()
          .containsKey('documentMode'),
      false,
    );
  });
  test('catalogue tax metadata survives cache round trip', () {
    final i = Item.fromJson({
      'id': 'i',
      'name': 'Item',
      'canonicalUnit': 'piece',
      'version': 1,
      'units': [],
      'hsn': '1001',
      'gstRateBps': 1250,
      'taxCategory': 'taxable',
    });
    expect(i.toJson()['hsn'], '1001');
    expect(i.toJson()['gstRateBps'], 1250);
    expect(i.toJson()['taxCategory'], 'taxable');
  });
  test('GST rate uses exact decimal percentages', () {
    expect(parseGstRate('12.50'), 1250);
    expect(parseGstRate('0.01'), 1);
    expect(parseGstRate('100'), 10000);
    expect(() => parseGstRate('18.001'), throwsFormatException);
    expect(() => parseGstRate('100.01'), throwsFormatException);
  });
}
