import 'dart:async';

import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/preview.dart';
import 'package:billease_mobile/ui/cancellation_dialog.dart';
import 'package:billease_mobile/ui/catalogue_import_screen.dart';
import 'package:billease_mobile/ui/reports_screen.dart';
import 'package:billease_mobile/ui/billing_screen.dart';

class ImportController extends AppController {
  final response = Completer<Json>();
  final sent = <String>[];
  ImportController() : super(preview: true, vault: MemoryVault());
  @override
  Future<dynamic> catalogueText(
    String path, {
    String? csv,
    String? expectedScope,
  }) async {
    sent.add(csv ?? '');
    return response.future;
  }
}

class ReportController extends AppController {
  final paths = <String>[];
  ReportController() : super(preview: true, vault: MemoryVault());
  @override
  Future<Json> fetch(String path, {String? cacheKey}) async {
    paths.add(path);
    if (path.startsWith('/reports/overview')) {
      return {'sales': [], 'confirmedReceipts': [], 'balances': {}};
    }
    return {
      'lines': [
        {
          'id': path.contains('after=') ? 'second' : 'first',
          'item_name': path.contains('after=') ? 'Second item' : 'Saved item',
          'bill_id': 'bill',
          'canonical_unit': 'piece',
          'billed_canonical': '2',
          'delivered_canonical': '1',
          'returned_canonical': '0',
          'cancelled_canonical': '0',
          'pending_canonical': '1',
          'excess_canonical': '0',
        },
      ],
      'nextCursor': 'first',
      'hasMore': !path.contains('after='),
    };
  }
}

void main() {
  testWidgets(
    'copied quotation change warnings stay visible in saved bill draft',
    (tester) async {
      final app = await previewController();
      final id = app.newId();
      final item = app.items.first;
      final line = DraftLine(
        id: app.newId(),
        item: item,
        unit: item.units.first,
        quantityMilli: 1000,
        priceMinor: 70000,
      );
      await app.saveDraft(id, {
        'id': id,
        'quotationId': 'quotation-id',
        'quotationWarnings': [
          'White cement: quoted price ₹70000; current catalogue price ₹78000. The quoted price is retained.',
          'White cement: this catalogue item or unit is unavailable. The saved quotation details are retained.',
        ],
        'lines': [line.toJson()],
      });
      await tester.pumpWidget(
        MaterialApp(
          home: BillingScreen(app: app, draftId: id),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Quotation copied · review before confirming'),
        findsOneWidget,
      );
      expect(find.textContaining('quoted price ₹70000'), findsOneWidget);
      expect(
        find.textContaining('catalogue item or unit is unavailable'),
        findsOneWidget,
      );
      expect(
        find.textContaining('₹700.00 each · catalogue v1'),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox());
      await app.draft(id);
      app.dispose();
    },
  );

  testWidgets(
    'report rows paginate with server cursor and hide on business change',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final seed = await previewController();
      final app = ReportController();
      app.session.data = seed.session.data;
      app.business = seed.business;
      await tester.pumpWidget(MaterialApp(home: ReportsScreen(app: app)));
      await tester.pumpAndSettle();
      expect(find.text('Saved item'), findsOneWidget);
      await tester.tap(find.text('Load more fulfilment rows'));
      await tester.pumpAndSettle();
      expect(app.paths.last, '/reports/fulfilment?after=first');
      expect(find.text('Second item'), findsOneWidget);
      expect(find.text('Load more fulfilment rows'), findsNothing);
      app.business = const Business('new', 'New', 'owner');
      app.notifyListeners();
      await tester.pumpAndSettle();
      expect(find.text('Saved item'), findsNothing);
      expect(
        find.text('Business or access changed. Reopen reports.'),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox());
      app.dispose();
      seed.dispose();
    },
  );
  testWidgets(
    'submitted CSV survives response loss, remains immutable, and late business response cannot update new workspace',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 2000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final seed = await previewController();
      final app = ImportController();
      app.session.data = seed.session.data;
      app.business = seed.business;
      app.store = seed.store;
      final originalScope = app.scope;
      const csv = 'name,operation_id\nदूध,stable-operation\n';
      await app.store!.put(originalScope, '_meta', 'catalogue_csv_import', {
        'csv': csv,
        'state': 'submitted',
      });
      await tester.pumpWidget(
        MaterialApp(home: CatalogueImportScreen(app: app)),
      );
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);
      final retry = find.text('Retry saved import');
      await tester.ensureVisible(retry);
      await tester.tap(retry);
      await tester.pump();
      expect(app.sent, [csv]);
      expect(
        (await app.store!.get(
          originalScope,
          '_meta',
          'catalogue_csv_import',
        ))!['csv'],
        csv,
      );
      app.business = const Business('new-business', 'New', 'owner');
      app.notifyListeners();
      await tester.pump();
      app.response.complete({'imported': 1});
      await tester.pumpAndSettle();
      expect(
        find.text('Business or access changed. Reopen this screen.'),
        findsOneWidget,
      );
      expect(
        (await app.store!.get(
          originalScope,
          '_meta',
          'catalogue_csv_import',
        ))!['csv'],
        csv,
      );
      await tester.pumpWidget(const SizedBox());
      app.dispose();
      seed.dispose();
    },
  );
  testWidgets(
    'cancellation requires selection and returns saved units with exact selected quantity',
    (tester) async {
      Json? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await showDialog<Json>(
                    context: context,
                    builder: (_) => CancellationDialog(
                      lines: [
                        CancellationLine(
                          {'id': 'line', 'item_name': 'Old item'},
                          const [
                            Unit(
                              id: 'saved-box',
                              label: 'Original box',
                              factor: '8',
                              price: 0,
                            ),
                          ],
                          '1',
                          BigInt.zero,
                        ),
                      ],
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pump();
      expect(find.text('Select at least one line'), findsOneWidget);
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Quantity to cancel'),
        '0.126',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Reason'),
        'Customer changed order',
      );
      await tester.tap(find.text('Continue'));
      await tester.pump();
      expect(result, isNull);
      await tester.enterText(
        find.widgetWithText(TextField, 'Quantity to cancel'),
        '0.125',
      );
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(result, {
        'lines': [
          {'lineId': 'line', 'unitId': 'saved-box', 'quantityMilli': 125},
        ],
        'reason': 'Customer changed order',
      });
    },
  );
  testWidgets('staff cannot load catalogue import or pick financial CSV', (
    tester,
  ) async {
    final app = await previewController();
    app.business = Business(app.business!.id, 'Business', 'staff');
    await tester.pumpWidget(MaterialApp(home: CatalogueImportScreen(app: app)));
    await tester.pumpAndSettle();
    expect(find.text('Choose CSV file'), findsNothing);
    expect(find.text('Download / share CSV template'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });
}
