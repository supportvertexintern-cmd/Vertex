import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../app/theme/typography.dart';
import '../../core/utils/auth_manager.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..forward();
    Future.delayed(const Duration(milliseconds: 1200), _routeAfterHydration);
  }

  Future<void> _routeAfterHydration() async {
    final auth = context.read<AuthManager>();
    while (auth.isLoading) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
      if (!mounted) return;
    }
    if (!mounted) return;
    context.go('/loading');
  }

  @override
  void dispose() { _controller.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: VertexColors.midnight950,
    body: Center(
      child: FadeTransition(
        opacity: CurvedAnimation(parent: _controller, curve: Curves.easeOut),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Image.asset('assets/images/vertex-logo.png', width: 120, height: 120, fit: BoxFit.contain, color: VertexColors.ivory50, colorBlendMode: BlendMode.srcIn),
          const SizedBox(height: 24),
          Text('VERTEX', style: VertexTypography.display.copyWith(letterSpacing: 6)),
          const SizedBox(height: 8),
          Text('International Recruitment & Mobility', style: VertexTypography.bodySmall),
          const SizedBox(height: 48),
          const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 2)),
        ]),
      ),
    ),
  );
}