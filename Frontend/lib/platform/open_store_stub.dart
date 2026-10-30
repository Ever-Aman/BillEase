import '../data/cache_store.dart';
import '../services/secure_vault.dart';

Future<CacheStore> openStore(SecureVault vault, String userId) async =>
    throw UnsupportedError(
      'Encrypted operational storage requires the Android app',
    );
