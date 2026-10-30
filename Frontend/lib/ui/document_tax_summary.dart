import 'package:flutter/material.dart';

import '../core/amount.dart';
import '../models/models.dart';

// Only display the issued document snapshot; catalogue edits never recalculate it.
class DocumentTaxSummary extends StatelessWidget {
  final Json snapshot;
  const DocumentTaxSummary({super.key, required this.snapshot});
  @override
  Widget build(BuildContext context) {
    final tax = object(snapshot['tax']);
    if (tax.isEmpty) return const SizedBox.shrink();
    final supply = tax['documentType'] == 'bill_of_supply';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          supply
              ? 'Bill of Supply'
              : tax['documentType'] == 'invoice_cum_bill_of_supply'
              ? 'Invoice-cum-Bill of Supply'
              : 'Tax Invoice',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        Text('Place of supply: ${tax['placeOfSupply']}'),
        for (final line in objects(tax['lines']))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('HSN ${line['hsn']}'),
                if (!supply) ...[
                  Text('Taxable value: ${money(line['taxableMinor'])}'),
                  if (tax['taxType'] == 'intra') ...[
                    Text(
                      'CGST ${_percent(line['cgstRateBps'])}%: ${money(line['cgstMinor'])}',
                    ),
                    Text(
                      'SGST ${_percent(line['sgstRateBps'])}%: ${money(line['sgstMinor'])}',
                    ),
                  ],
                  if (tax['taxType'] == 'inter')
                    Text(
                      'IGST ${_percent(line['igstRateBps'])}%: ${money(line['igstMinor'])}',
                    ),
                ],
              ],
            ),
          ),
        const SizedBox(height: 12),
      ],
    );
  }
}

String _percent(Object? rate) {
  final parts = '${rate ?? 0}'.split('.');
  final fraction = parts.length > 1 ? parts[1] : '';
  final scale = fraction.length + 2;
  final digits = '${parts[0]}$fraction'.padLeft(scale + 1, '0');
  final whole = BigInt.parse(digits.substring(0, digits.length - scale))
      .toString();
  final decimal = digits
      .substring(digits.length - scale)
      .replaceFirst(RegExp(r'0+$'), '');
  return decimal.isEmpty ? whole : '$whole.$decimal';
}
