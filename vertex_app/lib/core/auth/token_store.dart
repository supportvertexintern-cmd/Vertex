import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the refresh token lives between app starts. Only the refresh token
/// is kept: the 15-minute access token stays in memory and is renewed from
/// it. On phones it is the Keychain (iOS) or the Keystore (Android), never
/// SharedPreferences, which is plain text on disk.
abstract class TokenStore {
  Future<String?> readRefreshToken();
  Future<void> writeRefreshToken(String token);
  Future<void> clear();
}

class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'vertex_refresh_token';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> readRefreshToken() => _storage.read(key: _key);

  @override
  Future<void> writeRefreshToken(String token) => _storage.write(key: _key, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

/// For tests, and anywhere secure storage isn't available.
class MemoryTokenStore implements TokenStore {
  String? token;

  @override
  Future<String?> readRefreshToken() async => token;

  @override
  Future<void> writeRefreshToken(String value) async => token = value;

  @override
  Future<void> clear() async => token = null;
}
