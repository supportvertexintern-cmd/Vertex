import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../constants/roles.dart';

class AuthManager extends ChangeNotifier {
  static const staffEmails = <String, VertexRole>{
    'recruiter@vertexintern.com': VertexRole.regionalRecruiter,
    'supervisor@vertexintern.com': VertexRole.countrySupervisor,
    'inhouse@vertexintern.com': VertexRole.inhouseSupervisor,
    'director@vertexintern.com': VertexRole.director,
    'admin@vertexintern.com': VertexRole.admin,
    'marketing@vertexintern.com': VertexRole.marketing,
    'partner@vertexintern.com': VertexRole.partner,
    'hr@vertexintern.com': VertexRole.hr,
    'operations@vertexintern.com': VertexRole.operationsTeam,
    'operations.director@vertexintern.com': VertexRole.operationsDirector,
    'finance@vertexintern.com': VertexRole.finance,
  };

  bool isLoading = true;
  String? token;
  VertexRole? role;

  bool get isAuthenticated => token != null && role != null;

  Future<void> hydrate() async {
    final preferences = await SharedPreferences.getInstance();
    token = preferences.getString('auth_token');
    final rawRole = preferences.getString('auth_role');
    role = rawRole == null ? null : VertexRole.fromString(rawRole);
    isLoading = false;
    notifyListeners();
  }

  Future<VertexRole?> signIn({String email = '', String password = ''}) async {
    final selectedRole = staffEmails[email.trim().toLowerCase()];
    if (selectedRole == null || password.isEmpty) return null;

    final preferences = await SharedPreferences.getInstance();
    token = 'mobile-development-session';
    role = selectedRole;
    await preferences.setString('auth_token', token!);
    await preferences.setString('auth_role', selectedRole.toWire());
    notifyListeners();
    return selectedRole;
  }

  Future<void> signOut() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove('auth_token');
    await preferences.remove('auth_role');
    token = null;
    role = null;
    notifyListeners();
  }
}
