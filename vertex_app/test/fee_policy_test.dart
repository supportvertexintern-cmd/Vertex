import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vertex_app/core/auth/auth_manager.dart';
import 'package:vertex_app/core/auth/fee_policy_store.dart';
import 'package:vertex_app/core/auth/token_store.dart';
import 'package:vertex_app/data/models/fee_policy.dart';
import 'package:vertex_app/data/repositories/fee_policy_repository.dart';
import 'package:vertex_app/data/services/api_service.dart';
import 'package:vertex_app/data/services/auth_api.dart';
import 'package:vertex_app/presentation/director/fee_policy_screen.dart';

import 'support/fake_server.dart';

/// Policies as FastAPI serves them (GET /api/v1/fee-policy).
Map<String, dynamic> policyJson({
  String id = 'p1',
  String? countryId = 'c1',
  String? countryName = 'Kenya',
  bool enabled = true,
  num? documentation = 2500,
  num? permit = 5000,
  num? visa,
  String currency = 'KES',
}) =>
    {
      'id': id,
      'country_id': countryId,
      'enabled': enabled,
      'documentation_amount': documentation,
      'permit_amount': permit,
      'visa_amount': visa,
      'currency': currency,
      'updated_by': 'u1',
      'updated_at': '2026-10-24T12:00:00.000Z',
      'country': countryName == null ? null : {'name': countryName},
    };

