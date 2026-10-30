import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/preview.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/ui/catalogue_screen.dart';
import 'package:billease_mobile/ui/billing_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class GstItemController extends AppController {
  Json? saved;
  GstItemController() : super(preview: true, vault: MemoryVault());
  @override
  Future<void> saveItem(Json value) async {
    saved = value;
  }
}

void main() {
  testWidgets('catalogue editor preserves GST fields when changing name', (
    tester,
  ) async {
    final seed = await previewController();
    final app = GstItemController()
      ..session.data = seed.session.data
      ..business = seed.business
      ..store = seed.store;
    final item = Item.fromJson({
      ...seed.items.first.toJson(),
      'hsn': '1001',
      'gstRateBps': 1250,
      'taxCategory': 'taxable',
    });
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: ItemEditor(app: app, item: item),
      ),
    );
    expect(find.widgetWithText(TextField, 'HSN (4–8 digits)'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Renamed');
    await tester.ensureVisible(find.text('Save catalogue revision'));
    await tester.tap(find.text('Save catalogue revision'));
    await tester.pumpAndSettle();
    expect(app.saved?['hsn'], '1001');
    expect(app.saved?['gstRateBps'], 1250);
    expect(app.saved?['taxCategory'], 'taxable');
    await tester.pumpWidget(const SizedBox());
    app.dispose();
    seed.dispose();
  });
  testWidgets('new bill defaults place of supply to business state', (
    tester,
  ) async {
    final app = await previewController();
    final b = app.business!;
    app.business = Business(
      b.id,
      b.name,
      b.role,
      documentMode: 'composition',
      stateCode: '29',
    );
    await tester.pumpWidget(MaterialApp(home: BillingScreen(app: app)));
    await tester.pumpAndSettle();
    final field = tester.widget<TextField>(
      find.widgetWithText(TextField, 'Place of supply · state code'),
    );
    expect(field.controller!.text, '29');
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });
  testWidgets('place of supply is retained in an offline bill draft', (
    tester,
  ) async {
    final app = await previewController();
    final b = app.business!;
    app.business = Business(b.id, b.name, b.role, documentMode: 'regular_gst');
    final id = app.newId();
    await app.saveDraft(id, {'id': id, 'lines': [], 'placeOfSupply': '29'});
    await tester.pumpWidget(
      MaterialApp(
        home: BillingScreen(app: app, draftId: id),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.widgetWithText(TextField, 'Place of supply · state code'),
      findsOneWidget,
    );
    final field = tester.widget<TextField>(
      find.widgetWithText(TextField, 'Place of supply · state code'),
    );
    expect(field.controller!.text, '29');
    await tester.enterText(
      find.widgetWithText(TextField, 'Place of supply · state code'),
      '27',
    );
    await tester.pump(const Duration(milliseconds: 400));
    expect((await app.draft(id))!['placeOfSupply'], '27');
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });
}
