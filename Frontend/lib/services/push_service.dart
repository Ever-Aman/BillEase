import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';

class PushService {
  final List<StreamSubscription> _subscriptions = [];
  bool _started = false;
  Future<void> start(
    ApiClient api,
    String deviceId,
    void Function(Map<String, dynamic>) onNotice,
  ) async {
    if (_started || kIsWeb) return;
    if (Firebase.apps.isEmpty) await Firebase.initializeApp();
    final messaging = FirebaseMessaging.instance;
    final permission = await messaging.requestPermission();
    if (permission.authorizationStatus != AuthorizationStatus.authorized &&
        permission.authorizationStatus != AuthorizationStatus.provisional) {
      return;
    }
    await messaging.setAutoInitEnabled(true);
    Future<void> register(String token) async {
      await api.request(
        'PUT',
        '/devices/$deviceId/push-token',
        body: {'token': token},
      );
    }

    _subscriptions.add(
      messaging.onRegistered.listen((token) {
        unawaited(register(token).catchError((_) {}));
      }),
    );
    await messaging.register();
    _subscriptions.add(
      FirebaseMessaging.onMessage.listen((message) => onNotice(message.data)),
    );
    _subscriptions.add(
      FirebaseMessaging.onMessageOpenedApp.listen(
        (message) => onNotice({...message.data, 'opened': true}),
      ),
    );
    final initial = await messaging.getInitialMessage();
    if (initial != null) onNotice({...initial.data, 'opened': true});
    _started = true;
  }

  Future<void> stop() async {
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
    _subscriptions.clear();
    _started = false;
    if (!kIsWeb && Firebase.apps.isNotEmpty) {
      try {
        await FirebaseMessaging.instance.setAutoInitEnabled(false);
        await FirebaseMessaging.instance.unregister();
      } catch (_) {}
    }
  }
}
