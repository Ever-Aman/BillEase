import 'dart:convert';

import '../models/models.dart';
import 'api_client.dart';
import 'device_identity.dart';
import 'secure_vault.dart';

class SessionData {
  final String userId, email, access, refresh;
  final DateTime expires, offlineExpires;
  final int clockOffsetMs;
  final List<Business> businesses;
  final bool admin;
  SessionData({
    required this.userId,
    required this.email,
    required this.access,
    required this.refresh,
    required this.expires,
    required this.offlineExpires,
    required this.businesses,
    this.clockOffsetMs = 0,
    this.admin = false,
  });
  bool get owner => admin || businesses.any((b) => b.owner);
  Json toJson() => {
    'userId': userId,
    'email': email,
    'access': access,
    'refresh': refresh,
    'expires': expires.toIso8601String(),
    'offlineExpires': offlineExpires.toIso8601String(),
    'businesses': businesses.map((b) => b.toJson()).toList(),
    'offset': clockOffsetMs,
    'admin': admin,
  };
  factory SessionData.fromJson(Json j) => SessionData(
    userId: j['userId'],
    email: j['email'],
    access: j['access'],
    refresh: j['refresh'],
    expires: DateTime.parse(j['expires']),
    offlineExpires: DateTime.parse(j['offlineExpires']),
    businesses: objects(j['businesses']).map(Business.fromJson).toList(),
    clockOffsetMs: integer(j['offset']),
    admin: j['admin'] == true,
  );
}

class SessionService {
  final SecureVault vault;
  final ApiClient api;
  SessionData? data;
  DeviceIdentity? identity;
  Future<void>? _refreshing;
  bool uncertainRefresh = false;
  Future<void> Function()? onInvalidated;
  SessionService(this.vault, this.api) {
    api.accessToken = () => data?.access;
    api.renewSession = refresh;
  }
  Future<void> restore() async {
    final encoded = await vault.read('session');
    if (encoded == null) return;
    data = SessionData.fromJson(object(jsonDecode(encoded)));
    identity = await DeviceIdentity.load(vault, data!.email);
    uncertainRefresh = await vault.read('refresh_pending') == 'true';
  }

  Future<void> signIn(
    String email,
    String password, {
    String? mfaCode,
    String? recoveryCode,
  }) async {
    await flushLogout();
    identity = await DeviceIdentity.load(vault, email);
    final result = await api.request(
      'POST',
      '/auth/login',
      authenticated: false,
      body: {
        'email': email.trim(),
        'password': password,
        'deviceId': identity!.id,
        'deviceName': 'BillEase Android',
        'devicePublicKey': identity!.publicKey,
        if (mfaCode?.isNotEmpty == true) 'mfaCode': mfaCode,
        if (recoveryCode?.isNotEmpty == true) 'recoveryCode': recoveryCode,
      },
    );
    await _accept(result, email.trim());
    await loadMemberships();
  }

