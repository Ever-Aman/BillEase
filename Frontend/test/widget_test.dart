import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/app.dart';
import 'package:billease_mobile/preview.dart';

void main() {
  for (final width in [390.0, 900.0, 1440.0]) {
    testWidgets('workspace and bill builder fit width $width', (tester) async {
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = await previewController();
      await tester.pumpWidget(BillEaseApp(controller: controller));
      await tester.pumpAndSettle();
      expect(find.text('Shree Traders'), findsOneWidget);
      expect(find.text('New bill'), findsOneWidget);
      await tester.tap(find.text('New bill'));
      await tester.pumpAndSettle();
      expect(find.text('Add item'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
    });
  }
  testWidgets(
    'cash billing flow saves a local bill with one immutable upload',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final app = await previewController();
      await tester.pumpWidget(BillEaseApp(controller: app));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New bill'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add item'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('White cement'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save item'));
      await tester.pumpAndSettle();
      final cash = find.widgetWithText(TextField, 'Cash');
      await tester.ensureVisible(cash);
      await tester.enterText(cash, '780');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      final confirm = find.text('Confirm & save bill');
      await tester.ensureVisible(confirm);
      await tester.pumpAndSettle();
      await tester.tap(confirm);
      await tester.pumpAndSettle();
      expect(find.text('SAVED ON PHONE'), findsOneWidget);
      final jobs = await app.store!.jobs(app.scope);
      expect(jobs.single.kind, 'bill');
      expect(jobs.single.payload['payments'][0]['amountMinor'], 78000);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      app.dispose();
    },
  );
}
