import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app.dart';
import 'app_controller.dart';
import 'core/config.dart';
import 'preview.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    AppConfig.validate();
    if (appFlavor != null && appFlavor != AppConfig.environment) {
      throw StateError('The Android flavor and APP_ENV must match');
    }
    final controller = AppConfig.preview
        ? await previewController()
        : AppController();
    runApp(BillEaseApp(controller: controller));
    if (!AppConfig.preview) await controller.boot();
  } catch (_) {
    runApp(
      const MaterialApp(
        home: Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'BillEase could not open safely. Check the app environment and device storage. Your saved data has not been reset.',
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
