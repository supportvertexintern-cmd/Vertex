import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/auth_manager.dart';
import '../presentation/auth/login_screen.dart';
import '../presentation/chat/chat_list_screen.dart';
import '../presentation/loading/loading_screen.dart';
import '../presentation/home/home_screen.dart';
import '../presentation/recruiter/recruiter_dashboard.dart';
import '../presentation/recruiter/recruiter_overview.dart';
import '../presentation/recruiter/candidate_information_form.dart';
import '../presentation/recruiter/case_information_form.dart';
import '../presentation/recruiter/my_cases_screen.dart';
import '../presentation/recruiter/reports_screen.dart';
import '../presentation/recruiter/new_report_form.dart';
import '../presentation/recruiter/exceptions_screen.dart';
import '../presentation/shared/placeholder_screen.dart';
import '../presentation/splash/splash_screen.dart';
import '../presentation/supervisor/supervisor_dashboard.dart';
import '../presentation/director/director_dashboard.dart';

GoRouter createRouter(AuthManager auth) => GoRouter(
  initialLocation: '/splash',
  refreshListenable: auth,
  redirect: (context, state) {
    if (auth.isLoading) return null;
    final startupRoute = state.matchedLocation == '/splash' || state.matchedLocation == '/loading';
    final publicRoute = startupRoute || state.matchedLocation == '/home' || state.matchedLocation == '/login';
    if (!auth.isAuthenticated) return publicRoute ? null : '/home';
    return null;
  },
  routes: [
    GoRoute(path: '/splash', pageBuilder: (_, state) => _transitionPage(state, const SplashScreen())),
    GoRoute(path: '/loading', pageBuilder: (_, state) => _transitionPage(state, const LoadingScreen())),
    GoRoute(path: '/home', pageBuilder: (_, state) => _transitionPage(state, const HomeScreen())),
    GoRoute(path: '/login', pageBuilder: (_, state) => _transitionPage(state, const LoginScreen())),
    GoRoute(path: '/recruiter', builder: (_, state) => const RecruiterOverview()),
    GoRoute(path: '/recruiter/candidates', builder: (_, state) => const MyCandidatesScreen()),
    GoRoute(path: '/recruiter/intake', builder: (_, state) => const CandidateInformationForm()),
    GoRoute(path: '/recruiter/cases', builder: (_, state) => const MyCasesScreen()),
    GoRoute(path: '/recruiter/cases/new', builder: (_, state) => const CaseInformationForm()),
    GoRoute(path: '/recruiter/reports', builder: (_, state) => const ReportsScreen()),
    GoRoute(path: '/recruiter/reports/new', builder: (_, state) => const NewReportForm()),
    GoRoute(path: '/recruiter/exceptions', builder: (_, state) => const ExceptionsScreen()),
    GoRoute(path: '/supervisor', builder: (_, state) => const SupervisorDashboard()),
    GoRoute(path: '/management', builder: (_, state) => const DirectorDashboard()),
    GoRoute(path: '/management/campaigns', builder: (_, state) => const DirectorSectionScreen(title: 'Campaigns')),
    GoRoute(path: '/management/partners', builder: (_, state) => const DirectorSectionScreen(title: 'Partners')),
    GoRoute(path: '/management/employer-clients', builder: (_, state) => const DirectorSectionScreen(title: 'Employer Clients')),
    GoRoute(path: '/management/fee-policy', builder: (_, state) => const DirectorSectionScreen(title: 'Fee Policy')),
    GoRoute(path: '/management/cases', builder: (_, state) => const DirectorSectionScreen(title: 'Cases')),
    GoRoute(path: '/management/reports', builder: (_, state) => const DirectorSectionScreen(title: 'Reports')),
    GoRoute(path: '/management/exceptions', builder: (_, state) => const DirectorSectionScreen(title: 'Exceptions')),
    GoRoute(path: '/management/staff-scorecards', builder: (_, state) => const DirectorSectionScreen(title: 'Staff Scorecards')),
    GoRoute(path: '/management/backup', builder: (_, state) => const DirectorSectionScreen(title: 'Backup')),
    GoRoute(path: '/chat', builder: (_, state) => const ChatListScreen()),
    for (final route in const {'/inhouse': 'In-House', '/hr': 'HR', '/operations': 'Operations', '/finance': 'Finance', '/marketing': 'Marketing', '/admin': 'Admin', '/partner': 'Partner'}.entries)
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
