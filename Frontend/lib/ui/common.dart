import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/amount.dart';

const ink = Color(0xff1b252d),
    ground = Color(0xfff1f3f5),
    muted = Color(0xff65717c),
    border = Color(0xffe0e5e9);
ThemeData appTheme() => ThemeData(
  useMaterial3: true,
  fontFamily: 'Inter',
  scaffoldBackgroundColor: ground,
  colorScheme: ColorScheme.fromSeed(
    seedColor: ink,
    primary: ink,
    surface: Colors.white,
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: ground,
    foregroundColor: ink,
    elevation: 0,
    centerTitle: false,
  ),
  dividerTheme: const DividerThemeData(color: border, space: 1),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8),
      borderSide: const BorderSide(color: border),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8),
      borderSide: const BorderSide(color: border),
    ),
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size(48, 50),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      minimumSize: const Size(48, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
  ),
  textTheme: const TextTheme(
    headlineLarge: TextStyle(
      fontSize: 32,
      fontWeight: FontWeight.w600,
      letterSpacing: -1,
    ),
    headlineMedium: TextStyle(
      fontSize: 25,
      fontWeight: FontWeight.w600,
      letterSpacing: -.6,
    ),
    titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
    titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
    bodyMedium: TextStyle(fontSize: 14, height: 1.45),
  ),
);

class Panel extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
  });
  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    clipBehavior: Clip.antiAlias,
    shape: RoundedRectangleBorder(
      side: const BorderSide(color: border),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Padding(padding: padding, child: child),
  );
}

class PageBody extends StatelessWidget {
  final List<Widget> children;
  const PageBody({super.key, required this.children});
  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.all(MediaQuery.sizeOf(context).width < 600 ? 20 : 32),
    children: children,
  );
}

class EmptyState extends StatelessWidget {
  final String title, detail;
  const EmptyState(this.title, this.detail, {super.key});
  @override
  Widget build(BuildContext context) => Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(detail, style: const TextStyle(color: muted)),
      ],
    ),
  );
}

class StatusTag extends StatelessWidget {
  final String label;
  final bool attention;
  const StatusTag(this.label, {super.key, this.attention = false});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
    decoration: BoxDecoration(
      color: attention ? const Color(0xfffff3dc) : const Color(0xffeff3f5),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(
      label,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: attention ? const Color(0xff805400) : muted,
      ),
    ),
  );
}

Future<T?> navigate<T>(BuildContext context, Widget page) =>
    Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => page));
String friendlyError(Object error) => error.toString().replaceFirst(
  RegExp(r'^(Bad state: |StateError: |FormatException: |Exception: )'),
  '',
);
void showError(BuildContext context, Object error) {
  if (context.mounted) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(friendlyError(error))));
  }
}

Future<void> perform(
  BuildContext context,
  Future<void> Function() action,
) async {
  try {
    await action();
  } catch (error) {
    if (context.mounted) showError(context, error);
  }
}

class AsyncButton extends StatefulWidget {
  final String label;
  final Future<void> Function() onPressed;
  const AsyncButton({super.key, required this.label, required this.onPressed});
  @override
  State<AsyncButton> createState() => _AsyncButtonState();
}

class _AsyncButtonState extends State<AsyncButton> {
  bool busy = false;
  @override
  Widget build(BuildContext context) => FilledButton(
    onPressed: busy
        ? null
        : () async {
            setState(() => busy = true);
            await perform(context, widget.onPressed);
            if (mounted) setState(() => busy = false);
          },
    child: busy
        ? const SizedBox(
            height: 20,
            width: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Text(widget.label),
  );
}

Future<Map<String, String>?> fieldsDialog(
  BuildContext context, {
  required String title,
  required Map<String, String> fields,
  String confirm = 'Save',
  String? detail,
  Map<String, List<String>> choices = const {},
  Set<String> optionalFields = const {},
}) async {
  final controllers = fields.map(
    (key, value) => MapEntry(key, TextEditingController(text: value)),
  );
  final navigator = Navigator.of(context, rootNavigator: true);
  final route = DialogRoute<Map<String, String>>(
    context: context,
    themes: InheritedTheme.capture(from: context, to: navigator.context),
    barrierColor:
        DialogTheme.of(context).barrierColor ??
        Theme.of(context).dialogTheme.barrierColor ??
        Colors.black54,
    barrierDismissible: true,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 400,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (detail != null) ...[Text(detail), const SizedBox(height: 16)],
              for (final entry in controllers.entries)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: choices.containsKey(entry.key)
                      ? DropdownButtonFormField<String>(
                          initialValue: entry.value.text,
                          decoration: InputDecoration(labelText: entry.key),
                          items: choices[entry.key]!
                              .map(
                                (v) => DropdownMenuItem(
                                  value: v,
                                  child: Text(v.toUpperCase()),
                                ),
                              )
                              .toList(),
                          onChanged: (v) => entry.value.text = v!,
                        )
                      : TextField(
                          controller: entry.value,
                          decoration: InputDecoration(labelText: entry.key),
                        ),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            if (controllers.entries.any(
              (entry) =>
                  !optionalFields.contains(entry.key) &&
                  entry.value.text.trim().isEmpty,
            )) {
              showError(context, 'Complete each field');
              return;
            }
            Navigator.pop(
              context,
              controllers.map((key, value) => MapEntry(key, value.text.trim())),
            );
          },
          child: Text(confirm),
        ),
      ],
    ),
  );
  final result = await navigator.push(route);
  await route.completed;
  for (final controller in controllers.values) {
    controller.dispose();
  }
  return result;
}