void main() {
  late FakeServer web;
  late FakeServer backend;
  late AuthManager auth;
  late FeePolicyStore store;

  Future<void> signIn(String role) async {
    web.only('/api/auth/app/login', 200, session(role: role));
    await auth.signIn(email: 'x@test.invalid', password: 'pw');
  }

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    web = FakeServer();
    backend = FakeServer();
    auth = AuthManager(
      api: AuthApi(baseUrl: 'http://web.test', dio: Dio(BaseOptions(baseUrl: 'http://web.test'))..httpClientAdapter = web),
      store: MemoryTokenStore(),
    );
    final api = ApiService(
      baseUrl: 'http://api.test/api/v1',
      auth: auth,
      dio: Dio(BaseOptions(baseUrl: 'http://api.test/api/v1'))..httpClientAdapter = backend,
    );
    store = FeePolicyStore(FeePolicyRepository(api));
  });

  group('model', () {
    test("reads FastAPI's JSON, the global default included", () {
      final local = FeePolicy.fromJson(policyJson(documentation: 2500, visa: null));
      expect((local.countryName, local.documentationAmount, local.visaAmount, local.currency), ('Kenya', 2500.0, null, 'KES'));
      expect(local.updatedAt.toUtc(), DateTime.utc(2026, 10, 24, 12));

      final global = FeePolicy.fromJson(policyJson(countryId: null, countryName: null));
      expect((global.countryId, global.countryName), (null, null));
    });

    test('saves the whole policy for its country', () {
      expect(FeePolicy.fromJson(policyJson(visa: null)).toSaveJson(), {
        'country_id': 'c1',
        'enabled': true,
        'documentation_amount': 2500.0,
        'permit_amount': 5000.0,
        'visa_amount': null,
        'currency': 'KES',
      });
    });
  });

  group('store', () {
    setUp(() => signIn('director'));

    test('loads the policies from FastAPI', () async {
      backend.on('/fee-policy', 200, {'data': [policyJson(), policyJson(id: 'p2', countryId: null, countryName: null, enabled: false)]});
      await store.load();
      expect(store.hasLoaded, isTrue);
      expect(store.policies.map((p) => p.id), ['p1', 'p2']);
      expect(backend.requests.single.method, 'GET');
      expect(backend.requests.single.headers['Authorization'], 'Bearer access-1');
    });

    test("shows the server's message when loading fails", () async {
      backend.on('/fee-policy', 403, {'error': {'code': 'forbidden', 'message': 'Forbidden. Insufficient role.'}});
      await store.load();
      expect(store.hasLoaded, isFalse);
      expect(store.loadError, 'Forbidden. Insufficient role.');
    });

    test('a save sends the change and shows what the server stored, first', () async {
      backend.on('/fee-policy', 200, {'data': [policyJson(id: 'p2', countryName: 'Ghana', countryId: 'c2'), policyJson()]});
      await store.load();
      backend.only('/fee-policy', 200, {'data': policyJson(enabled: false)});

      await store.save(store.policies[1], enabled: false);

      expect(backend.bodies.last, {
        'country_id': 'c1', 'enabled': false, 'documentation_amount': 2500.0, 'permit_amount': 5000.0, 'visa_amount': null, 'currency': 'KES',
      });
      expect(store.policies.map((p) => (p.id, p.enabled)), [('p1', false), ('p2', true)]);
      expect(store.savingId, isNull);
    });

    test('a refused save throws the message and leaves the list as it was', () async {
      backend.on('/fee-policy', 200, {'data': [policyJson()]});
      await store.load();
      backend.only('/fee-policy', 422, {
        'error': {'code': 'validation_error', 'message': 'Validation failed', 'details': {'visa_amount': ['Input should be greater than 0']}},
      });

      await expectLater(store.save(store.policies.single, amountsChanged: true, visaAmount: -1),
          throwsA(isA<ApiException>().having((e) => e.code, 'code', 'validation_error')));
      expect(store.policies.single.visaAmount, isNull);
      expect(store.savingId, isNull);
    });
  });

  group('screen', () {
    // Dio's timers don't run on the widget tests' fake clock, so the screen
    // gets a repository that answers at once. The HTTP path is covered above.
    late FakeRepository repository;

    Future<void> pump(WidgetTester tester, String role) async {
      await tester.runAsync(() => signIn(role));
      store = FeePolicyStore(repository);
      tester.view.physicalSize = const Size(390, 844) * 3;
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final router = GoRouter(
        initialLocation: '/management/fee-policy',
        routes: [GoRoute(path: '/management/fee-policy', builder: (_, _) => const FeePolicyScreen())],
      );
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: auth),
          ChangeNotifierProvider.value(value: store),
        ],
        child: MaterialApp.router(routerConfig: router),
      ));
      await tester.pumpAndSettle();
    }

    setUp(() => repository = FakeRepository());

    testWidgets('shows the real policies, with edit controls for a director', (tester) async {
      repository.policies = [FeePolicy.fromJson(policyJson()), FeePolicy.fromJson(policyJson(id: 'p2', countryId: null, countryName: null, enabled: false, currency: 'USD'))];
      await pump(tester, 'director');

      expect(find.text('Kenya'), findsOneWidget);
      expect(find.text('Global'), findsOneWidget);
      expect(find.text('1 of 2 policies enabled.'), findsOneWidget);
      expect(find.text('KES 2,500'), findsOneWidget);
      expect(find.text('EDIT FEES'), findsNWidgets(2));
      expect(tester.widget<Switch>(find.byType(Switch).first).onChanged, isNotNull);
    });

    testWidgets('switching a policy off saves it', (tester) async {
      repository.policies = [FeePolicy.fromJson(policyJson())];
      await pump(tester, 'admin');
      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      expect(repository.saved.single.enabled, isFalse);
      expect(find.text('Kenya policy disabled.'), findsOneWidget);
    });

    testWidgets('a reader sees the policies but cannot change them', (tester) async {
      repository.policies = [FeePolicy.fromJson(policyJson())];
      await pump(tester, 'finance');

      expect(find.text('Kenya'), findsOneWidget);
      expect(find.text('EDIT FEES'), findsNothing);
      expect(tester.widget<Switch>(find.byType(Switch)).onChanged, isNull);
    });

    testWidgets('a failed load offers to try again', (tester) async {
      repository.error = const ApiException(0, 'network_error', "Couldn't reach Vertex. Check your connection and try again.");
      await pump(tester, 'director');

      expect(find.textContaining("Couldn't reach Vertex"), findsOneWidget);
      repository
        ..error = null
        ..policies = [FeePolicy.fromJson(policyJson())];
      await tester.tap(find.text('TRY AGAIN'));
      await tester.pumpAndSettle();
      expect(find.text('Kenya'), findsOneWidget);
    });

    testWidgets('no policies yet says so', (tester) async {
      await pump(tester, 'director');
      expect(find.textContaining('No fee policies yet'), findsOneWidget);
    });
  });
}

class FakeRepository implements FeePolicyRepository {
  List<FeePolicy> policies = [];
  final saved = <FeePolicy>[];
  ApiException? error;

  @override
  Future<List<FeePolicy>> list() async {
    if (error != null) throw error!;
    return policies;
  }

  @override
  Future<FeePolicy> save(FeePolicy policy) async {
    saved.add(policy);
    return policy;
  }
}
