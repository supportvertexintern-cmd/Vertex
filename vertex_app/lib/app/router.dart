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
import '../presentation/supervisor/supervisor_candidate_detail_screen.dart';
import '../presentation/supervisor/supervisor_candidates_screen.dart';
import '../presentation/supervisor/supervisor_case_detail_screen.dart';
import '../presentation/supervisor/supervisor_cases_screen.dart';
import '../presentation/supervisor/supervisor_dashboard.dart';
import '../presentation/supervisor/new_country_report_screen.dart';
import '../presentation/supervisor/supervisor_exceptions_screen.dart';
import '../presentation/supervisor/supervisor_report_detail_screen.dart';
import '../presentation/supervisor/supervisor_reports_screen.dart';
import '../presentation/supervisor/supervisor_recruiter_detail_screen.dart';
import '../presentation/supervisor/supervisor_recruiters_screen.dart';
import '../presentation/director/campaigns_screen.dart';
import '../presentation/director/director_dashboard.dart';
import '../presentation/director/employer_clients_screen.dart';
import '../presentation/director/fee_policy_screen.dart';
import '../presentation/director/management_cases_screen.dart';
import '../presentation/director/partner_detail_screen.dart';
import '../presentation/director/partners_screen.dart';
import '../presentation/management/reports_screen.dart';
import '../presentation/management/report_detail_screen.dart';
import '../presentation/management/exceptions_screen.dart';
import '../presentation/management/staff_scorecards_screen.dart';
import '../presentation/management/backup_screen.dart';
import '../presentation/hr/hr_dashboard.dart';
import '../presentation/operations/operations_dashboard.dart';

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
    GoRoute(path: '/supervisor/recruiters', builder: (_, state) => const SupervisorRecruitersScreen(), routes: [
      GoRoute(
        path: ':id',
        builder: (_, state) => SupervisorRecruiterDetailScreen(
          recruiterId: state.pathParameters['id']!,
        ),
      ),
    ]),
    GoRoute(path: '/supervisor/candidates', builder: (_, state) => const SupervisorCandidatesScreen(), routes: [
      GoRoute(
        path: ':id',
        builder: (_, state) => SupervisorCandidateDetailScreen(
          candidateId: state.pathParameters['id']!,
        ),
      ),
    ]),
    GoRoute(path: '/supervisor/cases', builder: (_, state) => const SupervisorCasesScreen(), routes: [
      GoRoute(
        path: ':id',
        builder: (_, state) => SupervisorCaseDetailScreen(
          caseId: state.pathParameters['id']!,
        ),
      ),
    ]),
    GoRoute(path: '/supervisor/reports', builder: (_, state) => const SupervisorReportsScreen(), routes: [
      GoRoute(
        path: 'new',
        builder: (_, state) => const NewCountryReportScreen(),
      ),
      GoRoute(
        path: ':id',
        builder: (_, state) => SupervisorReportDetailScreen(
          reportId: state.pathParameters['id']!,
        ),
      ),
    ]),
    GoRoute(path: '/supervisor/exceptions', builder: (_, state) => const SupervisorExceptionsScreen()),
    GoRoute(path: '/management', builder: (_, state) => const DirectorDashboard()),
    GoRoute(
        path: '/management/campaigns',
        builder: (_, state) => const ManagementCampaignsScreen()),
    GoRoute(
        path: '/management/partners',
        builder: (_, state) => const ManagementPartnersScreen(),
        routes: [
          GoRoute(
            path: ':id',
            builder: (_, state) => ManagementPartnerDetailScreen(
                partnerId: state.pathParameters['id']!),
          ),
        ]),
    GoRoute(path: '/management/employer-clients', builder: (_, state) => const EmployerClientsScreen()),
    GoRoute(path: '/management/fee-policy', builder: (_, state) => const FeePolicyScreen()),
    GoRoute(path: '/management/cases', builder: (_, state) => const ManagementCasesScreen()),
    GoRoute(
      path: '/management/reports',
      builder: (_, state) => const ManagementReportsScreen(),
      routes: [
        GoRoute(
          path: ':id',
          builder: (_, state) => ManagementReportDetailScreen(
            reportId: state.pathParameters['id']!,
          ),
        ),
      ],
    ),
    GoRoute(path: '/management/exceptions', builder: (_, state) => const ManagementExceptionsScreen()),
    GoRoute(path: '/management/staff-scorecards', builder: (_, state) => const ManagementStaffScorecardsScreen()),
    GoRoute(path: '/management/backup', builder: (_, state) => const ManagementBackupScreen()),
    GoRoute(path: '/hr', builder: (_, state) => const HrDashboard()),
    GoRoute(path: '/hr/self-applications', builder: (_, state) => const HrSectionScreen(title: 'Self Applications')),
    GoRoute(path: '/hr/cases', builder: (_, state) => const HrSectionScreen(title: 'Cases')),
    GoRoute(path: '/hr/backup', builder: (_, state) => const HrSectionScreen(title: 'Backup')),
    GoRoute(path: '/operations', builder: (_, state) => const OperationsDashboard()),
    GoRoute(path: '/operations/partner-submissions', builder: (_, state) => const OperationsSectionScreen(title: 'Partner Submissions')),
    GoRoute(path: '/operations/consultations', builder: (_, state) => const OperationsSectionScreen(title: 'Consultations')),
    GoRoute(path: '/operations/backup', builder: (_, state) => const OperationsSectionScreen(title: 'Backup')),
    GoRoute(path: '/chat', builder: (_, state) => const ChatListScreen()),
    for (final route in const {'/inhouse': 'In-House', '/finance': 'Finance', '/marketing': 'Marketing', '/admin': 'Admin', '/partner': 'Partner'}.entries)
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
