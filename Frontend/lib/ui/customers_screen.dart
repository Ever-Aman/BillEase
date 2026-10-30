import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/amount.dart';
import '../models/models.dart';
import 'common.dart';

class CustomersScreen extends StatefulWidget {
  final AppController app;
  const CustomersScreen({super.key, required this.app});
  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  String search = '';
  Future<void> add() async {
    final result = await fieldsDialog(
      context,
      title: 'Add customer',
      fields: {
        'Name': '',
        'Phone': '',
        'Locality': '',
        'GSTIN (optional)': '',
        'Address (optional)': '',
        'State code (optional)': '',
      },
      optionalFields: const {
        'GSTIN (optional)',
        'Address (optional)',
        'State code (optional)',
      },
    );
    if (result == null || !mounted) return;
    await perform(context, () async {
      await widget.app.saveCustomer(
        result['Name']!,
        result['Phone']!,
        result['Locality']!,
        gstin: result['GSTIN (optional)'],
        address: result['Address (optional)'],
        stateCode: result['State code (optional)'],
      );
    });
  }

  @override
  Widget build(BuildContext context) => PageBody(
    children: [
      Row(
        children: [
          Expanded(
            child: Text(
              'Customers',
              style: Theme.of(context).textTheme.headlineLarge,
            ),
          ),
          IconButton(
            onPressed: add,
            tooltip: 'Add customer',
            icon: const Icon(Icons.person_add_alt_1_outlined),
          ),
        ],
      ),
      const SizedBox(height: 20),
      TextField(
        onChanged: (v) => setState(() => search = v),
        decoration: const InputDecoration(
          hintText: 'Search name, phone or locality',
          prefixIcon: Icon(Icons.search),
        ),
      ),
      const SizedBox(height: 20),
      if (widget.app.customers.isEmpty)
        const EmptyState(
          'Add your first customer',
          'Customer details are available offline after sync.',
        )
      else
        Panel(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (final c in widget.app.customers.where(
                (c) => '${c['name']} ${c['phone']} ${c['locality']}'
                    .toLowerCase()
                    .contains(search.toLowerCase()),
              ))
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  title: Text('${c['name']}'),
                  subtitle: Text('${c['phone']} · ${c['locality']}'),
                  trailing: const Icon(Icons.chevron_right, size: 18),
                  onTap: () => navigate(
                    context,
                    CustomerDetail(app: widget.app, customer: c),
                  ),
                ),
            ],
          ),
        ),
    ],
  );
}

class CustomerDetail extends StatefulWidget {
  final AppController app;
  final Json customer;
  const CustomerDetail({super.key, required this.app, required this.customer});
  @override
  State<CustomerDetail> createState() => _CustomerDetailState();
}

