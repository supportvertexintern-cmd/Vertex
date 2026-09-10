import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app/app.dart';
import 'core/utils/auth_manager.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final authManager = AuthManager()..hydrate();

  runApp(
    ChangeNotifierProvider.value(
      value: authManager,
      child: const VertexApp(),
    ),
  );
}
