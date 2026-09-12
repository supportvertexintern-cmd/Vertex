import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/auth/auth_manager.dart';
import 'router.dart';
import 'theme/theme.dart';

class VertexApp extends StatelessWidget {
  const VertexApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Vertex',
      theme: vertexTheme,
      routerConfig: createRouter(context.read<AuthManager>()),
    );
  }
}