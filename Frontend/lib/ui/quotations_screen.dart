import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/amount.dart';
import '../models/models.dart';
import '../services/feature_rules.dart';
import 'common.dart';
import 'document_tax_summary.dart';
import 'billing_screen.dart';

class QuotationsScreen extends StatefulWidget {
  final AppController app;
  const QuotationsScreen({super.key, required this.app});
  @override
  State<QuotationsScreen> createState() => _QuotationsScreenState();
}

class _QuotationsScreenState extends State<QuotationsScreen> {
  List<Json> rows = [];
  @override
  void initState() {
    super.initState();
    widget.app.addListener(load);
    load();
  }

  @override
  void dispose() {
    widget.app.removeListener(load);
    super.dispose();
  }

  Future<void> load() async {
    if (widget.app.business == null) return;
    final result = await widget.app.store!.all(widget.app.scope, 'quotation');
    if (mounted) setState(() => rows = result);
  }

  Future<void> copy(Json row) async {
    final app = widget.app, q = object(row['quotation']);
    final source = await app.fetch('/quotations/${q['id']}/draft');
    final lines = <DraftLine>[];
    final sourceLines = objects(source['lines']);
    final warnings = quotationCopyWarnings(sourceLines);
    for (final l in sourceLines) {
      final revision = await app.store!.get(
        app.scope,
        'catalogue_revision',
        '${l['itemId']}/${l['catalogueVersion']}',
      );
      if (revision == null) {
        throw StateError(
          'Sync the saved catalogue revisions before copying this quotation',
        );
      }
      lines.add(quotationDraftLine(app.newId(), l, revision));
    }
    final id = app.newId();
    await app.saveDraft(id, {
      'id': id,
      'quotationId': q['id'],
      'quotationWarnings': warnings,
      'customerId': source['customerId'],
      if (source['placeOfSupply'] != null)
        'placeOfSupply': source['placeOfSupply'],
      'lines': lines.map((l) => l.toJson()).toList(),
    });
    if (mounted) await navigate(context, BillingScreen(app: app, draftId: id));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Quotations')),
    body: PageBody(
      children: [
        const Text(
          'Quotations do not create debt or use bill numbers. Build a cart in New bill, then choose Save as quotation.',
          style: TextStyle(color: muted),
        ),
        const SizedBox(height: 16),
        OutlinedButton(
          onPressed: () => navigate(context, BillingScreen(app: widget.app)),
          child: const Text('Build quotation'),
        ),
        const SizedBox(height: 20),
        if (rows.isEmpty)
          const EmptyState(
            'No quotations saved',
            'Saved quotations appear after sync.',
          ),
        for (final row in rows) ...[
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${object(row['quotation'])['reference']}',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text(money(object(row['quotation'])['total_minor'])),
                DocumentTaxSummary(
                  snapshot: object(
                    object(row['quotation'])['document_snapshot'],
                  ),
                ),
                const SizedBox(height: 12),
                for (final line in objects(row['lines']))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      '${line['item_name']} · ${quantity(integer(line['quantity_milli']))} ${line['unit_label']} · ${money(line['line_total_minor'])}',
                    ),
                  ),
                Wrap(
                  spacing: 8,
                  children: [
                    TextButton(
                      onPressed: () => perform(
                        context,
                        () => widget.app.pdf(
                          '${object(row['quotation'])['id']}',
                          quotation: true,
                        ),
                      ),
                      child: const Text('Share PDF'),
                    ),
                    TextButton(
                      onPressed: () => perform(context, () => copy(row)),
                      child: const Text('Copy to bill draft'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
      ],
    ),
  );
}
