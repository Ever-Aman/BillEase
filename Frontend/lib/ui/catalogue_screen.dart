import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/amount.dart';
import '../models/models.dart';
import 'common.dart';
import 'catalogue_import_screen.dart';

class CatalogueScreen extends StatefulWidget {
  final AppController app;
  const CatalogueScreen({super.key, required this.app});
  @override
  State<CatalogueScreen> createState() => _CatalogueScreenState();
}

class _CatalogueScreenState extends State<CatalogueScreen> {
  String search = '';
  @override
  Widget build(BuildContext context) => ControllerPage(
    app: widget.app,
    builder: (context) => Scaffold(
      appBar: AppBar(
        title: const Text('Catalogue & prices'),
        actions: [
          if (widget.app.owner)
            IconButton(
              tooltip: 'Import CSV',
              onPressed: () =>
                  navigate(context, CatalogueImportScreen(app: widget.app)),
              icon: const Icon(Icons.upload_file),
            ),
          if (widget.app.owner)
            IconButton(
              tooltip: 'Add item',
              onPressed: () => navigate(context, ItemEditor(app: widget.app)),
              icon: const Icon(Icons.add),
            ),
        ],
      ),
      body: PageBody(
        children: [
          const Text(
            'Updates replace the item and unit rows on this phone after sync. Existing bills keep their saved prices.',
            style: TextStyle(color: muted, fontSize: 12),
          ),
          const SizedBox(height: 20),
          TextField(
            onChanged: (v) => setState(() => search = v),
            decoration: const InputDecoration(
              hintText: 'Search catalogue',
              prefixIcon: Icon(Icons.search),
            ),
          ),
          const SizedBox(height: 20),
          if (widget.app.items.isEmpty)
            const EmptyState(
              'No items yet',
              'An owner can add items and selling units while connected.',
            ),
          for (final item in widget.app.items.where(
            (i) => i.name.toLowerCase().contains(search.toLowerCase()),
          ))
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.name,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        if (widget.app.owner)
                          IconButton(
                            tooltip: 'Edit item',
                            onPressed: () => navigate(
                              context,
                              ItemEditor(app: widget.app, item: item),
                            ),
                            icon: const Icon(Icons.edit_outlined, size: 20),
                          ),
                      ],
                    ),
                    for (final unit in item.units.where((u) => u.active))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(unit.label),
                                  Text(
                                    '${unit.factor} ${item.canonicalUnit}',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: muted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              money(unit.price),
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    Text(
                      'Catalogue v${item.version}',
                      style: const TextStyle(fontSize: 11, color: muted),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

class _UnitFields {
  final String id;
  final TextEditingController label, factor, price;
  bool active;
  _UnitFields(
    this.id, {
    String name = '',
    String conversion = '1',
    String amount = '0',
    this.active = true,
  }) : label = TextEditingController(text: name),
       factor = TextEditingController(text: conversion),
       price = TextEditingController(text: amount);
  void dispose() {
    label.dispose();
    factor.dispose();
    price.dispose();
  }
}

class ItemEditor extends StatefulWidget {
  final AppController app;
  final Item? item;
  const ItemEditor({super.key, required this.app, this.item});
  @override
  State<ItemEditor> createState() => _ItemEditorState();
}

class _ItemEditorState extends State<ItemEditor> {
  late TextEditingController name, canonical, hsn, gstRate;
  String taxCategory = 'taxable';
  late String id;
  final units = <_UnitFields>[];
  @override
  void initState() {
    super.initState();
    id = widget.item?.id ?? widget.app.newId();
    name = TextEditingController(text: widget.item?.name ?? '');
    canonical = TextEditingController(text: widget.item?.canonicalUnit ?? '');
    hsn = TextEditingController(text: widget.item?.hsn ?? '');
    gstRate = TextEditingController(
      text: widget.item?.gstRateBps == null
          ? ''
          : amountInput(widget.item!.gstRateBps!),
    );
    taxCategory = widget.item?.taxCategory ?? 'taxable';
    for (final u in widget.item?.units ?? <Unit>[]) {
      units.add(
        _UnitFields(
          u.id,
          name: u.label,
          conversion: u.factor,
          amount: amountInput(u.price),
          active: u.active,
        ),
      );
    }
    if (units.isEmpty) units.add(_UnitFields(widget.app.newId()));
  }

  @override
  void dispose() {
    name.dispose();
    canonical.dispose();
    hsn.dispose();
    gstRate.dispose();
    for (final u in units) {
      u.dispose();
    }
    super.dispose();
  }

  Future<void> save() async {
    if (name.text.trim().isEmpty || canonical.text.trim().isEmpty) {
      throw StateError('Enter item name and base unit');
    }
    final hsnValue = hsn.text.trim();
    if (hsnValue.isNotEmpty && !RegExp(r'^\d{4,8}$').hasMatch(hsnValue)) {
      throw StateError('Enter HSN with 4 to 8 digits');
    }
    final rate = gstRate.text.trim().isEmpty
        ? null
        : parseGstRate(gstRate.text);
    if (taxCategory != 'taxable' && rate != null && rate != 0) {
      throw StateError('Nil rated and exempt items must use 0% GST');
    }
    if ([
          'composition',
          'regular_gst',
        ].contains(widget.app.business?.documentMode) &&
        hsnValue.isEmpty) {
      throw StateError('Enter HSN for GST billing');
    }
    if (widget.app.business?.documentMode == 'regular_gst' &&
        (rate == null || (taxCategory == 'taxable' && rate == 0))) {
      throw StateError('Enter a GST rate; use nil rated or exempt for 0%');
    }
    final rows = <Json>[];
    for (final u in units) {
      if (u.label.text.trim().isEmpty) {
        throw StateError('Name each selling unit');
      }
      if (!RegExp(r'^\d{1,9}(\.\d{1,6})?$').hasMatch(u.factor.text.trim()) ||
          nanos(u.factor.text.trim()) <= BigInt.zero) {
        throw StateError(
          'Conversion must be positive with up to six decimal places',
        );
      }
      rows.add({
        'id': u.id,
        'label': u.label.text.trim(),
        'factor': u.factor.text.trim(),
        'priceMinor': parseAmount(u.price.text),
        'active': u.active,
      });
    }
    await widget.app.saveItem({
      'id': id,
      'name': name.text.trim(),
      'canonicalUnit': canonical.text.trim(),
      if (hsnValue.isNotEmpty) 'hsn': hsnValue,
      'gstRateBps': ?rate,
      if (rate != null || widget.item?.taxCategory != null)
        'taxCategory': taxCategory,
      'units': rows,
      'expectedVersion': widget.item?.version,
      'active': true,
      'operationId': widget.app.newId(),
    });
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.item == null ? 'Add item' : 'Edit item')),
    body: PageBody(
      children: [
        const Text(
          'Catalogue changes require a connection. Each update creates a new revision.',
          style: TextStyle(color: muted, fontSize: 12),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: name,
          decoration: const InputDecoration(labelText: 'Item name'),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: canonical,
          decoration: const InputDecoration(
            labelText: 'Base unit, e.g. kg, piece, litre',
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: hsn,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'HSN (4–8 digits)'),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: taxCategory,
          decoration: const InputDecoration(labelText: 'Tax category'),
          items: const [
            DropdownMenuItem(value: 'taxable', child: Text('Taxable')),
            DropdownMenuItem(value: 'nil_rated', child: Text('Nil rated')),
            DropdownMenuItem(value: 'exempt', child: Text('Exempt')),
          ],
          onChanged: (v) => setState(() => taxCategory = v!),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: gstRate,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(
            labelText: 'GST rate (%)',
            helperText: 'All selling prices include GST. Use 0 for nil rated or exempt.',
          ),
        ),
        const SizedBox(height: 24),
        Text('Selling units', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        for (final u in units) ...[
          Panel(
            child: Column(
              children: [
                TextField(
                  controller: u.label,
                  decoration: const InputDecoration(
                    labelText: 'Unit label, e.g. 25 kg bag',
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: u.factor,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Number of base units',
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: u.price,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Price in rupees (GST inclusive)',
                    prefixText: '₹ ',
                  ),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Available for new bills'),
                  value: u.active,
                  onChanged: (v) => setState(() => u.active = v),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
        OutlinedButton.icon(
          onPressed: units.length >= 30
              ? null
              : () =>
                    setState(() => units.add(_UnitFields(widget.app.newId()))),
          icon: const Icon(Icons.add),
          label: const Text('Add selling unit'),
        ),
        const SizedBox(height: 24),
        AsyncButton(label: 'Save catalogue revision', onPressed: save),
      ],
    ),
  );
}
