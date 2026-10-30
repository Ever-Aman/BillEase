import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app_controller.dart';
import '../core/amount.dart';
import '../models/models.dart';
import 'common.dart';
import 'billing_screen.dart';
import 'bill_detail.dart';
import 'customers_screen.dart';
import 'manage_screen.dart';
import 'inbox_screen.dart';

class Workspace extends StatefulWidget {
  final AppController app;
  const Workspace({super.key, required this.app});
  @override
  State<Workspace> createState() => _WorkspaceState();
}

class _WorkspaceState extends State<Workspace> {
  int selected = 0;
  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    if (app.openInbox) {
      app.openInbox = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) navigate(context, InboxScreen(app: app));
      });
    }
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final content = [
      HomeScreen(app: app),
      BillsScreen(app: app),
      CustomersScreen(app: app),
      ManageScreen(app: app),
    ][selected];
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 20,
        title: PopupMenuButton<Business>(
          onSelected: app.chooseBusiness,
          itemBuilder: (_) => app.session.data!.businesses
              .map(
                (b) => PopupMenuItem(
                  value: b,
                  child: Text('${b.name} · ${b.role}'),
                ),
              )
              .toList(),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  app.business!.name,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const Icon(Icons.expand_more, size: 20),
            ],
          ),
        ),
        actions: [
          if (app.owner)
            IconButton(
              tooltip: 'Approvals',
              onPressed: () => navigate(context, InboxScreen(app: app)),
              icon: Badge(
                isLabelVisible: app.approvalCount > 0,
                label: Text('${app.approvalCount}'),
                child: const Icon(Icons.inbox_outlined),
              ),
            ),
          IconButton(
            tooltip: 'Sync now',
            onPressed: app.syncing ? null : app.sync,
            icon: app.syncing
                ? const SizedBox(
                    width: 19,
                    height: 19,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.sync),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          if (app.preview)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 7),
              color: const Color(0xfffff3dc),
              child: const Text(
                'UI PREVIEW · Sample business data',
                style: TextStyle(fontSize: 11, color: Color(0xff805400)),
              ),
            ),
          if (!app.lease)
            MaterialBanner(
              content: const Text(
                'Connect to renew offline access. Your saved work is kept.',
              ),
              actions: [
                TextButton(onPressed: app.sync, child: const Text('Reconnect')),
              ],
            ),
          if (app.notice != null)
            MaterialBanner(
              content: Text(app.notice!),
              actions: [
                TextButton(
                  onPressed: app.acknowledgeNotice,
                  child: const Text('Dismiss'),
                ),
              ],
            ),
          Expanded(
            child: Row(
              children: [
                if (wide)
                  NavigationRail(
                    selectedIndex: selected,
                    onDestinationSelected: (value) =>
                        setState(() => selected = value),
                    labelType: NavigationRailLabelType.all,
                    destinations: const [
                      NavigationRailDestination(
                        icon: Icon(Icons.space_dashboard_outlined),
                        label: Text('Today'),
                      ),
                      NavigationRailDestination(
                        icon: Icon(Icons.receipt_long_outlined),
                        label: Text('Bills'),
                      ),
                      NavigationRailDestination(
                        icon: Icon(Icons.people_outline),
                        label: Text('Customers'),
                      ),
                      NavigationRailDestination(
                        icon: Icon(Icons.tune),
                        label: Text('Manage'),
                      ),
                    ],
                  ),
                Expanded(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1040),
                      child: content,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: selected,
              onDestinationSelected: (value) =>
                  setState(() => selected = value),
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.space_dashboard_outlined),
                  label: 'Today',
                ),
                NavigationDestination(
                  icon: Icon(Icons.receipt_long_outlined),
                  label: 'Bills',
                ),
                NavigationDestination(
                  icon: Icon(Icons.people_outline),
                  label: 'Customers',
                ),
                NavigationDestination(icon: Icon(Icons.tune), label: 'Manage'),
              ],
            ),
    );
  }
}

