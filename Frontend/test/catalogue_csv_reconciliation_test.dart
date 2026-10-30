import 'dart:async';

import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/data/cache_store.dart';
import 'package:billease_mobile/preview.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/ui/catalogue_import_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class CsvReviewController extends AppController {
  final paths = <String>[];
  final original = 'immutable CSV,original operation ids\n';
  final reviewResult = <String, dynamic>{
    'items': [
      {
        'status': 'accepted',
        'currentVersion': 2,
        'intent': {
          'name': 'Saved Item',
          'operationId': 'original-op',
          'expectedVersion': 1,
          'units': [],
        },
      },
      {
        'status': 'version_conflict',
        'currentVersion': 3,
        'intent': {
          'name': 'Conflicted Item',
          'operationId': 'conflict-op',
          'expectedVersion': 1,
          'units': [],
        },
      },
    ],
  };
  CsvReviewController() : super(preview: true, vault: MemoryVault());
  @override
  Future<dynamic> catalogueText(
    String path, {
    String? csv,
    String? expectedScope,
  }) async {
    expect(csv, original);
    paths.add(path);
    return reviewResult;
  }
}

Future<CsvReviewController> setup() async {
  final seed = await previewController();
  final app = CsvReviewController()
    ..session.data = seed.session.data
    ..business = seed.business
    ..store = seed.store
    ..booting = false
    ..unlocked = true;
  seed.dispose();
  await app.store!.put(app.scope, '_meta', 'catalogue_csv_import', {
    'csv': app.original,
    'state': 'submitted',
  });
  return app;
}

Future<void> tap(WidgetTester tester, String label) async {
  final button = find.text(label);
  if (button.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      button,
      250,
      scrollable: find.byType(Scrollable).first,
    );
  }
  await tester.ensureVisible(button);
  await tester.tap(button);
  if (label == 'Close reviewed import') {
    await tester.pump(const Duration(milliseconds: 500));
  } else {
    await tester.pumpAndSettle();
  }
}

void main() {
  testWidgets(
    'owner reviews original statuses and explicitly closes with retained exact CSV and note',
    (tester) async {
      tester.view.physicalSize = const Size(1100, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final app = await setup();
      await tester.pumpWidget(
        MaterialApp(home: CatalogueImportScreen(app: app)),
      );
      await tester.pumpAndSettle();
      await tap(tester, 'Review saved import status');
      expect(app.paths, ['/catalogue/import-status']);
      expect(
        (await app.store!.get(
          app.scope,
          '_meta',
          'catalogue_csv_import',
        ))!['state'],
        'review_required',
      );
      expect(find.text('Saved Item · accepted'), findsOneWidget);
      await tap(tester, 'Close reviewed import');
      await tester.enterText(
        find.widgetWithText(TextField, 'Review note'),
        'Compared original operations with server records',
      );
      await tap(tester, 'Close and retain history');
      expect(
        await app.store!.get(app.scope, '_meta', 'catalogue_csv_import'),
        isNull,
      );
      final history = await app.store!.all(app.scope, 'catalogue_csv_history');
      expect(history.single['csv'], app.original);
      expect(history.single['review'], app.reviewResult);
      expect(
        history.single['note'],
        'Compared original operations with server records',
      );
      expect(find.text('Choose CSV file'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      app.dispose();
    },
  );
  testWidgets('stale screen cannot close a replacement journal', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1100, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final app = await setup();
    await tester.pumpWidget(MaterialApp(home: CatalogueImportScreen(app: app)));
    await tester.pumpAndSettle();
    await tap(tester, 'Review saved import status');
    await tap(tester, 'Close reviewed import');
    await tester.enterText(
      find.widgetWithText(TextField, 'Review note'),
      'Reviewed',
    );
    await app.store!.put(app.scope, '_meta', 'catalogue_csv_import', {
      'csv': 'new unrelated CSV',
      'state': 'submitted',
    });
    await tap(tester, 'Close and retain history');
    expect(
      (await app.store!.get(
        app.scope,
        '_meta',
        'catalogue_csv_import',
      ))!['csv'],
      'new unrelated CSV',
    );
    expect(await app.store!.all(app.scope, 'catalogue_csv_history'), isEmpty);
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });
  testWidgets('business change while closing preserves both scoped journals', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1100, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final app = await setup();
    final originalScope = app.scope;
    await tester.pumpWidget(MaterialApp(home: CatalogueImportScreen(app: app)));
    await tester.pumpAndSettle();
    await tap(tester, 'Review saved import status');
    await tap(tester, 'Close reviewed import');
    await tester.enterText(
      find.widgetWithText(TextField, 'Review note'),
      'Reviewed',
    );
    app.business = const Business('other-business', 'Other business', 'owner');
    final otherScope = app.scope;
    await app.store!.put(otherScope, '_meta', 'catalogue_csv_import', {
      'csv': 'other scope CSV',
      'state': 'submitted',
    });
    app.notifyListeners();
    await tap(tester, 'Close and retain history');
    expect(
      (await app.store!.get(
        otherScope,
        '_meta',
        'catalogue_csv_import',
      ))!['csv'],
      'other scope CSV',
    );
    expect(
      (await app.store!.get(
        originalScope,
        '_meta',
        'catalogue_csv_import',
      ))!['csv'],
      app.original,
    );
    expect(
      await app.store!.all(originalScope, 'catalogue_csv_history'),
      isEmpty,
    );
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });
  testWidgets(
    'restored original owner explicitly resumes retained exact CSV for review only',
    (tester) async {
      tester.view.physicalSize = const Size(1100, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final app = await setup();
      await app.store!.purgeScope(app.scope);
      expect(
        await app.store!.all(app.scope, CacheStore.retainedCatalogueCsvKind),
        hasLength(1),
      );
      await tester.pumpWidget(
        MaterialApp(home: CatalogueImportScreen(app: app)),
      );
      await tester.pumpAndSettle();
      expect(app.paths, isEmpty);
      await tap(tester, 'Review retained import');
      expect(app.paths, ['/catalogue/import-status']);
      final pending = await app.store!.get(
        app.scope,
        '_meta',
        'catalogue_csv_import',
      );
      expect(pending!['csv'], app.original);
      expect(pending['state'], 'review_required');
      expect(
        await app.store!.all(app.scope, CacheStore.retainedCatalogueCsvKind),
        isEmpty,
      );
      expect(find.text('Saved Item · accepted'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      app.dispose();
    },
  );
  testWidgets('another account or business cannot see retained CSV', (
    tester,
  ) async {
    final app = await setup();
    final originalScope = app.scope;
    await app.store!.purgeScope(originalScope);
    app.business = const Business('different-business', 'Different', 'owner');
    await tester.pumpWidget(MaterialApp(home: CatalogueImportScreen(app: app)));
    await tester.pumpAndSettle();
    expect(find.text('Review retained import'), findsNothing);
    expect(app.paths, isEmpty);
    expect(
      await app.store!.all(originalScope, CacheStore.retainedCatalogueCsvKind),
      hasLength(1),
    );
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });
  test(
    'CSV work queue excludes concurrent manual and automatic actions',
    () async {
      final app = CsvReviewController(),
          gate = Completer<void>(),
          events = <String>[];
      final first = app.catalogueImportWork(() async {
        events.add('retry');
        await gate.future;
        events.add('confirmed');
      });
      final second = app.catalogueImportWork(() async {
        events.add('review');
      });
      await Future<void>.delayed(Duration.zero);
      expect(events, ['retry']);
      gate.complete();
      await Future.wait([first, second]);
      expect(events, ['retry', 'confirmed', 'review']);
      app.dispose();
    },
  );
}
