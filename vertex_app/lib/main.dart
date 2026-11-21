import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app/app.dart';
import 'core/auth/auth_manager.dart';
import 'core/auth/candidate_store.dart';
import 'core/auth/case_store.dart';
import 'core/auth/report_store.dart';
import 'core/auth/exception_store.dart';
import 'core/auth/fee_policy_store.dart';
import 'core/auth/management_store.dart';
import 'core/auth/supervisor_store.dart';
import 'core/config/app_config.dart';
import 'data/repositories/fee_policy_repository.dart';
import 'data/services/api_service.dart';
import 'data/services/auth_api.dart';
import 'data/repositories/candidate_repository.dart';
import 'data/repositories/case_repository.dart';
import 'data/repositories/intake_repository.dart';
import 'core/landing/landing_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = await AppConfig.load();
  // Sessions come from the web app; FastAPI is called with them.
  final authManager = AuthManager(api: AuthApi(baseUrl: config.authBaseUrl))..hydrate();
  final api = ApiService(baseUrl: config.apiBaseUrl, auth: authManager);
  // The home screen's text, from the web app's public read of the landing CMS.
  final landing = LandingStore(LandingApi(baseUrl: config.authBaseUrl))..load();
  final candidates = CandidateStore(CandidateRepository(api));
  final cases = CaseStore(CaseRepository(api));
  // The server-backed lists follow the session: loaded for whoever signs in,
  // emptied when they sign out.
  var signedIn = false;
  void followSession() {
    if (authManager.isAuthenticated == signedIn) return;
    signedIn = authManager.isAuthenticated;
    if (signedIn) {
      candidates.load();
      cases.load();
    } else {
      candidates.clear();
      cases.clear();
    }
  }

  authManager.addListener(followSession);
  followSession();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: authManager),
        Provider.value(value: api),
        ChangeNotifierProvider.value(value: landing),
        // From FastAPI, scoped to the signed-in user (the recruiter's own, and so on).
        ChangeNotifierProvider.value(value: candidates),
        ChangeNotifierProvider.value(value: cases),
        // The recruiter's Candidate Information Form: FastAPI, and the web app's scanned upload.
        Provider.value(value: IntakeRepository(api)),
        Provider.value(value: IntakeUploads(baseUrl: config.authBaseUrl)),
        ChangeNotifierProvider(create: (_) => ReportStore()),
        ChangeNotifierProvider(create: (_) => ExceptionStore()),
        ChangeNotifierProvider(create: (_) => SupervisorStore()),
        ChangeNotifierProvider(create: (_) => ManagementStore()),
        // From FastAPI (backend plan step 1.4); the other stores are still mock data.
        ChangeNotifierProvider(create: (_) => FeePolicyStore(FeePolicyRepository(api))),
      ],
      child: const VertexApp(),
    ),
  );
}
