import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/config.dart';

abstract class SecureVault {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class DeviceVault extends SecureVault {
  final FlutterSecureStorage storage = const FlutterSecureStorage();
  late final Future<String> _prefix = Sha256()
      .hash(utf8.encode('${AppConfig.environment}/${AppConfig.apiUrl}'))
      .then((h) => 'billease.${base64Url.encode(h.bytes).substring(0, 16)}.');
  @override
  Future<String?> read(String key) async =>
      storage.read(key: '${await _prefix}$key');
  @override
  Future<void> write(String key, String value) async =>
      storage.write(key: '${await _prefix}$key', value: value);
  @override
  Future<void> delete(String key) async =>
      storage.delete(key: '${await _prefix}$key');
}

class MemoryVault extends SecureVault {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    _values.remove(key);
  }
}
