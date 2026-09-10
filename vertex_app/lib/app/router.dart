import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/utils/auth_manager.dart';
import '../presentation/auth/login_screen.dart';
import '../presentation/candidate/candidate_dashboard.dart';
import '../presentation/chat/chat_list_screen.dart';
import '../presentation/loading/loading_screen.dart';
import '../presentation/home/home_screen.dart';
import '../presentation/recruiter/recruiter_dashboard.dart';
import '../presentation/shared/placeholder_screen.dart';
import '../presentation/splash/splash_screen.dart';
import '../presentation/supervisor/supervisor_dashboard.dart';

GoRouter createRouter(AuthManager auth) => GoRouter(
  initialLocation: '/splash',
  refreshListenable: auth,
  redirect: (context, state) {
    if (auth.isLoading) return null;
    final startupRoute = state.matchedLocation == '/splash' || state.matchedLocation == '/loading';
    final publicRoute = startupRoute || state.matchedLocation == '/home' || state.matchedLocation == '/login';
    if (!auth.isAuthenticated) return publicRoute ? null : '/home';
    if (state.matchedLocation == '/login') return auth.role!.portalHome;
    return null;
  },
  routes: [
    GoRoute(path: '/splash', pageBuilder: (_, state) => _transitionPage(state, const SplashScreen())),
    GoRoute(path: '/loading', pageBuilder: (_, state) => _transitionPage(state, const LoadingScreen())),
    GoRoute(path: '/home', pageBuilder: (_, state) => _transitionPage(state, const HomeScreen())),
    GoRoute(path: '/login', pageBuilder: (_, state) => _transitionPage(state, const LoginScreen())),
    GoRoute(path: '/recruiter', builder: (_, state) => const RecruiterDashboard()),
    GoRoute(path: '/recruiter/candidates', builder: (_, state) => const PlaceholderScreen(title: 'Candidates')),
    GoRoute(path: '/recruiter/reports', builder: (_, state) => const PlaceholderScreen(title: 'Reports')),
    GoRoute(path: '/supervisor', builder: (_, state) => const SupervisorDashboard()),
    GoRoute(path: '/dashboard', builder: (_, state) => const CandidateDashboard()),
    GoRoute(path: '/chat', builder: (_, state) => const ChatListScreen()),
    for (final route in const {'/inhouse': 'In-House', '/management': 'Management', '/hr': 'HR', '/operations': 'Operations', '/finance': 'Finance', '/marketing': 'Marketing', '/admin': 'Admin', '/partner': 'Partner'}.entries)
      GoRoute(path: route.key, builder: (_, state) => PlaceholderScreen(title: route.value)),
  ],
);

CustomTransitionPage<void> _transitionPage(GoRouterState state, Widget child) => CustomTransitionPage<void>(
      key: state.pageKey,
      child: child,
      transitionDuration: const Duration(milliseconds: 520),
      reverseTransitionDuration: const Duration(milliseconds: 300),
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        final eased = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic);
        return FadeTransition(
          opacity: eased,
          child: ScaleTransition(scale: Tween<double>(begin: 0.985, end: 1).animate(eased), child: child),
        );
      },
    );