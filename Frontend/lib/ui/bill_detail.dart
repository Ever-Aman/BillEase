import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/amount.dart';
import '../models/models.dart';
import 'common.dart';
import 'document_tax_summary.dart';
import 'cancellation_dialog.dart';

class BillDetail extends StatefulWidget {
  final AppController app;
  final String id;
  const BillDetail({super.key, required this.app, required this.id});
  @override
  State<BillDetail> createState() => _BillDetailState();
}

class _BillDetailState extends State<BillDetail> {
  bool payments = false, debt = false;
  AppController get app => widget.app;
  Future<void> quantityAction(Json bill, Json line, String kind) async {
    final units = await app.billUnits(bill, line);
    if (!mounted) return;
    final result = await showDialog<Json>(
      context: context,
      builder: (_) => QuantityDialog(
        units: units,
        title: kind == 'delivery' ? 'Hand over goods' : 'Record a return',
        returns: kind == 'return',
        chooseSettlement: app.owner,
      ),
    );
    if (result == null || !mounted) return;
    await perform(context, () async {
      if (kind == 'delivery') {
        await app.recordDelivery(
          bill,
          line,
          units.firstWhere((u) => u.id == result['unitId']),
          result['quantityMilli'],
        );
      } else {
        final body = {
          'id': app.newId(),
          'billId': widget.id,
          'lineId': line['id'],
          'unitId': result['unitId'],
          'quantityMilli': result['quantityMilli'],
          'disposition': result['disposition'],
          'resolution': result['resolution'],
          if (result['resolution'] == 'refund') ...{
            'refundId': app.newId(),
            'refundMethod': result['refundMethod'],
          },
          'reason': result['reason'],
        };
        if (app.owner) {
          await app.action('/returns', {...body, 'operationId': app.newId()});
        } else {
          await app.staffRequest(
            'return',
            widget.id,
            body,
            '${result['reason']}',
          );
        }
      }
    });
    if (mounted) setState(() {});
  }

  Future<void> cancelBill(Json bill) async {
    final savedScope = app.scope;
    bool active() =>
        mounted &&
        app.business != null &&
        app.signedIn &&
        app.scope == savedScope;
    final rows = <CancellationLine>[];
    for (final line in objects(bill['lines'])) {
      final saved =
          objects(app.delivery(bill)['lines'])
              .where((l) => l['id'] == line['id'])
              .firstOrNull ??
          line;
      final billed =
          saved['billed_canonical'] ??
          canonicalQuantity(
            nanos('${line['factor'] ?? 1}') *
                BigInt.from(integer(line['quantity_milli'])) ~/
                BigInt.from(1000),
          );
      final pending =
          nanos('$billed') -
          nanos('${saved['delivered_canonical'] ?? 0}') -
          nanos('${saved['cancelled_canonical'] ?? 0}');
      final local = await app.pendingDelivered(bill, '${line['id']}');
      if (!active()) return;
      final units = await app.billUnits(bill, line);
      if (!active()) return;
      if (pending > local && units.isNotEmpty) {
        rows.add(
          CancellationLine(line, units, canonicalQuantity(pending), local),
        );
      }
    }
    if (rows.isEmpty) {
      throw StateError(
        'No undelivered quantities are available to cancel. Sync recent handovers.',
      );
    }
    if (!mounted || !active()) return;
    final values = await showDialog<Json>(
      context: context,
      builder: (_) => CancellationDialog(lines: rows),
    );
    if (values == null || !mounted || !active()) return;
    if (!app.owner) {
      await app.staffRequest('bill_cancel', widget.id, {
        'lines': values['lines'],
      }, '${values['reason']}');
      return;
    }
    final settlement = await chooseSettlement(context);
    if (settlement == null || !active()) return;
    await app.action('/bills/${widget.id}/cancel', {
      'billId': widget.id,
      'lines': values['lines'],
      'reason': values['reason'],
      ...settlement,
      if (settlement['resolution'] == 'refund') 'refundId': app.newId(),
      'operationId': app.newId(),
    });
  }

