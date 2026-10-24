import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vertex_app/core/auth/auth_manager.dart';
import 'package:vertex_app/core/auth/token_store.dart';
import 'package:vertex_app/core/constants/roles.dart';
import 'package:vertex_app/data/services/api_service.dart';
import 'package:vertex_app/data/services/auth_api.dart';

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

void main() {
  late FakeServer web;
  late FakeServer backend;
  late MemoryTokenStore store;
  late AuthManager auth;
  late ApiService api;

  setUp(() {
    SharedPreferences.setMockInitialValues({'auth_token': 'mobile-development-session', 'auth_role': 'admin'});
    web = FakeServer();
    backend = FakeServer();
    store = MemoryTokenStore();
    final webDio = Dio(BaseOptions(baseUrl: 'http://web.test'))..httpClientAdapter = web;
    final backendDio = Dio(BaseOptions(baseUrl: 'http://api.test/api/v1'))..httpClientAdapter = backend;
    auth = AuthManager(api: AuthApi(baseUrl: 'http://web.test', dio: webDio), store: store);
    api = ApiService(baseUrl: 'http://api.test/api/v1', auth: auth, dio: backendDio);
  });

  group('sign-in', () {
    test('uses the server role and keeps only the refresh token', () async {
      web.on('/api/auth/app/login', 200, session());
      final role = await auth.signIn(email: ' Director@Test.invalid ', password: 'pw');

      expect(role, VertexRole.director);
      expect(auth.isAuthenticated, isTrue);
      expect(auth.token, 'access-1');
      expect(auth.fullName, 'Dee Rector');
      expect(store.token, 'refresh-1');
      expect(web.bodies.single, {'email': 'director@test.invalid', 'password': 'pw'});
    });

    test("shows the server's message for a wrong password and stays signed out", () async {
      web.on('/api/auth/app/login', 401, {'error': 'Invalid email or password.'});
      await expectLater(
        auth.signIn(email: 'x@test.invalid', password: 'bad'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Invalid email or password.').having((e) => e.statusCode, 'status', 401)),
      );
      expect(auth.isAuthenticated, isFalse);
      expect(store.token, isNull);
    });

    test('reads the error envelope too (rate limited)', () async {
      web.on('/api/auth/app/login', 429, {'error': {'code': 'rate_limited', 'message': 'Too many login attempts. Please try again later.'}});
      await expectLater(auth.signIn(email: 'x@test.invalid', password: 'pw'),
          throwsA(isA<ApiException>().having((e) => e.code, 'code', 'rate_limited')));
    });

    test('offline is a clear message, not a crash', () async {
      await expectLater(auth.signIn(email: 'x@test.invalid', password: 'pw'),
          throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 0)));
    });

    test('refuses an account this app has no screens for, and ends its session', () async {
      web.on('/api/auth/app/login', 200, session(role: 'candidate', refresh: 'cand-refresh'));
      web.on('/api/auth/app/logout', 200, {'data': {'signedOut': true}});
      await expectLater(auth.signIn(email: 'c@test.invalid', password: 'pw'),
          throwsA(isA<ApiException>().having((e) => e.code, 'code', 'unsupported_role')));
      expect(auth.isAuthenticated, isFalse);
      expect(store.token, isNull);
      expect(web.bodies.last, {'refreshToken': 'cand-refresh'});
    });

    test('an unknown role never falls back to another one', () {
      expect(VertexRole.tryFromWire('candidate'), isNull);
      expect(VertexRole.tryFromWire('referral_agent'), isNull);
      expect(VertexRole.tryFromWire('finance'), VertexRole.finance);
    });
  });

  group('start-up', () {
    test('resumes a stored session through a refresh', () async {
      store.token = 'stored';
      web.on('/api/auth/app/refresh', 200, session(refresh: 'rotated'));
      await auth.hydrate();
      expect(auth.isLoading, isFalse);
      expect(auth.role, VertexRole.director);
      expect(store.token, 'rotated');
      expect(web.bodies.single, {'refreshToken': 'stored'});
    });

    test('a session the server ended means signing in again', () async {
      store.token = 'stored';
      web.on('/api/auth/app/refresh', 401, {'error': {'code': 'session_ended', 'message': 'Please sign in again.'}});
      await auth.hydrate();
      expect(auth.isAuthenticated, isFalse);
      expect(store.token, isNull);
    });

    test('offline keeps the stored session for next time', () async {
      store.token = 'stored';
      await auth.hydrate();
      expect(auth.isAuthenticated, isFalse);
      expect(store.token, 'stored');
    });

    test("forgets the old mock's fake token and chosen role", () async {
      await auth.hydrate();
      final preferences = await SharedPreferences.getInstance();
      expect(preferences.getString('auth_token'), isNull);
      expect(preferences.getString('auth_role'), isNull);
    });
  });

  group('calling FastAPI', () {
    setUp(() async {
      web.on('/api/auth/app/login', 200, session());
      await auth.signIn(email: 'director@test.invalid', password: 'pw');
    });

    test('sends the access token and unwraps data', () async {
      backend.on('/me', 200, {'data': {'id': 'u1', 'email': 'director@test.invalid', 'role': 'director'}});
      final me = await api.get('/me');
      expect(me['role'], 'director');
      expect(backend.requests.single.headers['Authorization'], 'Bearer access-1');
    });

    test('a 401 renews the session once and repeats the request', () async {
      backend.on('/me', 401, {'error': {'code': 'unauthorized', 'message': 'Not authenticated'}});
      backend.on('/me', 200, {'data': {'id': 'u1'}});
      web.on('/api/auth/app/refresh', 200, session(access: 'access-2', refresh: 'refresh-2'));

      expect((await api.get('/me'))['id'], 'u1');
      expect(backend.requests.map((r) => r.headers['Authorization']), ['Bearer access-1', 'Bearer access-2']);
      expect(store.token, 'refresh-2');
    });

    test('if the renewal fails, the user is signed out', () async {
      backend.on('/me', 401, {'error': {'code': 'unauthorized', 'message': 'Not authenticated'}});
      web.on('/api/auth/app/refresh', 401, {'error': {'code': 'session_ended', 'message': 'Please sign in again.'}});
      web.on('/api/auth/app/logout', 200, {'data': {'signedOut': true}});

      await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));
      expect(auth.isAuthenticated, isFalse);
      expect(store.token, isNull);
    });

    test('renews ahead of time when the access token is about to run out', () async {
      web.only('/api/auth/app/login', 200, session(access: 'short', ttl: const Duration(seconds: 30)));
      await auth.signIn(email: 'director@test.invalid', password: 'pw');
      web.on('/api/auth/app/refresh', 200, session(access: 'fresh'));
      backend.on('/me', 200, {'data': {}});

      await api.get('/me');
      expect(backend.requests.single.headers['Authorization'], 'Bearer fresh');
    });

    test('concurrent 401s share one refresh (a spent token presented twice would end the session)', () async {
      backend.on('/a', 401, {'error': {'code': 'unauthorized', 'message': 'x'}});
      backend.on('/a', 200, {'data': 1});
      backend.on('/b', 401, {'error': {'code': 'unauthorized', 'message': 'x'}});
      backend.on('/b', 200, {'data': 2});
      web.on('/api/auth/app/refresh', 200, session(access: 'access-2', refresh: 'refresh-2'));

      expect(await Future.wait([api.get('/a'), api.get('/b')]), [1, 2]);
      expect(web.calls('/api/auth/app/refresh'), 1);
    });

    test("turns FastAPI's error envelope into a message with its details", () async {
      backend.on('/fee-policy', 422, {
        'error': {'code': 'validation_error', 'message': 'Validation failed', 'details': {'amount': ['Field required']}},
      });
      await expectLater(
        api.put('/fee-policy', {}),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', 'validation_error')
            .having((e) => e.details, 'details', {'amount': ['Field required']})),
      );
    });

    test('passes a page through whole', () async {
      backend.on('/things', 200, {'data': [1, 2], 'total': 2, 'page': 1, 'pageSize': 15});
      expect(await api.page('/things'), {'data': [1, 2], 'total': 2, 'page': 1, 'pageSize': 15});
      expect(backend.requests.single.queryParameters, {'page': 1, 'pageSize': 15});
    });

    test('signing out ends the session on the server too', () async {
      web.on('/api/auth/app/logout', 200, {'data': {'signedOut': true}});
      await auth.signOut();
      expect(auth.isAuthenticated, isFalse);
      expect(store.token, isNull);
      expect(web.bodies.last, {'refreshToken': 'refresh-1'});
      await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));
    });
  });
}
