import 'dart:async';

import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/amount.dart';
import '../models/models.dart';
import 'common.dart';
import 'bill_detail.dart';
import 'quotations_screen.dart';

class BillingScreen extends StatefulWidget {
  final AppController app;
  final String? draftId;
  const BillingScreen({super.key, required this.app, this.draftId});
  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  late final String id, originalScope;
  final lines = <DraftLine>[];
  final placeOfSupply = TextEditingController();
  final amounts = {
    for (final key in ['cash', 'upi', 'bank'])
      key: TextEditingController(text: '0'),
  };
  String? customerId, saveError, quotationId;
  List<String> quotationWarnings = [];
  Timer? debounce;
  bool loading = true, submitting = false, completed = false;
  Future<void> saving = Future.value();
  @override
  void initState() {
    super.initState();
    id = widget.draftId ?? widget.app.newId();
    originalScope = widget.app.scope;
    placeOfSupply.text = widget.app.business?.stateCode ?? '';
    load();
  }

  Future<void> load() async {
    try {
      final draft = await widget.app.draft(id);
      if (draft != null) {
        lines.addAll(objects(draft['lines']).map(DraftLine.fromJson));
        customerId = draft['customerId'] as String?;
        placeOfSupply.text =
            '${draft['placeOfSupply'] ?? widget.app.business?.stateCode ?? ''}';
        quotationId = draft['quotationId'] as String?;
        quotationWarnings = (draft['quotationWarnings'] as List? ?? [])
            .map((warning) => '$warning')
            .toList();
        for (final key in amounts.keys) {
          amounts[key]!.text = '${object(draft['amounts'])[key] ?? '0'}';
        }
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
    if (mounted) setState(() => loading = false);
  }

  Json snapshot() => {
    'id': id,
    'customerId': customerId,
    if (placeOfSupply.text.trim().isNotEmpty)
      'placeOfSupply': placeOfSupply.text.trim(),
    if (quotationId != null) 'quotationId': quotationId,
    if (quotationWarnings.isNotEmpty) 'quotationWarnings': quotationWarnings,
    'lines': lines.map((l) => l.toJson()).toList(),
    'amounts': amounts.map((key, value) => MapEntry(key, value.text)),
    'updatedAt': DateTime.now().toUtc().toIso8601String(),
  };
  Future<void> persist() {
    if (completed ||
        !widget.app.signedIn ||
        widget.app.business == null ||
        widget.app.scope != originalScope) {
      return Future.value();
    }
    final value = snapshot();
    saving = saving
        .then((_) {
          if (widget.app.signedIn &&
              widget.app.business != null &&
              widget.app.scope == originalScope) {
            return widget.app.saveDraft(id, value);
          }
        })
        .then((_) {
          if (mounted && saveError != null) setState(() => saveError = null);
        })
        .catchError((Object e) {
          if (mounted) setState(() => saveError = friendlyError(e));
        });
    return saving;
  }

  void changed() {
    setState(() {});
    debounce?.cancel();
    debounce = Timer(const Duration(milliseconds: 250), persist);
  }

  @override
  void dispose() {
    debounce?.cancel();
    if (!completed && !loading) {
      persist();
    }
    placeOfSupply.dispose();
    for (final c in amounts.values) {
      c.dispose();
    }
    super.dispose();
  }

  int get total => lines.fold(0, (sum, l) => sum + l.total);
  Future<void> addItem() async {
    if (widget.app.items.isEmpty) {
      showError(
        context,
        'Sync the catalogue or ask an owner to add your first item',
      );
      return;
    }
    final selected = await showModalBottomSheet<Item>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => ItemPicker(items: widget.app.items),
    );
    if (selected == null || !mounted) return;
    final line = await showDialog<DraftLine>(
      context: context,
      builder: (context) => LineDialog(app: widget.app, item: selected),
    );
    if (line != null) {
      lines.add(line);
      changed();
      await persist();
    }
  }

  Future<void> submit() async {
    debounce?.cancel();
    await persist();
    if (saveError != null) throw StateError(saveError!);
    if (!mounted ||
        widget.app.business == null ||
        widget.app.scope != originalScope) {
      throw StateError('This draft belongs to a different workspace');
    }
    final payment = amounts.map(
      (key, value) => MapEntry(key, parseAmount(value.text)),
    );
    if (customerId != null &&
        !widget.app.customers.any((c) => c['id'] == customerId)) {
      throw StateError(
        'This customer is no longer available. Choose an active customer.',
      );
    }
    setState(() => submitting = true);
    try {
      await widget.app.submitBill(
        id,
        lines,
        customerId,
        payment,
        quotationId: quotationId,
        placeOfSupply: placeOfSupply.text.trim(),
      );
      completed = true;
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => BillDetail(app: widget.app, id: id),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => submitting = false);
    }
  }