  Future<void> applyAdvance(Json bill) async {
    final customer = billHeader(bill)['customer_id'];
    final balance = await app.fetch('/customers/$customer/balance');
    if (!mounted) return;
    final values = await fieldsDialog(
      context,
      title: 'Apply customer advance',
      fields: {'Amount in rupees': ''},
      detail:
          'Available advance: ${money(balance['advanceMinor'])}. This pays this bill from the customer’s confirmed advance.',
    );
    if (values == null || !mounted) return;
    await app.action('/advance-applications', {
      'customerId': customer,
      'billId': widget.id,
      'amountMinor': parseAmount(values['Amount in rupees']!, allowZero: false),
      'operationId': app.newId(),
    });
  }

  Future<void> correctDelivery(Json event) async {
    final input = await fieldsDialog(
      context,
      title: app.owner
          ? 'Reverse delivery entry'
          : 'Request delivery correction',
      fields: {'Reason': ''},
      detail: 'This reverses the entire selected handover entry. Record the correct handover separately. Goods already returned cannot be erased.',
    );
    if (input == null || !mounted) return;
    if (app.owner) {
      await app.action('/delivery-corrections', {
        'id': app.newId(),
        'deliveryId': event['id'],
        'reason': input['Reason'],
        'operationId': app.newId(),
      });
    } else {
      await app.staffRequest(
        'delivery_correct',
        '${event['id']}',
        {},
        input['Reason']!,
      );
    }
  }

  Future<void> correctPayment(Json payment) async {
    final input = await fieldsDialog(
      context,
      title: 'Correct payment',
      choices: const {
        'Method (cash, upi or bank)': ['cash', 'upi', 'bank'],
      },
      fields: {
        'Replacement amount in rupees': amountInput(
          integer(payment['amount_minor']),
        ),
        'Method (cash, upi or bank)': '${payment['method']}',
        'Reason': '',
      },
      detail: 'The original entry remains in history. A digital replacement needs verification again.',
    );
    if (input == null || !mounted) return;
    final method = input['Method (cash, upi or bank)'];
    if (!['cash', 'upi', 'bank'].contains(method)) {
      throw StateError('Choose cash, upi or bank');
    }
    await app.action('/payment-corrections', {
      'id': app.newId(),
      'paymentId': payment['id'],
      'reason': input['Reason'],
      'replacement': {
        'id': app.newId(),
        'method': method,
        'amountMinor': parseAmount(
          input['Replacement amount in rupees']!,
          allowZero: false,
        ),
        'occurrenceAt': DateTime.now().toUtc().toIso8601String(),
      },
      'operationId': app.newId(),
    });
  }

