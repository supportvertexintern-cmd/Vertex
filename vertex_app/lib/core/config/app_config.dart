import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

/// Where the app finds its two services:
///
/// - [apiBaseUrl]: FastAPI (`.../api/v1`), called with the user's access token.
/// - [authBaseUrl]: the Next.js web app, where the app signs in
///   (`/api/auth/app/*`). Next.js issues the sessions; FastAPI verifies them.
///
/// Native builds take them from `--dart-define=API_BASE_URL=...` and
/// `--dart-define=AUTH_BASE_URL=...`. The web build reads `/config.json`,
/// which its nginx renders from the container's environment
/// (docker/nginx.conf.template), so one image serves any environment.
class AppConfig {
  const AppConfig({required this.apiBaseUrl, required this.authBaseUrl, this.environment = 'development'});

  final String apiBaseUrl;
  final String authBaseUrl;
  final String environment;

  static const fromDefines = AppConfig(
    apiBaseUrl: String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:8001/api/v1'),
    authBaseUrl: String.fromEnvironment('AUTH_BASE_URL', defaultValue: 'http://localhost:3001'),
    environment: String.fromEnvironment('APP_ENV', defaultValue: 'development'),
  );

  static Future<AppConfig> load() async {
    if (!kIsWeb) return fromDefines;
    try {
      final response = await Dio().get<Map<String, dynamic>>(Uri.base.resolve('/config.json').toString());
      final json = response.data ?? const {};
      return AppConfig(
        apiBaseUrl: _nonEmpty(json['apiBaseUrl']) ?? fromDefines.apiBaseUrl,
        authBaseUrl: _nonEmpty(json['authBaseUrl']) ?? fromDefines.authBaseUrl,
        environment: _nonEmpty(json['environment']) ?? fromDefines.environment,
      );
    } catch (_) {
      // `flutter run -d chrome` has no nginx and so no /config.json.
      return fromDefines;
    }
  }

  static String? _nonEmpty(Object? value) => value is String && value.isNotEmpty ? value : null;
}
