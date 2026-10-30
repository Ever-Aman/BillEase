import 'package:flutter/foundation.dart';

class AppConfig {
  static const environment = String.fromEnvironment(
    'APP_ENV',
    defaultValue: 'development',
  );
  static const preview = bool.fromEnvironment('UI_PREVIEW');
  static const apiUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );
  static bool get production => environment == 'production';
  static void validate() {
    if (!['development', 'production'].contains(environment)) {
      throw StateError('Unknown app environment');
    }
    if (production && preview) {
      throw StateError('Preview data is forbidden in production');
    }
    final uri = Uri.parse(apiUrl);
    if (uri.host.isEmpty ||
        !['http', 'https'].contains(uri.scheme) ||
        uri.userInfo.isNotEmpty) {
      throw StateError('A valid backend address is required');
    }
    if (production && uri.scheme != 'https') {
      throw StateError('Production requires an HTTPS backend');
    }
    if (kIsWeb && !preview) {
      throw StateError(
        'Use the Android app for encrypted business storage. Browser UI preview requires UI_PREVIEW=true.',
      );
    }
  }
}