class HomeScreen extends StatelessWidget {
  final AppController app;
  const HomeScreen({super.key, required this.app});
  @override
  Widget build(BuildContext context) {
    final now = DateTime.now().toUtc().add(
      const Duration(hours: 5, minutes: 30),
    );
    final accepted = app.bills
        .where(
          (b) =>
              billHeader(b)['invoice_number'] != null &&
              (app.owner || b['localOwned'] == true),
        )
        .toList();
    final today = accepted.where((b) {
      final date = DateTime.tryParse('${billHeader(b)['issued_at']}')
          ?.toUtc()
          .add(const Duration(hours: 5, minutes: 30));
      return date != null &&
          date.year == now.year &&
          date.month == now.month &&
          date.day == now.day;
    }).toList();
    final total = today.fold<int>(
      0,
      (sum, b) => sum + integer(billHeader(b)['total_minor']),
    );
    return RefreshIndicator(
      onRefresh: app.sync,
      child: PageBody(
        children: [
          Text(
            DateFormat('EEEE, d MMMM').format(now),
            style: const TextStyle(color: muted),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Today',
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
              ),
              FilledButton.icon(
                onPressed: app.lease
                    ? () => navigate(context, BillingScreen(app: app))
                    : null,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New bill'),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  app.owner
                      ? 'Synced bills · today'
                      : 'Your phone’s bills · today',
                  style: const TextStyle(color: muted),
                ),
                const SizedBox(height: 10),
                if (app.owner)
                  Text(
                    money(total),
                    style: Theme.of(context).textTheme.headlineLarge,
                  )
                else
                  Text(
                    '${today.length} bills',
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                const SizedBox(height: 12),
                Text(
                  '${today.length} accepted bill${today.length == 1 ? '' : 's'}${app.pendingCount == 0 ? '' : '  ·  ${app.pendingCount} operations saved on this phone'}',
                  style: const TextStyle(color: muted, fontSize: 12),
                ),
                const SizedBox(height: 20),
                const Divider(),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Icon(
                      app.connected || app.preview
                          ? Icons.cloud_done_outlined
                          : Icons.cloud_off_outlined,
                      size: 17,
                      color: muted,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        app.preview
                            ? 'Sample workspace'
                            : app.syncing
                            ? 'Syncing saved work…'
                            : app.connected
                            ? 'Connected · encrypted local copy ready'
                            : 'Offline · saved work stays on this phone',
                        style: const TextStyle(fontSize: 12, color: muted),
                      ),
                    ),
                  ],
                ),
                if (app.syncError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(
                      app.syncError!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xff805400),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          if (app.owner && app.approvalCount > 0) ...[
            Panel(
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${app.approvalCount} to review',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Staff requests, credit and payments',
                          style: TextStyle(color: muted, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: () => navigate(context, InboxScreen(app: app)),
                    child: const Text('Open inbox'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],
          Row(
            children: [
              Expanded(
                child: Text(
                  'Recent bills',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              const Text(
                'Billed / handed over',
                style: TextStyle(fontSize: 11, color: muted),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (app.bills.isEmpty)
            const EmptyState(
              'Ready for your first bill',
              'Sync your catalogue, add a customer and start billing.',
            )
          else
            Panel(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  for (final b in app.bills.take(5)) BillRow(app: app, bill: b),
                ],
              ),
            ),
          const SizedBox(height: 20),
          DraftsPanel(app: app),
        ],
      ),
    );
  }
}

class BillRow extends StatelessWidget {
  final AppController app;
  final Json bill;
  const BillRow({super.key, required this.app, required this.bill});
  @override
  Widget build(BuildContext context) {
    final header = billHeader(bill), pending = header['invoice_number'] == null;
    final delivery = app.delivery(bill), lines = objects(delivery['lines']);
    final completed =
        lines.isNotEmpty &&
        lines.every(
          (l) => nanos('${l['pending_canonical'] ?? '0'}') == BigInt.zero,
        );
    return InkWell(
      onTap: () => navigate(context, BillDetail(app: app, id: billId(bill))),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    billCustomer(bill),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                if (header.containsKey('total_minor'))
                  Text(
                    money(header['total_minor']),
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                const SizedBox(width: 8),
                const Icon(Icons.chevron_right, size: 18, color: muted),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  billReference(bill),
                  style: const TextStyle(fontSize: 11, color: muted),
                ),
                StatusTag(
                  pending
                      ? 'SAVED ON PHONE'
                      : header['review_state'] == 'credit_pending'
                      ? 'CREDIT REVIEW'
                      : completed
                      ? 'HANDED OVER'
                      : 'DELIVERY OPEN',
                  attention:
                      pending || header['review_state'] == 'credit_pending',
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class BillsScreen extends StatefulWidget {
  final AppController app;
  const BillsScreen({super.key, required this.app});
  @override
  State<BillsScreen> createState() => _BillsScreenState();
}

class _BillsScreenState extends State<BillsScreen> {
  String search = '';
  bool pending = false;
  @override
  Widget build(BuildContext context) {
    final rows = widget.app.bills
        .where(
          (b) =>
              '${billCustomer(b)} ${billReference(b)}'.toLowerCase().contains(
                search.toLowerCase(),
              ) &&
              (!pending || billHeader(b)['invoice_number'] == null),
        )
        .toList();
    return PageBody(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Bills',
                style: Theme.of(context).textTheme.headlineLarge,
              ),
            ),
            FilledButton.icon(
              onPressed: () =>
                  navigate(context, BillingScreen(app: widget.app)),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('New bill'),
            ),
          ],
        ),
        const SizedBox(height: 20),
        TextField(
          onChanged: (v) => setState(() => search = v),
          decoration: const InputDecoration(
            hintText: 'Search customer or bill number',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: FilterChip(
            label: const Text('Saved on phone'),
            selected: pending,
            onSelected: (v) => setState(() => pending = v),
          ),
        ),
        const SizedBox(height: 12),
        if (rows.isEmpty)
          const EmptyState(
            'No bills here yet',
            'Try another search or create a new bill.',
          )
        else
          Panel(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (final b in rows) BillRow(app: widget.app, bill: b),
              ],
            ),
          ),
      ],
    );
  }
}

class DraftsPanel extends StatelessWidget {
  final AppController app;
  const DraftsPanel({super.key, required this.app});
  @override
  Widget build(BuildContext context) => FutureBuilder<List<Json>>(
    future: app.store!.all(app.scope, 'draft'),
    builder: (context, snapshot) {
      final rows = snapshot.data ?? [];
      if (rows.isEmpty) return const SizedBox();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Unfinished drafts',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 12),
          for (final row in rows)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('${objects(row['lines']).length} items'),
              subtitle: const Text('Prices saved with this draft'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => navigate(
                context,
                BillingScreen(app: app, draftId: '${row['id']}'),
              ),
            ),
        ],
      );
    },
  );
}
