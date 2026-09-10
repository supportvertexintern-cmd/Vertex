import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../constants/roles.dart';

class AuthManager extends ChangeNotifier {
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

  Future<void> signIn({String email = '', String password = '', VertexRole selectedRole = VertexRole.candidate}) async {
    final preferences = await SharedPreferences.getInstance();
    token = 'mobile-development-session';
    role = selectedRole;
    await preferences.setString('auth_token', token!);
    await preferences.setString('auth_role', selectedRole.toWire());
    notifyListeners();
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