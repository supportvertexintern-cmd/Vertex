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

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final authManager = AuthManager()..hydrate();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: authManager),
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
