import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../models/models.dart';
import 'common.dart';

class DocumentsScreen extends StatefulWidget {
  final AppController app;
  const DocumentsScreen({super.key, required this.app});
  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  List<Json> series = [];
  Json? profile;
  String? error;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final result = await widget.app.fetch('/settings/document-series');
      final settings = await widget.app.fetch('/settings/document-profile');
      if (mounted) {
        setState(() {
          series = objects(result['series']);
          profile = settings;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = friendlyError(e));
    }
  }

  Future<void> editProfile() async {
    final app = widget.app;
    final store = app.store;
    final business = app.business;
    if (store == null || business == null) return;
    final scope = business.scope(app.userId);
    final saved = object(profile?['profile']);
    final gst = ['composition', 'regular_gst'].contains(business.documentMode);
    final gstinLabel = gst ? 'GSTIN' : 'GSTIN (optional)';
    final signatoryLabel = gst
        ? 'Authorised signatory'
        : 'Authorised signatory (optional)';
    final stateLabel = gst ? 'State code' : 'State code (optional)';
    final input = await fieldsDialog(
      context,
      title: 'Business document details',
      fields: {
        'Supplier name': '${saved['name'] ?? widget.app.business!.name}',
        'Address': '${saved['address'] ?? ''}',
        'Phone': '${saved['phone'] ?? ''}',
        gstinLabel: '${saved['gstin'] ?? ''}',
        signatoryLabel: '${saved['signatory'] ?? ''}',
        stateLabel: '${saved['stateCode'] ?? business.stateCode ?? ''}',
      },
      detail: 'Add legal GST details for the GST classification selected by your administrator. Prices include GST.',
      optionalFields: {
        if (!gst) ...[gstinLabel, signatoryLabel, stateLabel],
      },
    );
    if (!mounted || !context.mounted || input == null) return;
    if (app.business?.scope(app.userId) != scope ||
        !identical(app.store, store)) {
      return;
    }
    final gstin = input[gstinLabel]!.trim().toUpperCase();
    final signatory = input[signatoryLabel]!.trim();
    final stateCode = input[stateLabel]!.trim();
    if (stateCode.isNotEmpty && !RegExp(r'^\d{2}$').hasMatch(stateCode)) {
      throw StateError('Enter a two digit Indian state code');
    }
    await app.action('/settings/document-profile', {
      'name': input['Supplier name'],
      'address': input['Address'],
      'phone': input['Phone'],
      if (gstin.isNotEmpty) 'gstin': gstin,
      if (signatory.isNotEmpty) 'signatory': signatory,
      if (stateCode.isNotEmpty) 'stateCode': stateCode,
      'expectedVersion': integer(profile?['version']),
    }, method: 'PUT');
    if (mounted && context.mounted) await load();
  }

  String get financialYear {
    final today = DateTime.now().toUtc().add(
      const Duration(hours: 5, minutes: 30),
    );
    final start = today.month < 4 ? today.year - 1 : today.year;
    return '$start-${((start + 1) % 100).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Business documents')),
    body: PageBody(
      children: [
        if (profile != null) ...[
          Text(
            'Document mode: ${profile!['mode']}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => perform(context, editProfile),
            child: const Text('Edit business details'),
          ),
          const SizedBox(height: 20),
        ],
        const Text(
          'Composition businesses issue a Bill of Supply. Regular GST businesses issue a Tax Invoice. Enter legal business details and initialize the financial-year series before the first bill. All selling prices include GST.',
        ),
        const SizedBox(height: 24),
        Text('Bill numbering', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        if (error != null) Text(error!),
        for (final s in series)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${s['financial_year']}'),
            subtitle: Text('Last number: ${s['last_number']}'),
          ),
        const SizedBox(height: 16),
        OutlinedButton(
          onPressed: () async {
            final input = await fieldsDialog(
              context,
              title: 'Initialize bill series',
              fields: {
                'Financial year (YYYY-YY)': financialYear,
                'Last number already used': '0',
              },
              detail: 'For the first bill enter 0; the first number will be 1. Record existing customer debt through an opening balance, not a backdated bill.',
            );
            if (input == null || !context.mounted) return;
            await perform(context, () async {
              final n = int.tryParse(input['Last number already used']!);
              if (n == null || n < 0) {
                throw StateError('Enter a valid non-negative last number');
              }
              await widget.app.action('/settings/document-series', {
                'financialYear': input['Financial year (YYYY-YY)'],
                'lastNumber': n,
                'operationId': widget.app.newId(),
              });
              await load();
            });
          },
          child: const Text('Initialize financial-year series'),
        ),
      ],
    ),
  );
}
