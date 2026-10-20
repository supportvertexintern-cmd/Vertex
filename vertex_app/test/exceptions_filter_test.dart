import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:vertex_app/core/auth/exception_store.dart';
import 'package:vertex_app/presentation/management/exceptions_screen.dart';

RecruiterException _exception(String reference, String type, String issue) =>
    RecruiterException(
      id: reference,
      reference: reference,
      type: type,
      crmRef: '',
      issueStatement: issue,
      immediateImpact: '',
      actionsTaken: '',
      rootCause: '',
      optionsConsidered: '',
      recommendation: '',
      decisionRequired: '',
      createdAt: DateTime(2026, 10, 20),
    );

void main() {
  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 1600) * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final store = ExceptionStore()
      ..add(_exception('EXC-001', 'Operational', 'Flight rebooked twice'))
      ..add(_exception('EXC-002', 'Compliance', 'Passport copy unreadable'));
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: store,
        child: const MaterialApp(home: ManagementExceptionsScreen()),
      ),
    );
    await tester.pump();
  }

  testWidgets('search narrows the list by reference or issue', (tester) async {
    await pumpScreen(tester);
    expect(find.text('EXC-001'), findsOneWidget);
    expect(find.text('EXC-002'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'passport');
    await tester.pump();
    expect(find.text('EXC-001'), findsNothing);
    expect(find.text('EXC-002'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'exc-001');
    await tester.pump();
    expect(find.text('EXC-001'), findsOneWidget);
    expect(find.text('EXC-002'), findsNothing);
  });

  testWidgets('category narrows the list by exception type', (tester) async {
    await pumpScreen(tester);
    await tester.tap(find.text('All categories'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Operational').last);
    await tester.pumpAndSettle();
    expect(find.text('EXC-001'), findsOneWidget);
    expect(find.text('EXC-002'), findsNothing);
  });
}
