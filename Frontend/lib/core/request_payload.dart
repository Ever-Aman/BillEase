import '../models/models.dart';

// Staff propose quantities. Settlement is an owner decision, never a staff field.
Json staffPayload(String type, Json input) {
  switch (type) {
    case 'return':
      return {
        for (final key in ['lineId', 'unitId', 'quantityMilli', 'disposition'])
          if (input.containsKey(key)) key: input[key],
      };
    case 'bill_cancel':
      return {
        if (input['lines'] != null)
          'lines': objects(input['lines'])
              .map(
                (line) => {
                  for (final key in ['lineId', 'unitId', 'quantityMilli'])
                    if (line.containsKey(key)) key: line[key],
                },
              )
              .toList(),
      };
    case 'delivery_correct':
      return {};
    default:
      throw StateError('Unknown staff request type');
  }
}

Json settlementAction(String resolution, {String? method}) {
  if (!['advance', 'refund'].contains(resolution)) {
    throw StateError('Choose the whole remainder as advance or refund');
  }
  if (resolution == 'refund' && !['cash', 'upi', 'bank'].contains(method)) {
    throw StateError('Choose a refund method');
  }
  return {
    'resolution': resolution,
    if (resolution == 'refund') 'refundMethod': method,
  };
}
