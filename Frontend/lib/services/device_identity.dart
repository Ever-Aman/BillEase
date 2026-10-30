import 'dart:convert';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:uuid/uuid.dart';

import '../core/canonical.dart';
import '../models/models.dart';
import 'secure_vault.dart';

String randomHex(int bytes) => List.generate(
  bytes,
  (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
).join();

class DeviceIdentity {
  final String id;
  final SimpleKeyPairData keyPair;
  DeviceIdentity(this.id, this.keyPair);
  String get publicKey => base64Encode([
    0x30,
    0x2a,
    0x30,
    0x05,
    0x06,
    0x03,
    0x2b,
    0x65,
    0x70,
    0x03,
    0x21,
    0x00,
    ...keyPair.publicKey.bytes,
  ]);
  Future<String> sign(Json message) async => base64Url
      .encode(
        (await Ed25519().sign(
          utf8.encode(canonicalJson(message)),
          keyPair: keyPair,
        )).bytes,
      )
      .replaceAll('=', '');
  static Future<DeviceIdentity> load(SecureVault vault, String email) async {
    final digest = await Sha256().hash(utf8.encode(email.trim().toLowerCase()));
    final key = 'device.${base64Url.encode(digest.bytes)}';
    final old = await vault.read(key);
    if (old != null) {
      final j = object(jsonDecode(old));
      final pair = await Ed25519().newKeyPairFromSeed(base64Decode(j['seed']));
      return DeviceIdentity(j['id'], await pair.extract());
    }
    final pair = await Ed25519().newKeyPair();
    final data = await pair.extract();
    final id = const Uuid().v4();
    await vault.write(
      key,
      jsonEncode({'id': id, 'seed': base64Encode(data.bytes)}),
    );
    return DeviceIdentity(id, data);
  }
}
