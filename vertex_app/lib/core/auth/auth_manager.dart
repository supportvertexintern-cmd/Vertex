import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/services/api_service.dart';
import '../../data/services/auth_api.dart';
import '../config/app_config.dart';
import '../constants/roles.dart';
import 'token_store.dart';

/// The signed-in user. Sessions are the web app's (backend plan step 0.6):
/// [signIn] goes through `/api/auth/app/login`, the refresh token is kept in
/// secure storage ([TokenStore]) and the 15-minute access token in memory,
/// renewed through `/api/auth/app/refresh` before it runs out or after a 401
/// (see [ApiService]). The role is the server's, never chosen here.
class AuthManager extends ChangeNotifier {
  AuthManager({AuthApi? api, TokenStore? store, DateTime Function()? clock})
      : _api = api ?? AuthApi(baseUrl: AppConfig.fromDefines.authBaseUrl),
        _store = store ?? SecureTokenStore(),
        _now = clock ?? DateTime.now;

  final AuthApi _api;
  final TokenStore _store;
  final DateTime Function() _now;

  bool isLoading = true;

  /// The current access token, or null when signed out.
  String? token;
  VertexRole? role;
  String? userId;
  String? email;
  String? fullName;

  String? _refreshToken;
  DateTime? _expiresAt;
  Future<bool>? _refreshing;

  bool get isAuthenticated => token != null && role != null;

  /// At start-up: resumes a stored session, if it is still live.
  Future<void> hydrate() async {
    await _forgetMockSession();
    try {
      final stored = await _store.readRefreshToken();
      if (stored != null) await _accept(await _api.refresh(stored));
    } on ApiException catch (e) {
      // The session ended (401) or the role isn't for this app: sign in
      // again. Offline: keep the token and try again next start.
      if (e.statusCode != 0) await _clear(notify: false);
    }
    isLoading = false;
    notifyListeners();
  }

  /// Signs in; returns the role, or throws [ApiException] with a message to
  /// show (wrong password, unverified email, rate limited, offline, a role
  /// this app isn't for).
  Future<VertexRole> signIn({required String email, required String password}) async {
    if (email.trim().isEmpty || password.isEmpty) {
      throw const ApiException(422, 'validation_error', 'Enter your email address and password.');
    }
    return _accept(await _api.login(email, password));
  }

  /// A usable access token, renewed first when it expires within a minute;
  /// null when signed out.
  Future<String?> accessToken() async {
    if (token == null) return null;
    final expiresAt = _expiresAt;
    if (expiresAt != null && _now().isAfter(expiresAt.subtract(const Duration(minutes: 1)))) {
      await refresh();
    }
    return token;
  }

  /// Renews the session. One refresh at a time: concurrent callers share it,
  /// since presenting a spent refresh token twice would end the session.
  /// False when it couldn't be renewed; if the server ended the session, the
  /// user is signed out.
  Future<bool> refresh() => _refreshing ??= _refresh().whenComplete(() => _refreshing = null);

  Future<bool> _refresh() async {
    final stored = _refreshToken ?? await _store.readRefreshToken();
    if (stored == null) {
      await _clear();
      return false;
    }
    try {
      await _accept(await _api.refresh(stored));
      return true;
    } on ApiException catch (e) {
      if (e.statusCode != 0) await _clear();
      return false;
    }
  }

  Future<void> signOut() async {
    final stored = _refreshToken ?? await _store.readRefreshToken();
    await _clear();
    if (stored != null) await _api.logout(stored);
  }

  Future<VertexRole> _accept(AuthSession session) async {
    final accepted = VertexRole.tryFromWire(session.role);
    if (accepted == null) {
      // Candidates and referral agents have no screens here: end the
      // session the server just opened rather than leave it live.
      await _api.logout(session.refreshToken);
      await _clear();
      throw const ApiException(403, 'unsupported_role', 'This app is for Vertex staff. Please sign in on the website.');
    }
    await _store.writeRefreshToken(session.refreshToken);
    _refreshToken = session.refreshToken;
    _expiresAt = session.accessTokenExpiresAt;
    token = session.accessToken;
    role = accepted;
    userId = session.userId;
    email = session.email;
    fullName = session.fullName;
    notifyListeners();
    return accepted;
  }

  Future<void> _clear({bool notify = true}) async {
    await _store.clear();
    _refreshToken = null;
    _expiresAt = null;
    token = null;
    role = null;
    userId = null;
    email = null;
    fullName = null;
    if (notify) notifyListeners();
  }

  /// The development mock kept a fake token and a chosen role in
  /// SharedPreferences; neither means anything now.
  Future<void> _forgetMockSession() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.remove('auth_token');
      await preferences.remove('auth_role');
    } catch (_) {}
  }
}
