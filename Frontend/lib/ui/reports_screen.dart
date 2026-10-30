import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/amount.dart';
import '../models/models.dart';
import 'common.dart';
import '../services/feature_rules.dart';
import 'bill_detail.dart';

class ReportsScreen extends StatefulWidget {
  final AppController app;
  const ReportsScreen({super.key, required this.app});
  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  Json? data, gst;
  String? gstError;
  String? error;
  bool loading = false;
  int days = 7;
  DateTimeRange? range;
  late final String scope;
  List<Json> fulfilment = [];
  String? after;
  bool more = true, loadingLines = false;
  bool get active =>
      widget.app.signedIn &&
      widget.app.business != null &&
      widget.app.owner &&
      widget.app.scope == scope;
  @override
  void initState() {
    super.initState();
    scope = widget.app.scope;
    load();
    loadLines();
  }

  Future<void> load() async {
    if (!active) return;
    setState(() {
      loading = true;
      gst = null;
      gstError = null;
    });
    try {
      final now = DateTime.now().toUtc();
      final period = range == null
          ? {
              'from': now.subtract(Duration(days: days)).toIso8601String(),
              'to': now.toIso8601String(),
            }
          : reportPeriod(range!.start, range!.end);
      final from = period['from']!, to = period['to']!;
      final result = await widget.app.fetch(
        '/reports/overview?from=${Uri.encodeQueryComponent(from)}&to=${Uri.encodeQueryComponent(to)}',
        cacheKey: range == null ? 'overview.$days' : 'overview.$from.$to',
      );
      if (mounted && active) {
        setState(() {
          data = result;
          error = null;
        });
      }
      if (!mounted || !active) return;
      try {
        final gstResult = await widget.app.fetch(
          '/reports/gst?from=${Uri.encodeQueryComponent(from)}&to=${Uri.encodeQueryComponent(to)}',
          cacheKey: range == null ? 'gst.$days' : 'gst.$from.$to',
        );
        if (mounted && active) setState(() => gst = gstResult);
      } catch (e) {
        if (mounted && active) setState(() => gstError = friendlyError(e));
      }
    } catch (e) {
      if (mounted && active) setState(() => error = friendlyError(e));
    } finally {
      if (mounted && active) setState(() => loading = false);
    }
  }

  Future<void> loadLines() async {
    if (!active || loadingLines || !more) return;
    setState(() => loadingLines = true);
    try {
      final result = await widget.app.fetch(
        '/reports/fulfilment${after == null ? '' : '?after=$after'}',
        cacheKey: 'fulfilment.${after ?? 'first'}',
      );
      if (!mounted || !active) return;
      setState(() {
        fulfilment.addAll(objects(result['lines']));
        after = result['nextCursor'] as String?;
        more = result['hasMore'] == true;
      });
    } catch (e) {
      if (mounted && active) setState(() => error = friendlyError(e));
    } finally {
      if (mounted && active) setState(() => loadingLines = false);
    }
  }

  bool get gstAvailable {
    if (gst?['kind'] != 'operational_gst_summary') return false;
    final totals = object(gst?['totals']);
    return ['original', 'reversed', 'net'].every((group) {
      final row = object(totals[group]);
      return [
        'baseMinor',
        'cgstMinor',
        'sgstMinor',
        'igstMinor',
        'grossMinor',
      ].every((key) => row[key] != null);
    });
  }

