import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/services/feature_rules.dart';

void main() {
  test(
    'quotation tax revision changes are visible even when price is unchanged',
    () {
      expect(
        quotationCopyWarnings([
          {
            'catalogueChanged': true,
            'priceChanged': false,
            'catalogueAvailable': true,
            'itemName': 'Item',
          },
        ]).single,
        contains('current tax'),
      );
    },
  );

  test(
    'partial cancellation uses exact saved conversion and pending limit',
    () {
      expect(cancellationQuantity('0.125', '8', '1', BigInt.zero), 125);
      expect(
        () => cancellationQuantity('0.126', '8', '1', BigInt.zero),
        throwsStateError,
      );
      expect(
        () => cancellationQuantity('0.1', '8', '1', BigInt.from(300000000)),
        throwsStateError,
      );
      expect(
        () => cancellationQuantity('0', '8', '1', BigInt.zero),
        throwsFormatException,
      );
    },
  );
  test('custom report range uses India midnight boundaries independent of device zone', () {
    final period = reportPeriod(DateTime(2026, 10, 1), DateTime(2026, 10, 29));
    expect(period['from'], '2026-09-30T18:30:00.000Z');
    expect(period['to'], '2026-10-29T18:30:00.000Z');
  });
  test(
    'quotation copy keeps saved price, quantity, unit conversion and version',
    () {
      final line = quotationDraftLine(
        'draft-line',
        {
          'itemName': 'Rice',
          'unitId': 'bag',
          'quantityMilli': 2500,
          'overridePriceMinor': 12345,
        },
        {
          'id': 'rice',
          'name': 'Rice',
          'canonicalUnit': 'kg',
          'version': 7,
          'units': [
            {
              'id': 'bag',
              'label': 'bag',
              'factor': '25',
              'priceMinor': '15000',
            },
          ],
        },
      );
      expect(line.priceMinor, 12345);
      expect(line.quantityMilli, 2500);
      expect(line.unit.factor, '25');
      expect(line.item.version, 7);
      expect(line.toJson()['priceMinor'], 12345);
    },
  );
  test(
    'quotation copy exposes saved-price and unavailable catalogue changes',
    () {
      expect(
        quotationCopyWarnings([
          {
            'itemName': 'Rice',
            'overridePriceMinor': 12345,
            'currentPriceMinor': 15000,
            'priceChanged': true,
            'catalogueAvailable': false,
          },
        ]),
        [
          contains('quoted price ₹123.45; current catalogue price ₹150.00'),
          contains('catalogue item or unit is unavailable'),
        ],
      );
    },
  );
}