  Future<void> quotation() async {
    if (lines.isEmpty) throw StateError('Add items before saving a quotation');
    if ([
          'composition',
          'regular_gst',
        ].contains(widget.app.business?.documentMode) &&
        !RegExp(r'^\d{2}$').hasMatch(placeOfSupply.text.trim())) {
      throw StateError('Enter the two digit place of supply state code');
    }
    await persist();
    if (!mounted) return;
    final values = await fieldsDialog(
      context,
      title: 'Save quotation',
      fields: {'Reference': ''},
      detail: 'Requires a connection. Payments in this cart are not recorded. The bill draft is kept.',
    );
    if (values == null || !mounted) return;
    await widget.app.action('/quotations', {
      'id': widget.app.newId(),
      'reference': values['Reference'],
      'customerId': customerId,
      if (placeOfSupply.text.trim().isNotEmpty)
        'placeOfSupply': placeOfSupply.text.trim(),
      'lines': lines
          .map(
            (l) => {
              'id': widget.app.newId(),
              'itemId': l.item.id,
              'unitId': l.unit.id,
              'catalogueVersion': l.item.version,
              'quantityMilli': l.quantityMilli,
              'priceMinor': l.priceMinor,
            },
          )
          .toList(),
      'operationId': widget.app.newId(),
    });
    if (mounted) await navigate(context, QuotationsScreen(app: widget.app));
  }

  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    return PopScope(
      canPop: !submitting,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('New bill'),
          actions: [
            if (!loading)
              TextButton(
                onPressed: submitting
                    ? null
                    : () async {
                        await persist();
                        if (context.mounted && saveError == null) {
                          Navigator.pop(context);
                        }
                      },
                child: const Text('Save draft'),
              ),
          ],
        ),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : PageBody(
                children: [
                  const StatusTag('DRAFT · NO BILL NUMBER YET'),
                  const SizedBox(height: 20),
                  if (quotationWarnings.isNotEmpty)
                    Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Quotation copied · review before confirming',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          for (final warning in quotationWarnings)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Text(warning),
                            ),
                          const Text(
                            'Saved prices, units, conversions and catalogue versions were kept. Review any changes before confirming this sale.',
                            style: TextStyle(color: muted, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  if (quotationWarnings.isNotEmpty) const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue:
                        customerId != null &&
                            app.customers.any((c) => c['id'] == customerId)
                        ? customerId
                        : null,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Customer'),
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('Walk-in · full cash sale'),
                      ),
                      for (final c in app.customers)
                        DropdownMenuItem(
                          value: '${c['id']}',
                          child: Text(
                            '${c['name']}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: submitting
                        ? null
                        : (v) {
                            customerId = v;
                            changed();
                          },
                  ),
                  const SizedBox(height: 16),
                  if ([
                        'composition',
                        'regular_gst',
                      ].contains(app.business?.documentMode) ||
                      placeOfSupply.text.isNotEmpty) ...[
                    TextField(
                      controller: placeOfSupply,
                      enabled: !submitting,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Place of supply · state code',
                        helperText: 'Two digit Indian state code for this supply, e.g. 29',
                      ),
                      onChanged: (_) => changed(),
                    ),
                    const SizedBox(height: 16),
                  ],
                  const Text(
                    'All selling prices include GST.',
                    style: TextStyle(color: muted, fontSize: 12),
                  ),
                  const SizedBox(height: 20),
                  if (lines.isEmpty)
                    const EmptyState(
                      'Start with an item',
                      'Choose a selling unit. Prices and conversions are saved with this draft.',
                    )
                  else
                    Panel(
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: [
                          for (var i = 0; i < lines.length; i++)
                            ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 8,
                              ),
                              title: Text(lines[i].item.name),
                              subtitle: Text(
                                '${quantity(lines[i].quantityMilli)} × ${lines[i].unit.label}\n${money(lines[i].priceMinor)} each · catalogue v${lines[i].item.version}',
                              ),
                              isThreeLine: true,
                              trailing: Column(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    money(lines[i].total),
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  SizedBox(
                                    height: 32,
                                    child: IconButton(
                                      padding: EdgeInsets.zero,
                                      tooltip: 'Remove item',
                                      icon: const Icon(Icons.close, size: 18),
                                      onPressed: submitting
                                          ? null
                                          : () {
                                              lines.removeAt(i);
                                              changed();
                                            },
                                    ),
                                  ),
                                ],
                              ),
                              onTap: submitting
                                  ? null
                                  : () async {
                                      final replacement =
                                          await showDialog<DraftLine>(
                                            context: context,
                                            builder: (_) => LineDialog(
                                              app: app,
                                              item: lines[i].item,
                                              original: lines[i],
                                            ),
                                          );
                                      if (replacement != null) {
                                        lines[i] = replacement;
                                        changed();
                                      }
                                    },
                            ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: submitting ? null : addItem,
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Add item'),
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Bill total',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                      ),
                      Text(
                        money(total),
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Payment received',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Cash is confirmed. UPI and bank entries need owner verification. Unpaid balances need a saved customer.',
                    style: TextStyle(color: muted, fontSize: 12),
                  ),
                  const SizedBox(height: 16),
                  for (final p in amounts.entries)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: TextField(
                        controller: p.value,
                        enabled: !submitting,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        onChanged: (_) => changed(),
                        decoration: InputDecoration(
                          labelText: {
                            'cash': 'Cash',
                            'upi': 'UPI',
                            'bank': 'Bank transfer',
                          }[p.key],
                          prefixText: '₹ ',
                        ),
                      ),
                    ),
                  if (saveError != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        'Draft could not be saved: $saveError',
                        style: const TextStyle(color: Colors.red),
                      ),
                    ),
                  const SizedBox(height: 8),
                  AsyncButton(label: 'Confirm & save bill', onPressed: submit),
                  if (app.owner)
                    TextButton(
                      onPressed: () => perform(context, quotation),
                      child: const Text('Save as quotation'),
                    ),
                  const SizedBox(height: 12),
                  const Text(
                    'Saved on this phone first. The server assigns the final bill number after accepting it. PDFs become available then.',
                    style: TextStyle(color: muted, fontSize: 12),
                  ),
                  const SizedBox(height: 32),
                ],
              ),
      ),
    );
  }
}

