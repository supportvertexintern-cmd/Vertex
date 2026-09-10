import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/utils/auth_manager.dart';

class LoadingScreen extends StatefulWidget {
  const LoadingScreen({super.key});

  @override
  State<LoadingScreen> createState() => _LoadingScreenState();
}

class _LoadingScreenState extends State<LoadingScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..forward();
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
    _scale = Tween<double>(begin: 0.92, end: 1).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutBack),
    );
    _finishLoading();
  }

  Future<void> _finishLoading() async {
    final auth = context.read<AuthManager>();
    final minimumDuration = Future<void>.delayed(const Duration(milliseconds: 1500));
    while (auth.isLoading) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
      if (!mounted) return;
    }
    await minimumDuration;
    if (!mounted) return;
    context.go('/home');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: VertexColors.ivory50,
        body: Center(
          child: FadeTransition(
            opacity: _fade,
            child: ScaleTransition(
              scale: _scale,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 112,
                    height: 112,
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: VertexColors.ivory50,
                      boxShadow: [
                        BoxShadow(
                          color: VertexColors.midnight500.withValues(alpha: 0.18),
                          blurRadius: 34,
                          spreadRadius: 8,
                        ),
                      ],
                    ),
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        const SizedBox.expand(
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            valueColor: AlwaysStoppedAnimation(VertexColors.midnight500),
                          ),
                        ),
                        Image.asset(
                          'assets/images/vertex-logo.png',
                          width: 48,
                          height: 48,
                          fit: BoxFit.contain,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 28),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        color: VertexColors.gold400,
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                        child: const Text(
                          'LOADING VERTEX',
                          style: TextStyle(
                            color: VertexColors.midnight950,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 2.3,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      const Text(
                        '...',
                        style: TextStyle(
                          color: VertexColors.gold500,
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 2,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  SizedBox(
                    width: 190,
                    child: LinearProgressIndicator(
                      minHeight: 3,
                      borderRadius: BorderRadius.circular(4),
                      backgroundColor: VertexColors.ivory200,
                      valueColor: const AlwaysStoppedAnimation(VertexColors.midnight500),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
}
