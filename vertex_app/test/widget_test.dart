import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:vertex_app/app/app.dart';
import 'package:vertex_app/core/auth/auth_manager.dart';

void main() {
  testWidgets('Vertex opens on the splash screen', (tester) async {
    final authManager = AuthManager()..isLoading = false;
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => authManager,
        child: const VertexApp(),
      ),
    );
    await tester.pump();
    expect(find.text('VERTEX'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1300));
    await tester.pump(const Duration(milliseconds: 1600));
  });
}
