import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:local_auth/local_auth.dart';

import '../models/models.dart';
import 'device_identity.dart';
import 'secure_vault.dart';

class LocalLock {
  final SecureVault vault;
  LocalLock(this.vault);
  Future<bool> hasPin(String userId) async =>
      await vault.read('pin.$userId') != null;
  Future<List<int>> _derive(String pin, List<int> salt) =>
      Pbkdf2(macAlgorithm: Hmac.sha256(), iterations: 210000, bits: 256)
          .deriveKey(secretKey: SecretKey(utf8.encode(pin)), nonce: salt)
          .then((key) => key.extractBytes());
  Future<void> setPin(String userId, String pin) async {
    if (!RegExp(r'^\d{6}$').hasMatch(pin)) {
      throw const FormatException('Choose a six-digit PIN');
    }
    final salt = utf8.encode(randomHex(16));
    final hash = await _derive(pin, salt);
    await vault.write(
      'pin.$userId',
      jsonEncode({
        'salt': base64Encode(salt),
        'hash': base64Encode(hash),
        'failures': 0,
      }),
    );
  }

  Future<bool> verifyPin(String userId, String pin) async {
    final encoded = await vault.read('pin.$userId');
    if (encoded == null) return false;
    final j = object(jsonDecode(encoded));
    final retry = DateTime.tryParse('${j['retryAt']}');
    if (retry != null && retry.isAfter(DateTime.now().toUtc())) {
      throw StateError('Too many attempts. Try again after ${retry.toLocal()}');
    }
    final actual = await _derive(pin, base64Decode(j['salt']));
    final saved = base64Decode(j['hash']);
    var difference = actual.length ^ saved.length;
    for (var i = 0; i < actual.length && i < saved.length; i++) {
      difference |= actual[i] ^ saved[i];
    }
    if (difference == 0) {
      j['failures'] = 0;
      j.remove('retryAt');
    } else {
      final failures = integer(j['failures']) + 1;
      j['failures'] = failures;
      if (failures >= 5) {
        j['retryAt'] = DateTime.now()
            .toUtc()
            .add(
              Duration(
                seconds: (30 * (1 << (failures - 5).clamp(0, 6))).clamp(
                  30,
                  1800,
                ),
              ),
            )
            .toIso8601String();
      }
    }
    await vault.write('pin.$userId', jsonEncode(j));
    return difference == 0;
  }

  Future<bool> deviceUnlock() => LocalAuthentication().authenticate(
    localizedReason: 'Unlock your BillEase records',
    biometricOnly: false,
  );
}