class ControllerPage extends StatelessWidget {
  final AppController app;
  final Widget Function(BuildContext) builder;
  const ControllerPage({super.key, required this.app, required this.builder});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: app,
    builder: (context, _) => builder(context),
  );
}

String reviewDetails(
  AppController app,
  Map<String, dynamic> payload, {
  String? targetId,
}) {
  if (payload['operationType'] != null && payload['payload'] is Map) {
    return '${'${payload['operationType']}'.replaceAll('.', ' ')}\n${reviewDetails(app, Map<String, dynamic>.from(payload['payload']), targetId: targetId)}';
  }
  final result = <String>[];
  for (final entry in {
    'name': 'Name',
    'address': 'Address',
    'phone': 'Phone',
    'locality': 'Locality',
    'reference': 'Reference',
    'financialYear': 'Financial year',
    'lastNumber': 'Last document number',
  }.entries) {
    if (payload[entry.key] != null) {
      result.add('${entry.value}: ${payload[entry.key]}');
    }
  }
  final target = payload['billId'] ?? targetId;
  final bill = app.bills
      .where((b) => '${(b['bill'] as Map?)?['id']}' == target)
      .firstOrNull;
  if (bill != null) {
    final header = Map<String, dynamic>.from(bill['bill']);
    final customer = Map<String, dynamic>.from(
      header['customer_snapshot'] as Map? ?? {},
    );
    result.add(
      '${header['financial_year'] ?? ''}/${header['invoice_number'] ?? 'Pending'} · ${customer['name'] ?? header['customer_name'] ?? 'Walk-in'}',
    );
  }
  if (payload['quantityMilli'] != null) {
    result.add(
      'Quantity: ${quantity(int.tryParse("${payload['quantityMilli']}") ?? 0)} of the saved selling unit',
    );
  }
  if (payload['disposition'] != null) {
    result.add('Condition: ${payload['disposition']}');
  }
  if (payload['resolution'] != null) {
    result.add(
      payload['resolution'] == 'advance'
          ? 'Keep the whole remainder as advance after debt reduction.'
          : 'Refund the whole remainder after debt reduction.',
    );
  }
  if (payload['refundMethod'] != null) {
    result.add('Refund by ${payload['refundMethod']}');
  }
  if (payload['reason'] != null) result.add('Reason: ${payload['reason']}');
  if (payload['amountMinor'] != null) {
    result.add('Amount: ${money(payload['amountMinor'])}');
  }
  for (final payment in (payload['payments'] as List? ?? [])) {
    result.add(
      '${'${payment['method']}'.toUpperCase()} · ${money(payment['amountMinor'] ?? payment['amount_minor'])}',
    );
  }
  for (final line in (payload['lines'] as List? ?? [])) {
    final item = app.items.where((i) => i.id == line['itemId']).firstOrNull;
    final unit = item?.units.where((u) => u.id == line['unitId']).firstOrNull;
    result.add(
      '${item?.name ?? 'Saved bill item'} · ${quantity(int.tryParse("${line['quantityMilli']}") ?? 0)} ${unit?.label ?? 'saved unit'} · catalogue v${line['catalogueVersion'] ?? 'saved'}',
    );
  }
  if (result.isEmpty) {
    result.add('Review the original bill and handover before deciding.');
  }
  return result.join('\n');
}

Future<Map<String, dynamic>?> chooseSettlement(BuildContext context) =>
    showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Money remaining after debt reduction'),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, {'resolution': 'advance'}),
            child: const Padding(
              padding: EdgeInsets.all(12),
              child: Text('Keep the whole remainder as advance'),
            ),
          ),
          for (final method in ['cash', 'upi', 'bank'])
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, {
                'resolution': 'refund',
                'refundMethod': method,
              }),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  'Refund the whole remainder · ${method.toUpperCase()}',
                ),
              ),
            ),
        ],
      ),
    );
