import 'package:flutter/material.dart';

import '../models/models.dart';
import '../core/amount.dart';
import '../services/feature_rules.dart';
import 'common.dart';

class CancellationLine {
  final Json line;
  final List<Unit> units;
  final String pending;
  final BigInt localDeliveries;
  const CancellationLine(
    this.line,
    this.units,
    this.pending,
    this.localDeliveries,
  );
}

class CancellationDialog extends StatefulWidget {
  final List<CancellationLine> lines;
  const CancellationDialog({super.key, required this.lines});
  @override
  State<CancellationDialog> createState() => _CancellationDialogState();
}

class _CancellationDialogState extends State<CancellationDialog> {
  final selected = <String>{};
  final units = <String, String>{};
  final quantities = <String, TextEditingController>{};
  final reason = TextEditingController();
  @override
  void initState() {
    super.initState();
    for (final row in widget.lines) {
      final id = '${row.line['id']}';
      units[id] = row.units.first.id;
      quantities[id] = TextEditingController();
    }
  }

  @override
  void dispose() {
    for (final c in quantities.values) {
      c.dispose();
    }
    reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Cancel selected undelivered quantities'),
    content: SizedBox(
      width: 460,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Choose saved bill units and quantities. Local handovers reduce the available amount; the server checks concurrent changes again.',
            ),
            for (final row in widget.lines) ...[
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  '${row.line['item_name'] ?? row.line['itemName'] ?? 'Bill item'}',
                ),
                subtitle: Text(
                  'Remaining ${canonicalQuantity(nanos(row.pending) - row.localDeliveries)} base units',
                ),
                value: selected.contains('${row.line['id']}'),
                onChanged: (v) => setState(() {
                  v == true
                      ? selected.add('${row.line['id']}')
                      : selected.remove('${row.line['id']}');
                }),
              ),
              if (selected.contains('${row.line['id']}')) ...[
                DropdownButtonFormField<String>(
                  initialValue: units['${row.line['id']}'],
                  decoration: const InputDecoration(
                    labelText: 'Saved bill unit',
                  ),
                  isExpanded: true,
                  items: row.units
                      .map(
                        (u) => DropdownMenuItem(
                          value: u.id,
                          child: Text('${u.label} (${u.factor} base units)'),
                        ),
                      )
                      .toList(),
                  onChanged: (v) =>
                      setState(() => units['${row.line['id']}'] = v!),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: quantities['${row.line['id']}'],
                  decoration: const InputDecoration(
                    labelText: 'Quantity to cancel',
                  ),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                ),
              ],
            ],
            const SizedBox(height: 16),
            TextField(
              controller: reason,
              maxLength: 500,
              decoration: const InputDecoration(labelText: 'Reason'),
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Back'),
      ),
      FilledButton(
        onPressed: () {
          try {
            if (selected.isEmpty) throw StateError('Select at least one line');
            if (reason.text.trim().isEmpty) throw StateError('Add a reason');
            final lines = <Json>[];
            for (final row in widget.lines.where(
              (r) => selected.contains('${r.line['id']}'),
            )) {
              final id = '${row.line['id']}';
              final unit = row.units.firstWhere((u) => u.id == units[id]);
              lines.add({
                'lineId': id,
                'unitId': unit.id,
                'quantityMilli': cancellationQuantity(
                  quantities[id]!.text,
                  unit.factor,
                  row.pending,
                  row.localDeliveries,
                ),
              });
            }
            Navigator.pop(context, {
              'lines': lines,
              'reason': reason.text.trim(),
            });
          } catch (e) {
            showError(context, e);
          }
        },
        child: const Text('Continue'),
      ),
    ],
  );
}
