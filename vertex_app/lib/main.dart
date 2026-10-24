import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app/app.dart';
import 'core/auth/auth_manager.dart';
import 'core/auth/candidate_store.dart';
import 'core/auth/case_store.dart';
import 'core/auth/report_store.dart';
import 'core/auth/exception_store.dart';
import 'core/auth/management_store.dart';
import 'core/auth/supervisor_store.dart';
import 'core/config/app_config.dart';
import 'data/services/api_service.dart';
import 'data/services/auth_api.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = await AppConfig.load();
  // Sessions come from the web app; FastAPI is called with them.
  final authManager = AuthManager(api: AuthApi(baseUrl: config.authBaseUrl))..hydrate();
  final api = ApiService(baseUrl: config.apiBaseUrl, auth: authManager);

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: authManager),
        Provider.value(value: api),
        ChangeNotifierProvider(create: (_) => CandidateStore()),
        ChangeNotifierProvider(create: (_) => CaseStore()),
        ChangeNotifierProvider(create: (_) => ReportStore()),
        ChangeNotifierProvider(create: (_) => ExceptionStore()),
        ChangeNotifierProvider(create: (_) => SupervisorStore()),
        ChangeNotifierProvider(create: (_) => ManagementStore()),
      ],
      child: const VertexApp(),
    ),
  );
}
