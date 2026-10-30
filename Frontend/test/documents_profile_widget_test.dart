import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/preview.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/ui/documents_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class DocumentProfileController extends AppController {
  final actions = <({String path, Json body, String method})>[];

  DocumentProfileController() : super(preview: true, vault: MemoryVault());

  @override
  Future<Json> fetch(String path, {String? cacheKey}) async {
    if (path == '/settings/document-series') return {'series': []};
    if (path == '/settings/document-profile') {
      return {
        'profile': {
          'name': 'Saved supplier',
          'address': '12 Market Road',
          'phone': '9876543210',
          'gstin': '29ABCDE1234F1Z5',
          'signatory': 'Saved owner',
          'stateCode': '29',
        },
        'version': 4,
        'mode': 'unconfigured',
      };
    }
    return {};
  }

  @override
  Future<Json> action(
    String path,
    Json body, {
    String method = 'POST',
    bool refresh = true,
  }) async {
    actions.add((
      path: path,
      body: Map<String, dynamic>.from(body),
      method: method,
    ));
    return {'version': 5};
  }
}

void main() {
  testWidgets(
    'GST business does not offer non GST activation or accountant block',
    (tester) async {
      final seed = await previewController();
      final app = DocumentProfileController()
        ..session.data = seed.session.data
        ..business = Business(
          seed.business!.id,
          seed.business!.name,
          'owner',
          documentMode: 'composition',
        )
        ..store = seed.store
        ..booting = false
        ..unlocked = true;
      await tester.pumpWidget(MaterialApp(home: DocumentsScreen(app: app)));
      await tester.pumpAndSettle();
      expect(find.text('Activate non-GST billing'), findsNothing);
      expect(find.textContaining('accountant-approved'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      app.dispose();
      seed.dispose();
    },
  );

  testWidgets(
    'blank optional legal fields save while required fields validate',
    (tester) async {
      final seed = await previewController();
      final app = DocumentProfileController()
        ..session.data = seed.session.data
        ..business = seed.business
        ..store = seed.store
        ..booting = false
        ..unlocked = true;
      await tester.pumpWidget(MaterialApp(home: DocumentsScreen(app: app)));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Edit business details'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).at(0), '');
      await tester.enterText(find.byType(TextField).at(3), '');
      await tester.enterText(find.byType(TextField).at(4), '');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(find.text('Complete each field'), findsOneWidget);
      expect(app.actions, isEmpty);

      await tester.enterText(find.byType(TextField).at(0), 'Updated supplier');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(app.actions, hasLength(1));
      expect(app.actions.single.body.containsKey('gstin'), isFalse);
      expect(app.actions.single.body.containsKey('signatory'), isFalse);

      await tester.pumpWidget(const SizedBox());
      app.dispose();
      seed.dispose();
    },
  );

  testWidgets('profile save preserves and normalizes loaded legal details', (
    tester,
  ) async {
    final seed = await previewController();
    final app = DocumentProfileController()
      ..session.data = seed.session.data
      ..business = seed.business
      ..store = seed.store
      ..booting = false
      ..unlocked = true;
    await tester.pumpWidget(MaterialApp(home: DocumentsScreen(app: app)));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit business details'));
    await tester.pumpAndSettle();
    final fields = tester
        .widgetList<TextField>(find.byType(TextField))
        .toList();
    expect(fields, hasLength(6));
    expect(fields[5].controller!.text, '29');
    expect(fields[3].controller!.text, '29ABCDE1234F1Z5');
    expect(fields[4].controller!.text, 'Saved owner');

    await tester.enterText(find.byType(TextField).at(3), '  29abcde1234f1z5  ');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(app.actions, hasLength(1));
    expect(app.actions.single.path, '/settings/document-profile');
    expect(app.actions.single.method, 'PUT');
    expect(app.actions.single.body['gstin'], '29ABCDE1234F1Z5');
    expect(app.actions.single.body['signatory'], 'Saved owner');
    expect(app.actions.single.body['stateCode'], '29');

    await tester.pumpWidget(const SizedBox());
    app.dispose();
    seed.dispose();
  });
}