  @override
  Widget build(BuildContext context) => ControllerPage(
    app: widget.app,
    builder: (context) => Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: !active
          ? const PageBody(
              children: [Text('Business or access changed. Reopen reports.')],
            )
          : PageBody(
              children: [
                Wrap(
                  spacing: 8,
                  children: [
                    for (final d in [1, 7, 30])
                      ChoiceChip(
                        label: Text(d == 1 ? 'Last 24 hours' : 'Last $d days'),
                        selected: range == null && days == d,
                        onSelected: loading
                            ? null
                            : (_) {
                                setState(() {
                                  days = d;
                                  range = null;
                                });
                                load();
                              },
                      ),
                    ActionChip(
                      label: Text(
                        range == null
                            ? 'Custom dates · India time'
                            : '${range!.start.day}/${range!.start.month}/${range!.start.year} – ${range!.end.day}/${range!.end.month}/${range!.end.year}',
                      ),
                      onPressed: loading
                          ? null
                          : () async {
                              final picked = await showDateRangePicker(
                                context: context,
                                firstDate: DateTime(2000),
                                lastDate: DateTime.now(),
                                initialDateRange: range,
                              );
                              if (picked == null || !mounted || !active) return;
                              setState(() => range = picked);
                              await load();
                            },
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                if (loading) const LinearProgressIndicator(),
                if (error != null) Text(error!),
                if (data != null) ...[
                  Text(
                    '${data!['_stale'] == true ? 'Cached report' : 'Server report'} · as of ${data!['asOf'] ?? 'not available'}',
                    style: const TextStyle(fontSize: 12, color: muted),
                  ),
                  const SizedBox(height: 20),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Sales by bill status',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        for (final row in objects(data!['sales']))
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              '${row['lifecycle']} · ${row['review_state']}',
                            ),
                            subtitle: Text('${row['bill_count']} bills'),
                            trailing: Text(money(row['total_minor'])),
                          ),
                        if (objects(data!['sales']).isEmpty)
                          const Padding(
                            padding: EdgeInsets.only(top: 12),
                            child: Text('No sales in this period.'),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Confirmed receipts',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        for (final row in objects(data!['confirmedReceipts']))
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text('${row['method']}'.toUpperCase()),
                            trailing: Text(money(row['amount_minor'])),
                          ),
                        const SizedBox(height: 12),
                        Text(
                          'Debt · ${money(object(data!['balances'])['debt_minor'])}',
                        ),
                        Text(
                          'Advance · ${money(object(data!['balances'])['advance_minor'])}',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (gstError != null)
                    Text('GST summary unavailable: $gstError'),
                  if (gstAvailable) ...[
                    Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Operational GST summary',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          const Text(
                            'For business review. This is not a government filing.',
                            style: TextStyle(fontSize: 12, color: muted),
                          ),
                          if (gst!['_stale'] == true)
                            const Text('Cached GST summary'),
                          for (final group in {
                            'original': 'Original',
                            'reversed': 'Reversed',
                            'net': 'Net',
                          }.entries) ...[
                            const SizedBox(height: 12),
                            Text(
                              '${group.value} gross: ${money(object(object(gst!['totals'])[group.key])['grossMinor'])}',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            for (final amount in {
                              'baseMinor': 'base',
                              'cgstMinor': 'CGST',
                              'sgstMinor': 'SGST',
                              'igstMinor': 'IGST',
                            }.entries)
                              Text(
                                '${group.value} ${amount.value}: ${money(object(object(gst!['totals'])[group.key])[amount.key])}',
                              ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  const Text(
                    'Reports include work accepted by the server. Unsent work on other phones is unknown.',
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Fulfilment · all dates',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  for (final row in fulfilment)
                    ListTile(
                      title: Text('${row['item_name']}'),
                      subtitle: Text(
                        'Billed ${row['billed_canonical']} · handed over ${row['delivered_canonical']} · returned ${row['returned_canonical']}\nCancelled ${row['cancelled_canonical']} · pending ${row['pending_canonical']} · excess ${row['excess_canonical']} ${row['canonical_unit']}',
                      ),
                      isThreeLine: true,
                      onTap: () => navigate(
                        context,
                        BillDetail(app: widget.app, id: '${row['bill_id']}'),
                      ),
                    ),
                  if (loadingLines) const LinearProgressIndicator(),
                  if (more && !loadingLines)
                    OutlinedButton(
                      onPressed: loadLines,
                      child: const Text('Load more fulfilment rows'),
                    ),
                  if (!more && fulfilment.isEmpty)
                    const Text('No fulfilment rows.'),
                ] else if (!loading && error == null)
                  const EmptyState(
                    'No report available',
                    'Connect to load a report for this business.',
                  ),
              ],
            ),
    ),
  );
}