class _CustomerDetailState extends State<CustomerDetail> {
  Json? balance;
  Object? error;
  AppController get app => widget.app;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    if (!app.owner) return;
    final cached = await app.balance('${widget.customer['id']}');
    if (mounted) setState(() => balance = cached);
    try {
      final result = await app.fetch(
        '/customers/${widget.customer['id']}/balance',
        cacheKey: 'balance.${widget.customer['id']}',
      );
      if (mounted) setState(() => balance = result);
    } catch (e) {
      if (mounted) setState(() => error = e);
    }
  }

  Future<void> edit() async {
    final savedScope = app.scope, store = app.store;
    final c =
        app.customers
            .where((c) => c['id'] == widget.customer['id'])
            .firstOrNull ??
        widget.customer;
    final input = await fieldsDialog(
      context,
      title: 'Edit customer',
      fields: {
        'Name': '${c['name'] ?? ''}',
        'Phone': '${c['phone'] ?? ''}',
        'Locality': '${c['locality'] ?? ''}',
        'GSTIN (optional)': '${c['gstin'] ?? ''}',
        'Address (optional)': '${c['address'] ?? ''}',
        'State code (optional)': '${c['stateCode'] ?? ''}',
      },
      optionalFields: const {
        'GSTIN (optional)',
        'Address (optional)',
        'State code (optional)',
      },
    );
    if (input == null ||
        !mounted ||
        app.business == null ||
        app.scope != savedScope ||
        !identical(app.store, store)) {
      return;
    }
    await app.saveCustomer(
      input['Name']!,
      input['Phone']!,
      input['Locality']!,
      id: '${c['id']}',
      gstin: input['GSTIN (optional)'],
      address: input['Address (optional)'],
      stateCode: input['State code (optional)'],
    );
    if (mounted) setState(() {});
  }

  Future<void> repay() async {
    final result = await fieldsDialog(
      context,
      title: 'Record repayment',
      fields: {'Amount in rupees': '', 'Note': ''},
      detail: 'Saved on this phone first. The confirmed balance changes after the server accepts it.',
    );
    if (result == null || !mounted) return;
    await perform(context, () async {
      await app.repayment(
        '${widget.customer['id']}',
        parseAmount(result['Amount in rupees']!, allowZero: false),
        result['Note']!,
      );
      await load();
    });
  }

  Future<void> opening() async {
    final result = await fieldsDialog(
      context,
      title: 'Opening balance',
      fields: {
        'Amount in rupees': '',
        'Kind (debt or advance)': 'debt',
        'Note': '',
      },
      detail: 'Requires a connection. Existing entries are never overwritten.',
    );
    if (result == null || !mounted) return;
    await perform(context, () async {
      final kind = result['Kind (debt or advance)'];
      if (!['debt', 'advance'].contains(kind)) {
        throw StateError('Kind must be debt or advance');
      }
      await app.action('/opening-balances', {
        'customerId': widget.customer['id'],
        'amountMinor': parseAmount(
          result['Amount in rupees']!,
          allowZero: false,
        ),
        'kind': kind,
        'note': result['Note'],
        'operationId': app.newId(),
      });
      await load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final customer =
        app.customers
            .where((c) => c['id'] == widget.customer['id'])
            .firstOrNull ??
        widget.customer;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Customer'),
        actions: [
          IconButton(
            tooltip: 'Edit customer',
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => perform(context, edit),
          ),
        ],
      ),
      body: PageBody(
        children: [
          Text(
            '${customer['name']}',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 8),
          Text(
            '${customer['phone']}\n${customer['locality']}',
            style: const TextStyle(color: muted),
          ),
          if (customer['gstin'] != null) Text('GSTIN: ${customer['gstin']}'),
          if (customer['address'] != null) Text('${customer['address']}'),
          if (customer['stateCode'] != null)
            Text('State: ${customer['stateCode']}'),
          const SizedBox(height: 24),
          if (app.owner) ...[
            if (balance != null)
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (balance!['_stale'] == true)
                      const StatusTag('CACHED BALANCE', attention: true),
                    const Text(
                      'Confirmed account balance',
                      style: TextStyle(color: muted),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'Debt  ${money(balance!['debtMinor'] ?? balance!['debt_minor'])}',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Advance  ${money(balance!['advanceMinor'] ?? balance!['advance_minor'])}',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ],
                ),
              )
            else
              EmptyState(
                'Balance not loaded',
                error == null
                    ? 'Loading confirmed balance…'
                    : 'Connect to load this customer’s balance.',
              ),
            const SizedBox(height: 20),
            AsyncButton(label: 'Record repayment', onPressed: repay),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: opening,
              child: const Text('Add opening balance'),
            ),
            const SizedBox(height: 24),
            TextButton(
              onPressed: () => navigate(
                context,
                CustomerHistory(app: app, id: '${customer['id']}'),
              ),
              child: const Text('Account history & corrections'),
            ),
          ],
          const SizedBox(height: 24),
          Text('Customer bills', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          for (final b in app.bills.where(
            (b) => billHeader(b)['customer_id'] == customer['id'],
          ))
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(billReference(b)),
              subtitle: Text('${billHeader(b)['lifecycle']}'),
              trailing: billHeader(b).containsKey('total_minor')
                  ? Text(money(billHeader(b)['total_minor']))
                  : null,
            ),
        ],
      ),
    );
  }
}

class CustomerHistory extends StatefulWidget {
  final AppController app;
  final String id;
  const CustomerHistory({super.key, required this.app, required this.id});
  @override
  State<CustomerHistory> createState() => _CustomerHistoryState();
}

class _CustomerHistoryState extends State<CustomerHistory> {
  List<Json> rows = [];
  String cursor = '0';
  bool more = true, loading = false;
  String? error;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      final data = await widget.app.fetch(
        '/reports/customers/${widget.id}/history?after=$cursor',
        cacheKey: 'history.${widget.id}.$cursor',
      );
      if (mounted) {
        setState(() {
          rows.addAll(objects(data['events']));
          cursor = '${data['nextCursor']}';
          more = data['hasMore'] == true;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = friendlyError(e));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> correct(Json row) async {
    final input = await fieldsDialog(
      context,
      title: 'Correct ledger entry',
      fields: {'Replacement amount in rupees': '', 'Reason': ''},
      detail: 'The original entry remains in the audit trail.',
    );
    if (input == null || !mounted) return;
    await perform(context, () async {
      await widget.app.action('/ledger-corrections', {
        'entryId': '${row['id']}',
        'reason': input['Reason'],
        'replacement': {
          'amountMinor': parseAmount(
            input['Replacement amount in rupees']!,
            allowZero: false,
          ),
          if (row['source_type'] == 'opening_balance')
            'openingKind':
                BigInt.parse('${row['advance_delta_minor'] ?? 0}') > BigInt.zero
                ? 'advance'
                : 'debt',
        },
        'operationId': widget.app.newId(),
      });
      rows = [];
      cursor = '0';
      await load();
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Account history')),
    body: PageBody(
      children: [
        if (error != null) Text(error!),
        if (rows.isEmpty && !loading)
          const EmptyState(
            'No account entries',
            'Repayments and adjustments will appear here.',
          ),
        for (final row in rows)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              '${row['source_type'] ?? 'Account entry'}'.replaceAll('_', ' '),
            ),
            subtitle: Text(
              'Debt ${money(row['debt_delta_minor'])} · Advance ${money(row['advance_delta_minor'])}\n${row['note'] ?? ''}\n${row['occurrence_at'] ?? ''}',
            ),
            trailing:
                ['opening_balance', 'repayment'].contains(row['source_type'])
                ? IconButton(
                    tooltip: 'Correct entry',
                    onPressed: () => correct(row),
                    icon: const Icon(Icons.edit_outlined),
                  )
                : null,
          ),
        if (loading)
          const Center(child: CircularProgressIndicator())
        else if (more)
          OutlinedButton(onPressed: load, child: const Text('Load more')),
      ],
    ),
  );
}
