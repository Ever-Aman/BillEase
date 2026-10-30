import '../core/amount.dart';
import '../models/models.dart';

int cancellationQuantity(
  String input,
  String savedFactor,
  String pendingCanonical,
  BigInt localDeliveries,
) {
  final milli = parseQuantity(input);
  final canonical =
      nanos(savedFactor) * BigInt.from(milli) ~/ BigInt.from(1000);
  if (canonical <= BigInt.zero ||
      canonical > nanos(pendingCanonical) - localDeliveries) {
    throw StateError(
      'Quantity exceeds the remaining undelivered amount. Sync and check recent handovers.',
    );
  }
  return milli;
}

Map<String, String> reportPeriod(DateTime first, DateTime last) => {
  // Date pickers return device-local calendar dates. Reports are business
  // dates in India, so construct the UTC instants from the fixed +05:30 offset
  // rather than converting through the device's timezone.
  'from': DateTime.utc(
    first.year,
    first.month,
    first.day,
  ).subtract(const Duration(hours: 5, minutes: 30)).toIso8601String(),
  'to': DateTime.utc(
    last.year,
    last.month,
    last.day + 1,
  ).subtract(const Duration(hours: 5, minutes: 30)).toIso8601String(),
};

DraftLine quotationDraftLine(String id, Json quoteLine, Json revision) {
  final item = Item.fromJson(revision);
  final unit = item.units.firstWhere(
    (unit) => unit.id == '${quoteLine['unitId']}',
  );
  return DraftLine(
    id: id,
    item: item,
    unit: unit,
    quantityMilli: integer(quoteLine['quantityMilli']),
    priceMinor: integer(quoteLine['overridePriceMinor']),
  );
}

List<String> quotationCopyWarnings(Iterable<Json> lines) => [
  for (final line in lines)
    if (line['catalogueChanged'] == true)
      '${line['itemName']}: catalogue changed since this quotation; current tax metadata will apply to the new bill. Review before confirming.',
  for (final line in lines)
    if (line['priceChanged'] == true)
      '${line['itemName']}: quoted price ${money(line['overridePriceMinor'])}; current catalogue price ${money(line['currentPriceMinor'])}. The quoted price is retained.',
  for (final line in lines)
    if (line['catalogueAvailable'] != true)
      '${line['itemName']}: this catalogue item or unit is unavailable. The saved quotation details are retained.',
];