class ItemPicker extends StatefulWidget {
  final List<Item> items;
  const ItemPicker({super.key, required this.items});
  @override
  State<ItemPicker> createState() => _ItemPickerState();
}

class _ItemPickerState extends State<ItemPicker> {
  String query = '';
  @override
  Widget build(BuildContext context) => SizedBox(
    height: MediaQuery.sizeOf(context).height * .8,
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Choose an item',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            autofocus: true,
            onChanged: (v) => setState(() => query = v),
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Search catalogue',
            ),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: ListView(
              children: [
                for (final item in widget.items.where(
                  (i) =>
                      i.name.toLowerCase().contains(query.toLowerCase()) &&
                      i.units.any((u) => u.active),
                ))
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(item.name),
                    subtitle: Text(
                      item.units
                          .where((u) => u.active)
                          .map((u) => '${u.label} · ${money(u.price)}')
                          .join(' / '),
                    ),
                    trailing: const Icon(Icons.add_circle_outline),
                    onTap: () => Navigator.pop(context, item),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class LineDialog extends StatefulWidget {
  final AppController app;
  final Item item;
  final DraftLine? original;
  const LineDialog({
    super.key,
    required this.app,
    required this.item,
    this.original,
  });
  @override
  State<LineDialog> createState() => _LineDialogState();
}

class _LineDialogState extends State<LineDialog> {
  late Unit unit;
  late TextEditingController qty, price;
  @override
  void initState() {
    super.initState();
    unit =
        widget.original?.unit ?? widget.item.units.firstWhere((u) => u.active);
    qty = TextEditingController(
      text: widget.original == null
          ? '1'
          : quantity(widget.original!.quantityMilli),
    );
    price = TextEditingController(
      text: amountInput(widget.original?.priceMinor ?? unit.price),
    );
  }

  @override
  void dispose() {
    qty.dispose();
    price.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.item.name),
    content: SizedBox(
      width: 380,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<String>(
            initialValue: unit.id,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Selling unit'),
            items: widget.item.units
                .where((u) => u.active || u.id == unit.id)
                .map((u) => DropdownMenuItem(value: u.id, child: Text(u.label)))
                .toList(),
            onChanged: (v) {
              setState(() {
                unit = widget.item.units.firstWhere((u) => u.id == v);
                price.text = amountInput(unit.price);
              });
            },
          ),
          const SizedBox(height: 16),
          TextField(
            controller: qty,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Quantity'),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: price,
            readOnly: !widget.app.owner,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: widget.app.owner
                  ? 'Unit price · owner override allowed'
                  : 'Catalogue price',
              prefixText: '₹ ',
            ),
          ),
        ],
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
            final line = DraftLine(
              id: widget.original?.id ?? widget.app.newId(),
              item: widget.item,
              unit: unit,
              quantityMilli: parseQuantity(qty.text),
              priceMinor: widget.app.owner
                  ? parseAmount(price.text, allowZero: false)
                  : unit.price,
            );
            line.total;
            Navigator.pop(context, line);
          } catch (e) {
            showError(context, e);
          }
        },
        child: const Text('Save item'),
      ),
    ],
  );
}
