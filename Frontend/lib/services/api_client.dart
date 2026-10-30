import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../models/models.dart';

class ApiFailure implements Exception {
  final int status;
  final String message;
  final String? outcome, conflictId;
  final int retryAfter;
  ApiFailure(
    this.status,
    this.message, {
    this.outcome,
    this.conflictId,
    this.retryAfter = 30,
  });
  @override
  String toString() => message;
}

class ApiClient {
  final String baseUrl;
  final http.Client transport;
  String? Function()? accessToken;
  Future<void> Function()? renewSession;
  ApiClient(this.baseUrl, {http.Client? transport})
    : transport = transport ?? http.Client();
  Future<http.Response> send(
    String method,
    String path, {
    Json? body,
    String? rawBody,
    String? contentType,
    bool authenticated = true,
    bool retry = true,
  }) async {
    final uri = Uri.parse('${baseUrl.replaceFirst(RegExp(r'/$'), '')}/v1$path');
    final request = http.Request(method, uri);
    request.headers.addAll({
      'Accept': 'application/json',
      if (body != null || rawBody != null) 'Content-Type': contentType ?? 'application/json',
      if (authenticated && accessToken?.call() != null)
        'Authorization': 'Bearer ${accessToken!.call()}',
    });
    if (body != null && rawBody != null) throw StateError('Choose one request body');
    if (body != null) request.body = jsonEncode(body);
    if (rawBody != null) request.body = rawBody;
    final response = await http.Response.fromStream(
      await transport.send(request).timeout(const Duration(seconds: 20)),
    ).timeout(const Duration(seconds: 20));
    if (response.statusCode == 401 &&
        authenticated &&
        retry &&
        renewSession != null) {
      await renewSession!();
      return send(
        method,
        path,
        body: body,
        rawBody: rawBody,
        contentType: contentType,
        authenticated: authenticated,
        retry: false,
      );
    }
    if (response.statusCode >= 400) {
      Json data = {};
      try {
        data = object(jsonDecode(response.body));
      } catch (_) {}
      throw ApiFailure(
        response.statusCode,
        '${data['error'] ?? 'The server could not complete this request'}',
        outcome: data['outcome'],
        conflictId: data['conflictId'],
        retryAfter: int.tryParse(response.headers['retry-after'] ?? '') ?? 30,
      );
    }
    return response;
  }

  Future<Json> request(
    String method,
    String path, {
    Json? body,
    bool authenticated = true,
  }) async {
    final response = await send(
      method,
      path,
      body: body,
      authenticated: authenticated,
    );
    return response.body.isEmpty ? {} : object(jsonDecode(response.body));
  }

  Future<Uint8List> pdf(String path) async =>
      (await send('GET', path)).bodyBytes;
  void close() => transport.close();
}
