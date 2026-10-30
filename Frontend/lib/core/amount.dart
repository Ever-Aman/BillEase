const maximumMinor = 9007199254740991;

int parseAmount(String input, {bool allowZero = true}) {
  final value = input.trim().replaceAll(',', '');
  if (!RegExp(r'^\d{1,14}(\.\d{1,2})?$').hasMatch(value)) {
    throw const FormatException('Enter rupees with up to two decimal places');
  }
  final pieces = value.split('.');
  final minor =
      BigInt.parse(pieces.first) * BigInt.from(100) +
      BigInt.parse(pieces.length == 2 ? pieces[1].padRight(2, '0') : '0');
  if (minor > BigInt.from(maximumMinor) ||
      (!allowZero && minor == BigInt.zero)) {
    throw const FormatException('Amount is outside the supported range');
  }
  return minor.toInt();
}

int parseQuantity(String input) {
  final value = input.trim();
  if (!RegExp(r'^\d{1,6}(\.\d{1,3})?$').hasMatch(value)) {
    throw const FormatException(
      'Use a quantity with up to three decimal places',
    );
  }
  final parts = value.split('.');
  final milli =
      int.parse(parts.first) * 1000 +
      int.parse(parts.length == 2 ? parts[1].padRight(3, '0') : '0');
  if (milli <= 0 || milli > 100000000) {
    throw const FormatException('Quantity must be between 0.001 and 100,000');
  }
  return milli;
}

int lineAmount(int priceMinor, int quantityMilli) {
  final value =
      (BigInt.from(priceMinor) * BigInt.from(quantityMilli) +
          BigInt.from(500)) ~/
      BigInt.from(1000);
  if (value > BigInt.from(maximumMinor)) {
    throw const FormatException('Bill amount is too large');
  }
  return value.toInt();
}

String money(Object? value) {
  final n = BigInt.tryParse('$value') ?? BigInt.zero;
  final absolute = n.abs();
  var whole = (absolute ~/ BigInt.from(100)).toString();
  if (whole.length > 3) {
    final end = whole.substring(whole.length - 3);
    var prefix = whole.substring(0, whole.length - 3);
    final groups = <String>[];
    while (prefix.length > 2) {
      groups.insert(0, prefix.substring(prefix.length - 2));
      prefix = prefix.substring(0, prefix.length - 2);
    }
    groups.insert(0, prefix);
    whole = '${groups.join(',')},$end';
  }
  return '${n.isNegative ? '-' : ''}₹$whole.${(absolute % BigInt.from(100)).toString().padLeft(2, '0')}';
}

String quantity(int milli) =>
    (milli / 1000).toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
BigInt nanos(String value) {
  final parts = value.split('.');
  return BigInt.parse(parts.first) * BigInt.from(1000000000) +
      BigInt.parse(
        parts.length > 1 ? parts[1].padRight(9, '0').substring(0, 9) : '0',
      );
}

String canonicalQuantity(BigInt value) {
  final scale = BigInt.from(1000000000);
  final fraction = (value % scale)
      .toString()
      .padLeft(9, '0')
      .replaceFirst(RegExp(r'0+$'), '');
  return '${value ~/ scale}${fraction.isEmpty ? '' : '.$fraction'}';
}

String amountInput(int minor) =>
    "${minor ~/ 100}.${(minor % 100).toString().padLeft(2, '0')}";

// Percentage hundredths are basis points; never parse through double.
int parseGstRate(String input) {
  final value = input.trim();
  if (!RegExp(r'^\d{1,3}(\.\d{1,2})?$').hasMatch(value)) {
    throw const FormatException(
      'Enter GST percent with up to two decimal places',
    );
  }
  final parts = value.split('.');
  final bps =
      int.parse(parts.first) * 100 +
      int.parse(parts.length == 1 ? '0' : parts.last.padRight(2, '0'));
  if (bps > 10000) {
    throw const FormatException('GST percent must be between 0 and 100');
  }
  return bps;
}