  @override
  Widget build(BuildContext context) => ControllerPage(
    app: app,
    builder: (context) {
      final bill = app.bills.where((b) => billId(b) == widget.id).firstOrNull;
      if (bill == null) {
        return Scaffold(
          appBar: AppBar(title: const Text('Bill')),
          body: const PageBody(
            children: [
              EmptyState(
                'Bill unavailable',
                'Sync to check your current access.',
              ),
            ],
          ),
        );
      }
      final header = billHeader(bill),
          delivery = app.delivery(bill),
          accepted = header['invoice_number'] != null;
      final lines = objects(bill['lines']);
      return Scaffold(
        appBar: AppBar(title: Text(billReference(bill))),
        body: PageBody(
          children: [
            Text(
              billCustomer(bill),
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                StatusTag(
                  accepted
                      ? '${header['lifecycle'] ?? 'Issued'}'.toUpperCase()
                      : 'SAVED ON PHONE',
                  attention: !accepted,
                ),
                if (header['review_state'] == 'credit_pending')
                  const StatusTag('CREDIT REVIEW', attention: true),
              ],
            ),
            const SizedBox(height: 24),
            if (header.containsKey('total_minor')) ...[
              Text('Bill total', style: const TextStyle(color: muted)),
              Text(
                money(header['total_minor']),
                style: Theme.of(context).textTheme.headlineLarge,
              ),
              const SizedBox(height: 24),
            ],
            DocumentTaxSummary(snapshot: object(header['document_snapshot'])),
            Text(
              'Items & delivery',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            for (final line in lines) ...[
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${line['item_name']}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${quantity(integer(line['quantity_milli']))} × ${line['unit_label']}${line.containsKey('line_total_minor') ? ' · ${money(line['line_total_minor'])}' : ''}',
                      style: const TextStyle(color: muted),
                    ),
                    const SizedBox(height: 18),
                    DeliveryStrip(app: app, bill: bill, line: line),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        OutlinedButton(
                          onPressed: header['lifecycle'] == 'cancelled'
                              ? null
                              : () => quantityAction(bill, line, 'delivery'),
                          child: const Text('Hand over'),
                        ),
                        TextButton(
                          onPressed: accepted
                              ? () => quantityAction(bill, line, 'return')
                              : null,
                          child: Text(
                            app.owner ? 'Return goods' : 'Request return',
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (objects(bill['payments']).isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Payments', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              Panel(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    for (final payment in objects(bill['payments']))
                      ListTile(
                        title: Text('${payment['method']}'.toUpperCase()),
                        subtitle: Text('${payment['state']}'),
                        trailing: Text(money(payment['amount_minor'])),
                        onTap: app.owner && payment['corrected_at'] == null
                            ? () => perform(
                                context,
                                () => correctPayment(payment),
                              )
                            : null,
                      ),
                  ],
                ),
              ),
            ],
            if (objects(delivery['events']).isNotEmpty) ...[
              const SizedBox(height: 24),
              Text(
                'Delivery history',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              for (final event in objects(delivery['events']))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    '${quantity(integer(event['quantity_milli']))} ${event['unit_label']}',
                  ),
                  subtitle: Text(
                    '${event['state']} · ${event['occurrence_at']}',
                  ),
                  onLongPress: () =>
                      perform(context, () => correctDelivery(event)),
                  trailing: app.owner && event['state'] == 'review_pending'
                      ? TextButton(
                          onPressed: () => perform(context, () async {
                            await app.action(
                              '/delivery/${event['id']}/review',
                              {
                                'id': event['id'],
                                'accept': true,
                                'operationId': app.newId(),
                              },
                            );
                          }),
                          child: const Text('Accept'),
                        )
                      : null,
                ),
            ],
            if (app.owner && accepted && header['customer_id'] != null)
              OutlinedButton(
                onPressed: () => perform(context, () => applyAdvance(bill)),
                child: const Text('Apply customer advance'),
              ),
            if (objects(delivery['events']).isNotEmpty)
              const Text(
                'Long-press a handover entry to correct it or request a correction.',
                style: TextStyle(fontSize: 12, color: muted),
              ),
            if (app.owner && accepted) ...[
              const SizedBox(height: 24),
              Text(
                'Share bill PDF',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Include payments'),
                value: payments,
                onChanged: (v) => setState(() => payments = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Include previous debt'),
                value: debt,
                onChanged: (v) => setState(() => debt = v),
              ),
              AsyncButton(
                label: 'Download & share PDF',
                onPressed: () =>
                    app.pdf(widget.id, payments: payments, priorDebt: debt),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () =>
                    perform(context, () => app.pdf(widget.id, history: true)),
                child: const Text('Share adjustment history PDF'),
              ),
            ],
            const SizedBox(height: 16),
            if (accepted && header['lifecycle'] != 'cancelled')
              OutlinedButton(
                onPressed: () => perform(context, () => cancelBill(bill)),
                child: Text(
                  app.owner
                      ? 'Cancel selected undelivered goods'
                      : 'Request cancellation',
                ),
              ),
            const SizedBox(height: 24),
            if (!accepted)
              const Text(
                'Final number and PDF are available after server acceptance. Keep this phone’s saved copy until it syncs.',
                style: TextStyle(color: muted, fontSize: 12),
              ),
          ],
        ),
      );
    },
  );
}

