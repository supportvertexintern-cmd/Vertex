import 'package:dio/dio.dart';

import 'api_service.dart';

/// A signed-in session as `/api/auth/app/login` and `/refresh` return it
/// (vertex/src/lib/app-auth.ts).
class AuthSession {
  const AuthSession({
    required this.userId,
    required this.email,
    required this.role,
    required this.accessToken,
    required this.accessTokenExpiresAt,
    required this.refreshToken,
    this.fullName,
  });

  factory AuthSession.fromJson(Map<String, dynamic> data) {
    final user = data['user'] as Map<String, dynamic>;
    return AuthSession(
      userId: user['id'] as String,
      email: user['email'] as String,
      role: user['role'] as String,
      fullName: user['full_name'] as String?,
      accessToken: data['accessToken'] as String,
      accessTokenExpiresAt: DateTime.parse(data['accessTokenExpiresAt'] as String),
      refreshToken: data['refreshToken'] as String,
    );
  }

  final String userId;
  final String email;
  final String role;
  final String? fullName;
  final String accessToken;
  final DateTime accessTokenExpiresAt;
  final String refreshToken;
}

/// Sign-in, refresh and sign-out against the Next.js web app, which issues
/// the sessions. Tokens travel in the JSON body; no cookies are involved.
class AuthApi {
  AuthApi({required String baseUrl, Dio? dio})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 15))) {
    _dio.options.headers['Content-Type'] = 'application/json';
    // Errors are read from the body, not thrown by status.
    _dio.options.validateStatus = (_) => true;
  }

  final Dio _dio;

  Future<AuthSession> login(String email, String password) =>
      _session('/api/auth/app/login', {'email': email.trim().toLowerCase(), 'password': password});

  Future<AuthSession> refresh(String refreshToken) => _session('/api/auth/app/refresh', {'refreshToken': refreshToken});

  /// Ends the session server-side. Best effort: signing out locally never
  /// waits on the network.
  Future<void> logout(String refreshToken) async {
    try {
      await _dio.post<dynamic>('/api/auth/app/logout', data: {'refreshToken': refreshToken});
    } catch (_) {}
  }

  Future<AuthSession> _session(String path, Map<String, dynamic> body) async {
    final Response<dynamic> response;
    try {
      response = await _dio.post<dynamic>(path, data: body);
    } on DioException {
      throw const ApiException(0, 'network_error', "Couldn't reach Vertex. Check your connection and try again.");
    }
    final json = response.data;
    if (response.statusCode == 200 && json is Map<String, dynamic> && json['data'] is Map<String, dynamic>) {
      return AuthSession.fromJson(json['data'] as Map<String, dynamic>);
    }
    throw ApiException.fromResponse(response.statusCode ?? 0, json);
  }
}
