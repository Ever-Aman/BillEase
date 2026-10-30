import "dart:async";

import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/preview.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/ui/documents_screen.dart';
import 'package:billease_mobile/ui/inbox_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class RecoveryInboxController extends AppController {
  final List<Json> rows;
  final actions = <({String path, Json body})>[];
  final fetched = <String>[];
  Json actionResult = {};
  Completer<Json>? fetchOverride;

  RecoveryInboxController(this.rows)
    : super(preview: true, vault: MemoryVault());

  @override
  Future<Json> fetch(String path, {String? cacheKey}) async {
    fetched.add(path);
    if (path == '/conflicts' && fetchOverride != null) {
      return fetchOverride!.future;
    }
    if (path == '/conflicts') return {'conflicts': []};
    if (path == '/quarantine') return {'operations': rows};
    return {};
  }

  @override
  Future<Json> action(
    String path,
    Json body, {
    String method = 'POST',
    bool refresh = true,
  }) async {
    actions.add((path: path, body: Map<String, dynamic>.from(body)));
    return actionResult;
  }
}

Future<RecoveryInboxController> inboxFor(List<Json> rows) async {
  final seed = await previewController();
  final app = RecoveryInboxController(rows)
    ..session.data = seed.session.data
    ..business = seed.business
    ..store = seed.store
    ..booting = false
    ..unlocked = true;
  seed.dispose();
  return app;
}

Future<void> settleDialog(WidgetTester tester) async {
  await tester.pumpAndSettle();
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  testWidgets(
    'retained nonfinancial work requires an explicit owner resolution',
    (tester) async {
      final app = await inboxFor([
        {
          'device_id': 'phone-1',
          'operation_id': 'op-1',
          'payload_type': 'document_profile',
          'payload': {'name': 'Old supplier'},
          'decision': 'pending',
          'manual_reconciliation_available': true,
          'original_actor_email': 'staff@example.test',
        },
      ]);
      await tester.pumpWidget(MaterialApp(home: InboxScreen(app: app)));
      await tester.pumpAndSettle();

      expect(find.text('Recovered phone work'), findsOneWidget);
      expect(find.text('Original account: staff@example.test'), findsOneWidget);
      expect(find.text('Resolve retained work'), findsOneWidget);
      expect(find.text('Accept & apply'), findsNothing);
      await tester.tap(find.text('Resolve retained work'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('does not execute the original action'),
        findsOneWidget,
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Review note'),
        'Verified in records',
      );
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle(const Duration(milliseconds: 400));

      expect(app.actions, hasLength(1));
      expect(app.actions.single.path, '/quarantine/phone-1/op-1/reconcile');
      expect(app.actions.single.body['resolution'], 'already_applied');
      expect(app.actions.single.body['note'], 'Verified in records');
      expect(app.actions.single.body['decisionOperationId'], isA<String>());
      await tester.pumpWidget(const SizedBox());
      app.dispose();
    },
  );

  testWidgets('financial recovery entry does not offer manual reconciliation', (
    tester,
  ) async {
    final app = await inboxFor([
      {
        'device_id': 'phone-2',
        'operation_id': 'payment-1',
        'payload_type': 'payment_confirmation',
        'payload': {'amountMinor': 12000},
        'decision': 'pending',
        'manual_reconciliation_available': false,
      },
    ]);
    await tester.pumpWidget(MaterialApp(home: InboxScreen(app: app)));
    await tester.pumpAndSettle();

    expect(find.text('Resolve retained work'), findsNothing);
    expect(find.text('Accept & apply'), findsOneWidget);
    expect(find.text('Reject'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });

  testWidgets('unsupported recovery response is reported as retained', (
    tester,
  ) async {
    final app =
        await inboxFor([
            {
              'device_id': 'phone-3',
              'operation_id': 'unsupported-1',
              'payload_type': 'unknown_operation',
              'payload': {'secret': 'opaque'},
              'decision': 'pending',
              'manual_reconciliation_available': false,
            },
          ])
          ..actionResult = {
            'status': 'retained',
            'reason': 'Unsupported recovery payload',
          };
    await tester.pumpWidget(MaterialApp(home: InboxScreen(app: app)));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Accept & apply'));
    await tester.pumpAndSettle();
    final reasonField = tester.widget<TextField>(
      find.widgetWithText(TextField, 'Reason'),
    );
    await tester.enterText(find.byWidget(reasonField), 'Review');
    await tester.pump();
    expect(reasonField.controller!.text, 'Review');
    await tester.tap(find.text('Save'));
    await settleDialog(tester);
    expect(find.text('Accept recovered work'), findsNothing);
    expect(app.actions, hasLength(1));
    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.text('Unsupported recovery payload'), findsOneWidget);
    expect(
      app.actions.single.path,
      '/quarantine/phone-3/unsupported-1/decision',
    );
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });

  testWidgets(
    'inbox ignores rows fetched for a business that is no longer selected',
    (tester) async {
      final pending = Completer<Json>();
      final app = await inboxFor([]);
      app.fetched.clear();
      app.fetchOverride = pending;
      await tester.pumpWidget(MaterialApp(home: InboxScreen(app: app)));
      await tester.pump();
      expect(app.fetched, contains('/conflicts'));

      app.business = const Business('different-business', 'Different', 'owner');
      app.notifyListeners();
      pending.complete({'conflicts': []});
      await tester.pumpAndSettle();
      expect(app.fetched, isNot(contains('/quarantine')));

      await tester.pumpWidget(const SizedBox());
      app.dispose();
    },
  );

  testWidgets(
    'profile dialog cannot submit after the selected business changes',
    (tester) async {
      final app = await inboxFor([]);
      await tester.pumpWidget(MaterialApp(home: DocumentsScreen(app: app)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Edit business details'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Supplier name'),
        'Changed supplier',
      );
      app.business = const Business('different-business', 'Different', 'owner');
      app.notifyListeners();
      await tester.tap(find.text('Save'));
      await settleDialog(tester);
      expect(app.actions, isEmpty);

      await tester.pumpWidget(const SizedBox());
      app.dispose();
    },
  );
}