class DeliveryStrip extends StatelessWidget {
  final AppController app;
  final Json bill, line;
  const DeliveryStrip({
    super.key,
    required this.app,
    required this.bill,
    required this.line,
  });
  @override
  Widget build(BuildContext context) {
    final saved =
        objects(app.delivery(bill)['lines'])
            .where((l) => l['id'] == line['id'])
            .firstOrNull ??
        line;
    final billed =
        saved['billed_canonical'] ??
        canonicalQuantity(
          nanos('${line['factor'] ?? 1}') *
              BigInt.from(integer(line['quantity_milli'])) ~/
              BigInt.from(1000),
        );
    return FutureBuilder<BigInt>(
      future: app.pendingDelivered(bill, '${line['id']}'),
      builder: (context, snapshot) {
        final extra = snapshot.data ?? BigInt.zero;
        final delivered = nanos('${saved['delivered_canonical'] ?? 0}') + extra;
        final remaining =
            nanos('$billed') -
            delivered -
            nanos('${saved['cancelled_canonical'] ?? 0}');
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                for (final entry in {
                  'Billed': '$billed',
                  'Handed over': canonicalQuantity(delivered),
                  'Remaining': canonicalQuantity(
                    remaining < BigInt.zero ? BigInt.zero : remaining,
                  ),
                }.entries)
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry.key,
                          style: const TextStyle(fontSize: 10, color: muted),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          entry.value,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            if (extra > BigInt.zero)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Includes deliveries saved on this phone',
                  style: TextStyle(fontSize: 10, color: muted),
                ),
              ),
          ],
        );
      },
    );
  }
}

class QuantityDialog extends StatefulWidget {
  final List<Unit> units;
  final String title;
  final bool returns, chooseSettlement;
  const QuantityDialog({
    super.key,
    required this.units,
    required this.title,
    this.returns = false,
    this.chooseSettlement = true,
  });
  @override
  State<QuantityDialog> createState() => _QuantityDialogState();
}

class _QuantityDialogState extends State<QuantityDialog> {
  late String unit;
  final qty = TextEditingController(text: '1'),
      reason = TextEditingController();
  String disposition = 'restockable',
      resolution = 'advance',
      refundMethod = 'cash';
  @override
  void initState() {
    super.initState();
    unit = widget.units.first.id;
  }

  @override
  void dispose() {
    qty.dispose();
    reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: SizedBox(
      width: 380,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: unit,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Saved bill unit'),
              items: widget.units
                  .map(
                    (u) => DropdownMenuItem(value: u.id, child: Text(u.label)),
                  )
                  .toList(),
              onChanged: (v) => setState(() => unit = v!),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: qty,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(labelText: 'Quantity'),
            ),
            if (widget.returns) ...[
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                initialValue: disposition,
                decoration: const InputDecoration(labelText: 'Condition'),
                items: ['restockable', 'damaged', 'discarded']
                    .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                    .toList(),
                onChanged: (v) => setState(() => disposition = v!),
              ),
              const SizedBox(height: 16),
              if (widget.chooseSettlement)
                DropdownButtonFormField<String>(
                  initialValue: resolution,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'After debt reduction',
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'advance',
                      child: Text('Whole remainder as advance'),
                    ),
                    DropdownMenuItem(
                      value: 'refund',
                      child: Text('Refund whole remainder'),
                    ),
                  ],
                  onChanged: (v) => setState(() => resolution = v!),
                ),
              if (widget.chooseSettlement && resolution == 'refund') ...[
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  initialValue: refundMethod,
                  decoration: const InputDecoration(labelText: 'Refund method'),
                  items: ['cash', 'upi', 'bank']
                      .map(
                        (v) => DropdownMenuItem(
                          value: v,
                          child: Text(v.toUpperCase()),
                        ),
                      )
                      .toList(),
                  onChanged: (v) => setState(() => refundMethod = v!),
                ),
              ],
              const SizedBox(height: 16),
              TextField(
                controller: reason,
                maxLength: 500,
                decoration: const InputDecoration(labelText: 'Reason'),
              ),
            ],
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () {
          try {
            if (widget.returns && reason.text.trim().isEmpty) {
              throw StateError('Add a reason');
            }
            Navigator.pop(context, {
              'unitId': unit,
              'quantityMilli': parseQuantity(qty.text),
              'disposition': disposition,
              'resolution': resolution,
              'refundMethod': refundMethod,
              'reason': reason.text.trim(),
            });
          } catch (e) {
            showError(context, e);
          }
        },
        child: const Text('Confirm'),
      ),
    ],
  );
}
