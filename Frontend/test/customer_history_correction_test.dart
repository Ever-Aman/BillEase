import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/preview.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/ui/customers_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class HistoryCorrectionController extends AppController {
  final Json entry;
  Json? correction;

  HistoryCorrectionController(this.entry)
    : super(preview: true, vault: MemoryVault());

  @override
  Future<Json> fetch(String path, {String? cacheKey}) async => {
    'events': [entry],
    'nextCursor': '0',
    'hasMore': false,
  };

  @override
  Future<Json> action(
    String path,
    Json body, {
    String method = 'POST',
    bool refresh = true,
  }) async {
    expect(path, '/ledger-corrections');
    correction = Map<String, dynamic>.from(body);
    return {'corrected': true};
  }
}

void main() {
  for (final testCase in [
    (
      name: 'opening debt sends debt kind',
      source: 'opening_balance',
      debt: '2500',
      advance: '0',
      expectedKind: 'debt',
    ),
    (
      name: 'opening advance sends advance kind',
      source: 'opening_balance',
      debt: '0',
      advance: '2500',
      expectedKind: 'advance',
    ),
    (
      name: 'repayment replacement keeps repayment payload',
      source: 'repayment',
      debt: '-2500',
      advance: '0',
      expectedKind: null,
    ),
  ]) {
    testWidgets(testCase.name, (tester) async {
      final seed = await previewController();
      final app = HistoryCorrectionController({
        'id': 'entry-1',
        'source_type': testCase.source,
        'debt_delta_minor': testCase.debt,
        'advance_delta_minor': testCase.advance,
        'note': 'Imported opening amount',
        'occurrence_at': '2026-04-01T00:00:00Z',
      })
        ..session.data = seed.session.data
        ..business = seed.business
        ..store = seed.store
        ..booting = false
        ..unlocked = true;

      await tester.pumpWidget(
        MaterialApp(home: CustomerHistory(app: app, id: 'customer-1')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Correct entry'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).at(0), '12.34');
      await tester.enterText(find.byType(TextField).at(1), 'Corrected amount');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(app.correction, isNotNull);
      final replacement = app.correction!['replacement'] as Json;
      expect(replacement['amountMinor'], 1234);
      if (testCase.expectedKind == null) {
        expect(replacement.containsKey('openingKind'), isFalse);
      } else {
        expect(replacement['openingKind'], testCase.expectedKind);
      }

      await tester.pumpWidget(const SizedBox.shrink());
      app.dispose();
      seed.dispose();
    });
  }
}
