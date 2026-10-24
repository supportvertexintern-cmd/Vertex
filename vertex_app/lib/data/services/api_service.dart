import 'package:dio/dio.dart';

import '../../core/auth/auth_manager.dart';

/// Calls FastAPI (backend plan step 0.6) as the signed-in user:
///
/// - sends the access token as `Authorization: Bearer`, renewed first when
///   it is about to run out;
/// - on a 401, renews the session once and repeats the request; if that
///   fails too, the user is signed out (the server ended the session);
/// - unwraps FastAPI's `{"data": ...}` and turns its
///   `{"error": {"code", "message", "details"}}` into an [ApiException]
///   (vertex_be/app/core/api.py).
class ApiService {
  ApiService({required String baseUrl, required this.auth, Dio? dio})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 20))) {
    _dio.options.headers['Content-Type'] = 'application/json';
    // Errors are read from the body, not thrown by status.
    _dio.options.validateStatus = (_) => true;
  }

  final AuthManager auth;
  final Dio _dio;

  /// The `data` of a successful response.
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async => (await _request('GET', path, query: query))['data'];

  Future<dynamic> post(String path, Object? body) async => (await _request('POST', path, body: body))['data'];

  Future<dynamic> put(String path, Object? body) async => (await _request('PUT', path, body: body))['data'];

  Future<dynamic> delete(String path) async => (await _request('DELETE', path))['data'];

  /// The whole body of a list response: `{data, total, page, pageSize}`.
  Future<Map<String, dynamic>> page(String path, {int page = 1, int pageSize = 15, Map<String, dynamic>? query}) =>
      _request('GET', path, query: {...?query, 'page': page, 'pageSize': pageSize});

  Future<Map<String, dynamic>> _request(String method, String path, {Object? body, Map<String, dynamic>? query}) async {
    var response = await _once(method, path, body, query);
    if (response.statusCode == 401 && await auth.refresh()) {
      response = await _once(method, path, body, query);
    }
    if (response.statusCode == 401) {
      // The server says the session is over even after a renewal.
      await auth.signOut();
    }
    final status = response.statusCode ?? 0;
    final json = response.data;
    if (status == 204) return const {'data': null};
    if (status >= 200 && status < 300 && json is Map<String, dynamic> && json.containsKey('data')) return json;
    throw ApiException.fromResponse(status, json);
  }

  Future<Response<dynamic>> _once(String method, String path, Object? body, Map<String, dynamic>? query) async {
    final token = await auth.accessToken();
    if (token == null) throw const ApiException(401, 'unauthorized', 'Please sign in.');
    try {
      return await _dio.request<dynamic>(
        path,
        data: body,
        queryParameters: query,
        options: Options(method: method, headers: {'Authorization': 'Bearer $token'}),
      );
    } on DioException {
      throw const ApiException(0, 'network_error', "Couldn't reach Vertex. Check your connection and try again.");
    }
  }
}

/// An error from either service, with a message fit to show the user.
/// [statusCode] 0 means the request never got an answer (offline, timeout).
class ApiException implements Exception {
  const ApiException(this.statusCode, this.code, this.message, {this.details});

  /// Reads both error shapes the services use: `{"error": {"code",
  /// "message", "details"}}` and the older `{"error": "message"}`.
  factory ApiException.fromResponse(int statusCode, Object? body) {
    final error = body is Map<String, dynamic> ? body['error'] : null;
    if (error is Map<String, dynamic>) {
      return ApiException(
        statusCode,
        error['code'] as String? ?? 'error',
        error['message'] as String? ?? _fallback(statusCode),
        details: error['details'],
      );
    }
    if (error is String && error.isNotEmpty) return ApiException(statusCode, _codeFor(statusCode), error);
    return ApiException(statusCode, _codeFor(statusCode), _fallback(statusCode));
  }

  final int statusCode;
  final String code;
  final String message;
  final Object? details;

  static String _codeFor(int status) => switch (status) {
        400 => 'bad_request',
        401 => 'unauthorized',
        403 => 'forbidden',
        404 => 'not_found',
        422 => 'validation_error',
        429 => 'rate_limited',
        _ => 'error',
      };

  static String _fallback(int status) => switch (status) {
        429 => 'Too many attempts. Please wait a minute and try again.',
        >= 500 => 'Something went wrong on our side. Please try again.',
        _ => 'Something went wrong. Please try again.',
      };

  @override
  String toString() => 'ApiException($statusCode, $code): $message';
}
