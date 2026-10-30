import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/core/request_payload.dart';

void main() {
  test(
    'staff return proposals exclude owner settlement and operation fields',
    () {
      expect(
        staffPayload('return', {
          'id': 'return',
          'billId': 'bill',
          'lineId': 'line',
          'unitId': 'unit',
          'quantityMilli': 1000,
          'disposition': 'restockable',
          'resolution': 'refund',
          'refundId': 'refund',
          'reason': 'outer reason',
        }),
        {
          'lineId': 'line',
          'unitId': 'unit',
          'quantityMilli': 1000,
          'disposition': 'restockable',
        },
      );
      expect(
        staffPayload('bill_cancel', {
          'billId': 'bill',
          'reason': 'outer reason',
          'resolution': 'refund',
        }),
        isEmpty,
      );
    },
  );
  test(
    'settlement permits the whole remainder and requires a refund method',
    () {
      expect(settlementAction('advance'), {'resolution': 'advance'});
      expect(settlementAction('refund', method: 'cash'), {
        'resolution': 'refund',
        'refundMethod': 'cash',
      });
      expect(() => settlementAction('split'), throwsStateError);
      expect(() => settlementAction('refund'), throwsStateError);
    },
  );
}
