import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/preview.dart';
import 'package:billease_mobile/models/models.dart';

void main() {
  test(
    'bill and dependent delivery are queued with original unit prices',
    () async {
      final app = await previewController();
      final item = app.items.firstWhere((i) => i.id == 'cement');
      final line = DraftLine(
        id: app.newId(),
        item: item,
        unit: item.units.first,
        quantityMilli: 1000,
      );
      final id = app.newId();
      await app.saveDraft(id, {
        'id': id,
        'lines': [line.toJson()],
      });
      await app.submitBill(id, [line], null, {'cash': 78000});
      expect(await app.draft(id), isNull);
      var bill = await app.bill(id);
      expect(billHeader(bill)['invoice_number'], isNull);
      expect(billHeader(bill)['total_minor'], '78000');
      await app.recordDelivery(
        bill,
        objects(bill['lines']).single,
        item.units[1],
        1000,
      );
      final jobs = await app.store!.jobs(app.scope);
      final sale = jobs.singleWhere((j) => j.kind == 'bill');
      final delivery = jobs.singleWhere((j) => j.kind == 'delivery');
      expect(delivery.dependencies, [sale.id]);
      expect(delivery.payload['unitId'], 'cement-kg');
      expect(
        await app.pendingDelivered(bill, line.id),
        BigInt.from(1000000000),
      );
      await expectLater(
        app.recordDelivery(
          bill,
          objects(bill['lines']).single,
          item.units.first,
          1000,
        ),
        throwsStateError,
      );
      app.dispose();
    },
  );
}
