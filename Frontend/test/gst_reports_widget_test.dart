import 'package:billease_mobile/app_controller.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/preview.dart';
import 'package:billease_mobile/services/secure_vault.dart';
import 'package:billease_mobile/ui/reports_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class GstReportController extends AppController {
  final paths = <String>[];
  bool available = true;
  GstReportController() : super(preview: true, vault: MemoryVault());
  @override
  Future<Json> fetch(String path, {String? cacheKey}) async {
    paths.add(path);
    if (path.startsWith('/reports/gst')) {
      return available
          ? {
              'kind': 'operational_gst_summary',
              'statutory': false,
              'totals': {
                'original': {
                  'baseMinor': '10000',
                  'cgstMinor': '900',
                  'sgstMinor': '900',
                  'igstMinor': '0',
                  'grossMinor': '11800',
                },
                'reversed': {
                  'baseMinor': '5000',
                  'cgstMinor': '450',
                  'sgstMinor': '450',
                  'igstMinor': '0',
                  'grossMinor': '5900',
                },
                'net': {
                  'baseMinor': '5000',
                  'cgstMinor': '450',
                  'sgstMinor': '450',
                  'igstMinor': '0',
                  'grossMinor': '5900',
                },
              },
            }
          : {};
    }
    return {};
  }
}

void main() {
  testWidgets(
    'GST summary follows same report range and displays original reversal and net',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final seed = await previewController();
      final app = GstReportController()
        ..session.data = seed.session.data
        ..business = seed.business;
      await tester.pumpWidget(MaterialApp(home: ReportsScreen(app: app)));
      await tester.pumpAndSettle();
      expect(find.text('Operational GST summary'), findsOneWidget);
      expect(find.textContaining('Original gross: ₹118.00'), findsOneWidget);
      expect(find.textContaining('Reversed gross: ₹59.00'), findsOneWidget);
      expect(find.textContaining('Net CGST: ₹4.50'), findsOneWidget);
      expect(
        Uri.parse(app.paths.firstWhere((p) => p.startsWith('/reports/gst')))
            .queryParameters,
        Uri.parse(
          app.paths.firstWhere((p) => p.startsWith('/reports/overview')),
        ).queryParameters,
      );
      await tester.tap(find.text('Last 24 hours'));
      await tester.pumpAndSettle();
      final periods = app.paths
          .where((p) => p.startsWith('/reports/gst'))
          .map(Uri.parse)
          .toList();
      expect(periods, hasLength(2));
      expect(
        periods.last.queryParameters,
        Uri.parse(app.paths.lastWhere((p) => p.startsWith('/reports/overview')))
            .queryParameters,
      );
      app.available = false;
      await tester.tap(find.text('Last 30 days'));
      await tester.pumpAndSettle();
      expect(find.text('Operational GST summary'), findsNothing);
      app.business = Business(seed.business!.id, seed.business!.name, 'staff');
      app.notifyListeners();
      await tester.pumpAndSettle();
      expect(find.textContaining('Business or access changed'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      app.dispose();
      seed.dispose();
    },
  );
}
