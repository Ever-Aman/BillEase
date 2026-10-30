import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../models/models.dart';
import 'common.dart';

class OwnRequestsScreen extends StatelessWidget {
  final AppController app;
  const OwnRequestsScreen({super.key, required this.app});
  @override
  Widget build(BuildContext context) => ControllerPage(
    app: app,
    builder: (context) => Scaffold(
      appBar: AppBar(title: const Text('Your requests')),
      body: FutureBuilder<List<Json>>(
        future: app.store!.all(app.scope, 'local_request'),
        builder: (context, snapshot) {
          final known = app.requests.map((r) => r['id']).toSet();
          final rows = [
            ...app.requests,
            ...(snapshot.data ?? []).where((r) => !known.contains(r['id'])),
          ];
          return PageBody(
            children: [
              if (rows.isEmpty)
                const EmptyState(
                  'No requests yet',
                  'Request a cancellation, return or delivery correction from a bill.',
                ),
              for (final row in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${row['type']}'.replaceAll('_', ' '),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        Text('${row['reason']}'),
                        const SizedBox(height: 12),
                        StatusTag(
                          '${row['state']}'.replaceAll('_', ' ').toUpperCase(),
                          attention: [
                            'pending',
                            'pending_upload',
                          ].contains(row['state']),
                        ),
                        if (row['decision_reason'] != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text('Owner: ${row['decision_reason']}'),
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    ),
  );
}
