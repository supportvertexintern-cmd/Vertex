import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:vertex_app/core/auth/management_store.dart';
import 'package:vertex_app/presentation/director/campaigns_screen.dart';
import 'package:vertex_app/presentation/director/partners_screen.dart';

void main() {
  Future<void> pumpScreen(WidgetTester tester, String path,
      {Size size = const Size(390, 844)}) async {
    tester.view.physicalSize = size * tester.view.devicePixelRatio;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final router = GoRouter(
      initialLocation: path,
      routes: [
        GoRoute(
          path: '/management/campaigns',
          builder: (_, _) => const ManagementCampaignsScreen(),
        ),
        GoRoute(
          path: '/management/partners',
          builder: (_, _) => const ManagementPartnersScreen(),
        ),
      ],
    );
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => ManagementStore(),
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pump();
  }

  testWidgets('campaigns screen renders', (tester) async {
    await pumpScreen(tester, '/management/campaigns');
    expect(find.text('Campaigns.'), findsOneWidget);
    expect(find.text('Q3 Expansion'), findsWidgets);
    await tester.tap(find.byTooltip('Open menu'));
    await tester.pumpAndSettle();
    expect(find.text('VERTEX'), findsOneWidget);
  });

  testWidgets('partners screen renders', (tester) async {
    await pumpScreen(tester, '/management/partners');
    expect(find.text('Partners.'), findsOneWidget);
    expect(find.text('Horizon Travel & Visa Services'), findsWidgets);
    await tester.tap(find.byTooltip('Open menu'));
    await tester.pumpAndSettle();
    expect(find.text('VERTEX'), findsOneWidget);
  });

  testWidgets('campaigns create form + card interactions do not throw',
      (tester) async {
    await pumpScreen(tester, '/management/campaigns');
    await tester.tap(find.text('NEW CAMPAIGN'));
    await tester.pumpAndSettle();
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Campaign Name'),
        'Test Campaign');
    await tester.pump();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Criteria / notes (optional)'),
        'Some notes about this campaign.');
    await tester.pump();
    await tester.enterText(
        find.widgetWithText(TextField, 'Search by campaign name...'), 'q3');
    await tester.pump();
    await tester.fling(find.byType(ListView), const Offset(0, -1200), 2000);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('partners create form + card interactions do not throw',
      (tester) async {
    await pumpScreen(tester, '/management/partners');
    await tester.tap(find.text('ADD PARTNER'));
    await tester.pumpAndSettle();
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Agency Name'), 'Test Agency');
    await tester.pump();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Country of Operation'), 'Kenya');
    await tester.pump();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Contact Name'), 'Jane Doe');
    await tester.pump();
    await tester.fling(find.byType(ListView), const Offset(0, -1200), 2000);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('all screens lay out on a narrow 320px viewport',
      (tester) async {
    const narrow = Size(320, 700);
    for (final path in ['/management/campaigns', '/management/partners']) {
      await pumpScreen(tester, path, size: narrow);
      expect(tester.takeException(), isNull);
      if (path == '/management/campaigns') {
        await tester.tap(find.text('NEW CAMPAIGN'));
      } else {
        await tester.tap(find.text('ADD PARTNER'));
      }
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.fling(find.byType(ListView), const Offset(0, -1500), 2000);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }
  });
}