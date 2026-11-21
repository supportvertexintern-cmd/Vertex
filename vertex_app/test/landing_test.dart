import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:vertex_app/core/landing/landing_store.dart';
import 'package:vertex_app/presentation/home/home_screen.dart';

import 'support/fake_server.dart';

// The home screen's text from the landing CMS (part 4): marketing's
// published blocks over the built-in text, which shows offline, on any
// failure, and for any block the answer doesn't carry.

const path = '/api/public/landing';

Map<String, dynamic> answer(List<Object> blocks, {int? version}) =>
    {'app': 'mobile', 'version': version ?? LandingStore.blockVersion, 'blocks': blocks};

Map<String, dynamic> edited(String key, Map<String, dynamic> changes) =>
    {...LandingStore.builtIn()[key]!, ...changes};

(LandingStore, FakeServer) storeWith() {
  final server = FakeServer();
  final dio = Dio(BaseOptions(baseUrl: 'http://web.test'))..httpClientAdapter = server;
  return (LandingStore(LandingApi(baseUrl: 'http://web.test', dio: dio)), server);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('the built-in text', () {
    test('is the screen as it was, with the shared blocks', () {
      final blocks = LandingStore.builtIn();
      expect(blocks.keys, containsAll(['mobile.hero', 'mobile.footer', 'shared.why_vertex', 'shared.contact']));
      expect(blocks.keys.where((k) => k.startsWith('web.')), isEmpty);
      expect(blocks['mobile.hero']!['headline'], 'Your command center for global mobility.');
      expect(blocks['shared.contact']!['email'], 'vertex@vertexintern.com');
    });
  });

  group('merge', () {
    test('a published block replaces its built-in text; the rest stay', () {
      final merged = LandingStore.merge(answer([
        {'key': 'mobile.hero', 'visible': true, 'body': edited('mobile.hero', {'headline': 'New headline'}), 'revision': 2},
      ]));
      expect(merged['mobile.hero']!['headline'], 'New headline');
      expect(merged['mobile.faq'], LandingStore.builtIn()['mobile.faq']);
    });

    test('a hidden block is null', () {
      final merged = LandingStore.merge(answer([{'key': 'mobile.footer', 'visible': false, 'body': null, 'revision': 1}]));
      expect(merged['mobile.footer'], isNull);
    });

    test('a newer format, an unknown block or a body that is not one keeps the built-in text', () {
      final hero = edited('mobile.hero', {'headline': 'From the future'});
      expect(LandingStore.merge(answer([{'key': 'mobile.hero', 'visible': true, 'body': hero}], version: LandingStore.blockVersion + 1)), LandingStore.builtIn());
      final odd = LandingStore.merge(answer([
        {'key': 'web.hero', 'visible': true, 'body': hero},
        {'key': 'mobile.hero', 'visible': true, 'body': 'not a body'},
        'not a block',
      ]));
      expect(odd, LandingStore.builtIn());
      expect(LandingStore.merge(null), LandingStore.builtIn());
    });
  });

  group('load', () {
    test('shows the answer and saves it for next time', () async {
      final (store, server) = storeWith();
      server.on(path, 200, {'data': answer([{'key': 'shared.contact', 'visible': true, 'body': edited('shared.contact', {'email': 'hello@example.org'})}])});
      await store.load();
      expect(store.blocks['shared.contact']!['email'], 'hello@example.org');
      expect(server.requests.single.queryParameters, {'app': 'mobile'});
      final saved = (await SharedPreferences.getInstance()).getString(LandingStore.cacheKey);
      expect(jsonDecode(saved!)['blocks'], isNotEmpty);
    });

    test('offline, it shows the answer it saved last; with none, the built-in text', () async {
      final (fresh, _) = storeWith();
      await fresh.load(); // no answer queued: offline
      expect(fresh.blocks, LandingStore.builtIn());

      SharedPreferences.setMockInitialValues({
        LandingStore.cacheKey: jsonEncode(answer([{'key': 'mobile.hero', 'visible': true, 'body': edited('mobile.hero', {'headline': 'Saved headline'})}])),
      });
      final (store, server) = storeWith();
      server.on(path, 503, {'error': {'code': 'backend_unavailable', 'message': 'x'}});
      await store.load();
      expect(store.blocks['mobile.hero']!['headline'], 'Saved headline');
    });

    test('a corrupt saved copy is ignored', () async {
      SharedPreferences.setMockInitialValues({LandingStore.cacheKey: '{not json'});
      final (store, _) = storeWith();
      await store.load();
      expect(store.blocks, LandingStore.builtIn());
    });
  });

  group('the home screen', () {
    Future<void> show(WidgetTester tester, Widget screen) async {
      tester.view.physicalSize = const Size(1200, 20000);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: screen));
    }

    testWidgets('shows the built-in text without a store', (tester) async {
      await show(tester, const HomeScreen());
      expect(find.text('Your command center for global mobility.'), findsOneWidget);
      expect(find.text('vertex@vertexintern.com'), findsOneWidget);
      expect(find.text('WHY CHOOSE VERTEX'), findsOneWidget); // the shared eyebrow, in this screen's capitals
    });

    testWidgets("shows marketing's text, and leaves out a hidden section", (tester) async {
      final (store, _) = storeWith();
      store.blocks = LandingStore.merge(answer([
        {'key': 'shared.contact', 'visible': true, 'body': edited('shared.contact', {'email': 'hello@example.org'})},
        {'key': 'mobile.faq', 'visible': false, 'body': null},
      ]));
      await show(tester, ChangeNotifierProvider.value(value: store, child: const HomeScreen()));
      expect(find.text('hello@example.org'), findsOneWidget);
      expect(find.text('Who is the mobile workspace for?'), findsNothing);
      expect(find.text('Your command center for global mobility.'), findsOneWidget);
    });
  });
}
