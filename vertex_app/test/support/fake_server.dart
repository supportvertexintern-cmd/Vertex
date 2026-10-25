import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Test doubles shared by the app's tests: a fake HTTP server for Dio and a
/// session in the shape /api/auth/app/login returns.

/// Answers requests from a table instead of the network, and records them.
class FakeServer implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  final bodies = <Map<String, dynamic>?>[];
  final Map<String, List<(int, Object?)>> _answers = {};

  /// Queue an answer for a path; the last one repeats.
  void on(String path, int status, Object? body) => _answers.putIfAbsent(path, () => []).add((status, body));

  /// Replace whatever is queued for a path.
  void only(String path, int status, Object? body) => _answers[path] = [(status, body)];

  int calls(String path) => requests.where((r) => r.path == path).length;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    bodies.add(options.data is Map<String, dynamic> ? options.data as Map<String, dynamic> : null);
    final queue = _answers[options.path];
    if (queue == null || queue.isEmpty) throw DioException.connectionError(requestOptions: options, reason: 'offline');
    final (status, body) = queue.length > 1 ? queue.removeAt(0) : queue.first;
    return ResponseBody.fromString(
      body == null ? '' : jsonEncode(body),
      status,
      headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, dynamic> session({String role = 'director', String access = 'access-1', String refresh = 'refresh-1', Duration ttl = const Duration(minutes: 15)}) => {
      'data': {
        'user': {'id': 'u1', 'email': 'director@test.invalid', 'role': role, 'full_name': 'Dee Rector'},
        'accessToken': access,
        'accessTokenExpiresAt': DateTime.now().add(ttl).toUtc().toIso8601String(),
        'refreshToken': refresh,
        'refreshTokenExpiresAt': DateTime.now().add(const Duration(days: 7)).toUtc().toIso8601String(),
      },
    };
