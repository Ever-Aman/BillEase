import 'dart:io';
import 'dart:convert';

import 'package:cryptography/cryptography.dart';

import 'package:drift/native.dart';
import 'package:path_provider/path_provider.dart';

import '../data/app_database.dart';
import '../data/cache_store.dart';
import '../core/config.dart';
import '../services/device_identity.dart';
import '../services/secure_vault.dart';

Future<CacheStore> openStore(SecureVault vault, String userId) async {
  if (!RegExp(r'^[0-9a-f-]{36}$').hasMatch(userId)) {
    throw StateError('Invalid account identity');
  }
  final slot = 'database.$userId';
  var key = await vault.read(slot);
  final directory = await getApplicationSupportDirectory();
  final origin = (await Sha256().hash(utf8.encode(AppConfig.apiUrl))).bytes
      .take(8)
      .map((b) => b.toRadixString(16).padLeft(2, '0'))
      .join();
  final file = File(
    '${directory.path}/billease_${AppConfig.environment}_${origin}_$userId.db',
  );
  if (key == null) {
    if (await file.exists()) {
      throw StateError(
        'The local encryption key is missing. Keep app data and contact the owner before resetting this phone.',
      );
    }
    key = randomHex(32);
    await vault.write(slot, key);
  }
  if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(key)) {
    throw StateError('Invalid local encryption key');
  }
  final encryptionKey = key;
  return DriftStore(
    AppDatabase(
      NativeDatabase.createInBackground(
        file,
        setup: (db) {
          if (db.select('PRAGMA cipher').isEmpty) {
            throw StateError(
              'Encrypted SQLite is unavailable; opening a plaintext database is forbidden',
            );
          }
          db.execute("PRAGMA key = '$encryptionKey'");
          db.select('SELECT count(*) FROM sqlite_master');
          db.execute('PRAGMA secure_delete=ON');
        },
      ),
    ),
  );
}
