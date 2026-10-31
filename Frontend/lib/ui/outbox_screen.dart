import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app_controller.dart';
import 'common.dart';

class OutboxScreen extends StatelessWidget {
  final AppController app;
  const OutboxScreen({super.key, required this.app});
  @override
  Widget build(BuildContext context) => ControllerPage(
    app: app,
    builder: (context) => Scaffold(
      appBar: AppBar(
        title: const Text('Saved work & sync'),
        actions: [
          IconButton(
            onPressed: app.sync,
            tooltip: 'Sync now',
            icon: const Icon(Icons.sync),
          ),
        ],
      ),
      body: PageBody(
        children: [
          const Text(
            'Pending operations keep their original prices, quantities and operation ID when retried.',
            style: TextStyle(color: muted),
          ),
          const SizedBox(height: 20),
          if (app.outbox.isEmpty)
            const EmptyState(
              'Everything is clear',
              'New work appears here until the server accepts it.',
            ),
          for (final job in app.outbox.where((j) => j.status != 'done'))
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      job.kind.toUpperCase(),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    StatusTag(
                      job.status.replaceAll('_', ' ').toUpperCase(),
                      attention: job.status != 'done',
                    ),
                    if (job.error?.trim().isNotEmpty == true ||
                        ['rejected', 'review_required'].contains(job.status))
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: SelectableText(
                          job.error?.trim().isNotEmpty == true ? job.error! : 'The server did not accept this saved operation. No error details were saved. Retry the original operation to obtain current details.',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                    const SizedBox(height: 8),
                    Text(
                      'Attempts: ${job.attempts} · ${DateFormat('d MMM, HH:mm').format(job.created.toLocal())}',
                      style: const TextStyle(fontSize: 11, color: muted),
                    ),
                    if (job.kind == 'bill' &&
                        ['rejected', 'review_required'].contains(job.status) &&
                        app.owner) ...[
                      const Text(
                        'Check the server details above and fix business setup if required. Retry sends the original bill unchanged; financial conflicts still require review.',
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                      TextButton(
                        onPressed: app.syncing
                            ? null
                            : () => perform(context, () => app.retryBill(job)),
                        child: const Text('Retry original bill'),
                      ),
                    ],
                    if (job.kind == 'online_action' &&
                        ['uncertain', 'sending_online'].contains(job.status) &&
                        app.owner)
                      TextButton(
                        onPressed: () => perform(context, () async {
                          await app.retryOnline(job);
                        }),
                        child: const Text('Retry original action'),
                      ),
                    if (job.dependencies.isNotEmpty)
                      const Text(
                        'Waits for related saved work to be accepted.',
                        style: TextStyle(fontSize: 11, color: muted),
                      ),
                  ],
                ),
              ),
            ),
          if (app.outbox.any((j) => j.status == 'done'))
            Text(
              '${app.outbox.where((j) => j.status == 'done').length} operations accepted',
              style: const TextStyle(color: muted),
            ),
        ],
      ),
    ),
  );
}
