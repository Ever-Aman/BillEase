import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/amount.dart';
import '../models/models.dart';
import 'common.dart';
import 'bill_detail.dart';

class InboxScreen extends StatefulWidget {
  final AppController app;
  const InboxScreen({super.key, required this.app});
  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  List<Json> conflicts = [], quarantine = [], accessNotices = [];
  String? loadError;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final app = widget.app;
    final store = app.store;
    final business = app.business;
    if (store == null || business == null) return;
    final scope = business.scope(app.userId);
    bool isCurrent() =>
        mounted &&
        app.business?.scope(app.userId) == scope &&
        identical(app.store, store);
    try {
      final localAccess = await store.get(scope, '_meta', 'access_notices');
      if (!isCurrent()) return;
      final a = await app.fetch('/conflicts');
      if (!isCurrent()) return;
      final b = await app.fetch('/quarantine');
      if (isCurrent()) {
        setState(() {
          accessNotices = objects(localAccess?['rows']);
          conflicts = objects(a['conflicts']);
          quarantine = objects(b['operations']);
        });
      }
    } catch (e) {
      if (isCurrent()) setState(() => loadError = friendlyError(e));
    }
  }

  Future<void> decide(Json request, bool approve) async {
    final input = await fieldsDialog(
      context,
      title: approve ? 'Approve & apply action' : 'Reject request',
      fields: {'Reason': ''},
      confirm: approve ? 'Approve & apply' : 'Reject',
      detail: approve
          ? 'Approval performs the requested action immediately. Review the reason and quantities before confirming.'
          : null,
    );
    if (input == null || !mounted) return;
    Json? settlement;
    if (approve && ['return', 'bill_cancel'].contains(request['type'])) {
      settlement = await chooseSettlement(context);
      if (settlement == null || !mounted) return;
    }
    await perform(context, () async {
      await widget.app.decideStaffRequest(
        request,
        approve,
        input['Reason']!,
        settlement: settlement,
      );
      await load();
    });
  }

  Future<void> reconcile(Json row) async {
    final input = await fieldsDialog(
      context,
      title: 'Resolve retained work',
      fields: {
        'Resolution': 'Already applied and verified',
        'Review note': 'Reviewed against current business records',
      },
      choices: {
        'Resolution': ['Already applied and verified', 'Discard original'],
      },
      detail: 'Inspect the current business details first. This records your review and closes the retained entry; it does not execute the original action.',
    );
    if (input == null || !mounted) return;
    await widget.app.action(
      '/quarantine/${row['device_id']}/${row['operation_id']}/reconcile',
      {
        'resolution': input['Resolution'] == 'Discard original'
            ? 'discarded'
            : 'already_applied',
        'note': input['Review note'],
        'decisionOperationId': widget.app.newId(),
      },
    );
    await load();
  }

  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    return ControllerPage(
      app: app,
      builder: (context) {
        final requests = app.requests
            .where((r) => r['state'] == 'pending')
            .toList();
        final bills = app.bills
            .where(
              (b) =>
                  billHeader(b)['review_state'] == 'credit_pending' ||
                  objects(b['payments']).any(
                    (p) => p['state'] == 'pending' && p['corrected_at'] == null,
                  ),
            )
            .toList();
        return Scaffold(
          appBar: AppBar(
            title: const Text('Approval inbox'),
            actions: [
              IconButton(
                onPressed: () async {
                  await app.sync();
                  await load();
                },
                tooltip: 'Refresh',
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          body: PageBody(
            children: [
              const Text(
                'Approvals apply the action immediately. A connection is required.',
                style: TextStyle(color: muted),
              ),
              const SizedBox(height: 20),
              if (loadError != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(loadError!),
                ),
              if (requests.isEmpty &&
                  bills.isEmpty &&
                  conflicts.isEmpty &&
                  quarantine.isEmpty)
                const EmptyState(
                  'No pending reviews',
                  'Staff requests and payment claims will appear here.',
                ),
              if (accessNotices.isNotEmpty) ...[
                Text(
                  'Access notices',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                Panel(
                  child: Column(
                    children: [
                      for (final notice in accessNotices.take(10))
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            '${notice['target_email'] ?? 'Account'} · ${'${notice['action']}'.split('.').last}',
                          ),
                          subtitle: Text(
                            'By ${notice['actor_email']} · ${notice['created_at']}',
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
              ],
              for (final request in requests) ...[
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${request['type']}'.replaceAll('_', ' '),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 8),
                      Text('${request['reason']}'),
                      const SizedBox(height: 8),
                      SelectableText(
                        reviewDetails(
                          app,
                          object(request['payload']),
                          targetId: '${request['target_id']}',
                        ),
                        style: const TextStyle(fontSize: 12, color: muted),
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 12,
                        children: [
                          AsyncButton(
                            label: 'Approve & apply',
                            onPressed: () => decide(request, true),
                          ),
                          TextButton(
                            onPressed: () => decide(request, false),
                            child: const Text('Reject'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],
              for (final b in bills) ...[
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        billCustomer(b),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        '${billReference(b)} · ${money(billHeader(b)['total_minor'])}',
                        style: const TextStyle(color: muted),
                      ),
                      const SizedBox(height: 16),
                      if (billHeader(b)['review_state'] == 'credit_pending')
                        Wrap(
                          spacing: 8,
                          children: [
                            AsyncButton(
                              label: 'Approve credit',
                              onPressed: () async {
                                await app.action(
                                  '/bills/${billId(b)}/credit-decision',
                                  {
                                    'billId': billId(b),
                                    'approve': true,
                                    'operationId': app.newId(),
                                  },
                                );
                              },
                            ),
                            TextButton(
                              onPressed: () => perform(context, () async {
                                await app.action(
                                  '/bills/${billId(b)}/credit-decision',
                                  {
                                    'billId': billId(b),
                                    'approve': false,
                                    'operationId': app.newId(),
                                  },
                                );
                              }),
                              child: const Text('Reject credit'),
                            ),
                          ],
                        ),
                      for (final p in objects(b['payments']).where(
                        (p) =>
                            p['state'] == 'pending' &&
                            p['corrected_at'] == null,
                      ))
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${'${p['method']}'.toUpperCase()} · ${money(p['amount_minor'])}',
                              ),
                              Wrap(
                                spacing: 8,
                                children: [
                                  TextButton(
                                    onPressed: () => perform(context, () async {
                                      await app.action(
                                        '/payments/${p['id']}/decision',
                                        {
                                          'paymentId': p['id'],
                                          'confirm': true,
                                          'operationId': app.newId(),
                                        },
                                      );
                                    }),
                                    child: const Text('Money received'),
                                  ),
                                  TextButton(
                                    onPressed: () => perform(context, () async {
                                      await app.action(
                                        '/payments/${p['id']}/decision',
                                        {
                                          'paymentId': p['id'],
                                          'confirm': false,
                                          'operationId': app.newId(),
                                        },
                                      );
                                    }),
                                    child: const Text('Reject claim'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      TextButton(
                        onPressed: () => navigate(
                          context,
                          BillDetail(app: app, id: billId(b)),
                        ),
                        child: const Text('View bill & delivery'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],
              for (final c in conflicts.where(
                (c) => c['status'] == 'open',
              )) ...[
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Sync conflict',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        '${c['error'] ?? c['reason'] ?? c['operation_type']}',
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: () async {
                          final input = await fieldsDialog(
                            context,
                            title: 'Discard conflicted action',
                            fields: {'Review note': ''},
                            detail: 'This closes the conflicting action without applying it. Record any replacement separately.',
                          );
                          if (input == null || !context.mounted) return;
                          await perform(context, () async {
                            await app.action('/conflicts/${c['id']}/resolve', {
                              'resolution': 'discarded',
                              'note': input['Review note'],
                              'operationId': app.newId(),
                            });
                            await load();
                          });
                        },
                        child: const Text('Review & discard'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],
              for (final q in quarantine.where(
                (q) => q['decision'] == 'pending' || q['decision'] == null,
              )) ...[
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Recovered phone work',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text('${q['payload_type']}'.replaceAll('_', ' ')),
                      if (q['original_actor_email'] != null)
                        Text('Original account: ${q['original_actor_email']}'),
                      if (q['review_note'] != null)
                        Text(
                          '${q['review_note']}',
                          style: const TextStyle(color: muted, fontSize: 12),
                        ),
                      if (q['manual_reconciliation_available'] == true)
                        OutlinedButton(
                          onPressed: () => perform(context, () => reconcile(q)),
                          child: const Text('Resolve retained work'),
                        ),
                      SelectableText(
                        reviewDetails(app, object(q['payload'])),
                        style: const TextStyle(fontSize: 12, color: muted),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final accept in [
                            if (q['manual_reconciliation_available'] != true)
                              true,
                            false,
                          ])
                            OutlinedButton(
                              onPressed: () async {
                                final input = await fieldsDialog(
                                  context,
                                  title: accept
                                      ? 'Accept recovered work'
                                      : 'Reject recovered work',
                                  fields: {'Reason': ''},
                                );
                                if (input == null || !context.mounted) return;
                                await perform(context, () async {
                                  final result = await app.action(
                                    '/quarantine/${q['device_id']}/${q['operation_id']}/decision',
                                    {
                                      'accept': accept,
                                      'reason': input['Reason'],
                                      'decisionOperationId': app.newId(),
                                    },
                                  );
                                  if (result['status'] == 'retained' &&
                                      context.mounted) {
                                    showError(
                                      context,
                                      result['reason'] ??
                                          'Retained for manual review',
                                    );
                                  }
                                  await load();
                                });
                              },
                              child: Text(accept ? 'Accept & apply' : 'Reject'),
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
      },
    );
  }
}
