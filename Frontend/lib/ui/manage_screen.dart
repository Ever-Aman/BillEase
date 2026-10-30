import 'package:flutter/material.dart';

import '../app_controller.dart';
import 'common.dart';
import 'catalogue_screen.dart';
import 'security_screen.dart';
import 'quotations_screen.dart';

import 'outbox_screen.dart';
import 'inbox_screen.dart';
import 'reports_screen.dart';
import 'documents_screen.dart';
import 'own_requests_screen.dart';

class ManageScreen extends StatelessWidget {
  final AppController app;
  const ManageScreen({super.key, required this.app});
  @override
  Widget build(BuildContext context) => PageBody(
    children: [
      Text('Manage', style: Theme.of(context).textTheme.headlineLarge),
      const SizedBox(height: 8),
      Text(
        '${app.business!.role.toUpperCase()} · ${app.session.data!.email}',
        style: const TextStyle(color: muted, fontSize: 12),
      ),
      const SizedBox(height: 24),
      Panel(
        padding: EdgeInsets.zero,
        child: Column(
          children: [
            ListTile(
              leading: const Icon(Icons.view_list_outlined),
              title: const Text('Catalogue & prices'),
              subtitle: Text('${app.items.length} items saved on this phone'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => navigate(context, CatalogueScreen(app: app)),
            ),
            if (app.owner) ...[
              ListTile(
                leading: const Icon(Icons.inbox_outlined),
                title: const Text('Approval inbox'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => navigate(context, InboxScreen(app: app)),
              ),
              ListTile(
                leading: const Icon(Icons.bar_chart_outlined),
                title: const Text('Reports'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => navigate(context, ReportsScreen(app: app)),
              ),
              ListTile(
                leading: const Icon(Icons.request_quote_outlined),
                title: const Text('Quotations'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => navigate(context, QuotationsScreen(app: app)),
              ),
              ListTile(
                leading: const Icon(Icons.description_outlined),
                title: const Text('Business documents'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => navigate(context, DocumentsScreen(app: app)),
              ),
            ],
            if (!app.owner)
              ListTile(
                leading: const Icon(Icons.inbox_outlined),
                title: const Text('Your requests'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => navigate(context, OwnRequestsScreen(app: app)),
              ),
            ListTile(
              leading: const Icon(Icons.sync_outlined),
              title: const Text('Saved work & sync'),
              subtitle: Text(
                '${app.pendingCount} operations need attention or upload',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => navigate(context, OutboxScreen(app: app)),
            ),
            ListTile(
              leading: const Icon(Icons.shield_outlined),
              title: const Text('Security & devices'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => navigate(context, SecurityScreen(app: app)),
            ),
          ],
        ),
      ),
      const SizedBox(height: 24),
      const Text(
        'Bills, catalogue and conversions are stored in an encrypted database on this phone. Unsent work is preserved when you sign out.',
        style: TextStyle(color: muted, fontSize: 12),
      ),
      const SizedBox(height: 16),
      OutlinedButton(
        onPressed: () => app.lock(),
        child: const Text('Lock app'),
      ),
      const SizedBox(height: 12),
      AsyncButton(label: 'Sign out', onPressed: app.signOut),
    ],
  );
}