  Future<void> _accept(
    Json result,
    String email, {
    List<Business>? previous,
  }) async {
    final token = '${result['accessToken']}';
    final payload = object(
      jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(token.split('.')[1]))),
      ),
    );
    final now = DateTime.now().toUtc();
    final authorized = DateTime.parse(result['lastAuthorizedAt']).toUtc();
    final businesses = objects(result['memberships']).map((j) {
      final old = (previous ?? data?.businesses ?? [])
          .where((b) => b.id == j['business_id'] && b.role == j['role'])
          .firstOrNull;
      return Business(
        '${j['business_id']}',
        old?.name ?? 'Business',
        '${j['role']}',
        documentMode: j['documentMode'] as String? ?? old?.documentMode,
        stateCode: j['stateCode'] as String? ?? old?.stateCode,
      );
    }).toList();
    data = SessionData(
      userId: '${payload['sub']}',
      email: email,
      access: token,
      refresh: '${result['refreshToken']}',
      expires: now.add(Duration(seconds: integer(result['expiresIn']) - 30)),
      offlineExpires: DateTime.parse(result['offlineExpiresAt']),
      businesses: businesses,
      clockOffsetMs: authorized.difference(now).inMilliseconds,
      admin: data?.admin ?? false,
    );
    uncertainRefresh = false;
    await vault.delete('refresh_pending');
    await vault.write('lastObserved', now.toIso8601String());
    await _persist();
  }

  Future<void> _persist() async {
    if (data != null) await vault.write('session', jsonEncode(data!.toJson()));
  }

  Future<void> loadMemberships() async {
    final result = await api.request('GET', '/me/businesses');
    final me = await api.request('GET', '/me');
    final old = data!;
    data = SessionData(
      userId: old.userId,
      email: old.email,
      access: old.access,
      refresh: old.refresh,
      expires: old.expires,
      offlineExpires: old.offlineExpires,
      clockOffsetMs: old.clockOffsetMs,
      businesses: objects(result['businesses']).map(Business.fromJson).toList(),
      admin: object(me['user'])['isAdmin'] == true,
    );
    await _persist();
  }

  Future<void> refresh() async {
    if (_refreshing != null) return _refreshing;
    final future = _doRefresh();
    _refreshing = future;
    try {
      await future;
    } finally {
      _refreshing = null;
    }
  }

  Future<void> _doRefresh() async {
    if (data == null || uncertainRefresh) {
      throw ApiFailure(
        401,
        'Sign in again to reconnect. Your unsent work is kept.',
      );
    }
    final old = data!;
    await vault.write('refresh_pending', 'true');
    uncertainRefresh = true;
    try {
      final result = await api.request(
        'POST',
        '/auth/refresh',
        authenticated: false,
        body: {'refreshToken': old.refresh},
      );
      await _accept(result, old.email, previous: old.businesses);
    } on ApiFailure catch (error) {
      if (error.status == 401 || error.status == 403) {
        try {
          await onInvalidated?.call();
        } finally {
          await clearTokens();
        }
      }
      rethrow;
    }
  }

  Future<void> ensureOnline() async {
    if (data == null) throw ApiFailure(401, 'Sign in to reconnect');
    if (DateTime.now().toUtc().isAfter(data!.expires)) await refresh();
  }

  Future<bool> leaseValid() async {
    if (data == null) return false;
    final now = DateTime.now().toUtc();
    final last = DateTime.tryParse(await vault.read('lastObserved') ?? '');
    if (last != null &&
        now.isBefore(last.subtract(const Duration(minutes: 2)))) {
      return false;
    }
    if (last == null || now.isAfter(last)) {
      await vault.write('lastObserved', now.toIso8601String());
    }
    return now
        .add(Duration(milliseconds: data!.clockOffsetMs))
        .isBefore(data!.offlineExpires);
  }

  Future<void> clearTokens() async {
    data = null;
    await vault.delete('session');
    await vault.delete('refresh_pending');
  }

  Future<void> flushLogout() async {
    final pending = await vault.read('logout_pending');
    if (pending == null) return;
    final tokens = List<String>.from(jsonDecode(pending));
    for (final token in [...tokens]) {
      try {
        await api.request(
          'POST',
          '/auth/logout',
          authenticated: false,
          body: {'refreshToken': token},
        );
        tokens.remove(token);
      } catch (_) {
        /* Retry revocation before the next online sign-in. */
      }
    }
    if (tokens.isEmpty) {
      await vault.delete('logout_pending');
    } else {
      await vault.write('logout_pending', jsonEncode(tokens));
    }
  }

  Future<void> signOut() async {
    if (data != null) {
      final pending = await vault.read('logout_pending');
      final tokens = pending == null
          ? <String>[]
          : List<String>.from(jsonDecode(pending));
      if (!tokens.contains(data!.refresh)) tokens.add(data!.refresh);
      await vault.write('logout_pending', jsonEncode(tokens));
      await flushLogout();
    }
    await clearTokens();
  }
}
