import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../app/theme/typography.dart';
import '../../core/auth/auth_manager.dart';
import '../../data/services/api_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  bool obscurePassword = true;
  bool isSubmitting = false;
  String? errorMessage;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      isSubmitting = true;
      errorMessage = null;
    });
    try {
      final role = await context.read<AuthManager>().signIn(
            email: email.text,
            password: password.text,
          );
      if (!mounted) return;
      context.go(role.portalHome);
    } on ApiException catch (e) {
      // The server's own message: wrong password, unverified email, too
      // many attempts, offline, or an account this app isn't for.
      if (!mounted) return;
      setState(() {
        isSubmitting = false;
        errorMessage = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final cardWidth = width > 520 ? 430.0 : width - 40;

    return Scaffold(
      backgroundColor: VertexColors.midnight950,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(vertical: 42, horizontal: 20),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: cardWidth),
              child: Column(
                children: [
                  _BrandHeader(),
                  const SizedBox(height: 30),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(28, 29, 28, 27),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.2),
                          blurRadius: 22,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _FieldLabel('Email Address *'),
                        const SizedBox(height: 7),
                        TextField(
                          controller: email,
                          keyboardType: TextInputType.emailAddress,
                          style: const TextStyle(color: VertexColors.gray800, fontSize: 14),
                          decoration: _inputDecoration('john@example.com'),
                        ),
                        const SizedBox(height: 18),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _FieldLabel('Password *'),
                            GestureDetector(
                              onTap: () {},
                              child: const Text(
                                'Forgot password?',
                                style: TextStyle(
                                  color: VertexColors.gold500,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 7),
                        TextField(
                          controller: password,
                          obscureText: obscurePassword,
                          style: const TextStyle(color: VertexColors.gray800, fontSize: 14),
                          decoration: _inputDecoration('••••••••').copyWith(
                            suffixIcon: IconButton(
                              tooltip: obscurePassword ? 'Show password' : 'Hide password',
                              onPressed: () => setState(() => obscurePassword = !obscurePassword),
                              icon: Icon(
                                obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                                color: const Color(0xFFB8C1BF),
                                size: 19,
                              ),
                            ),
                          ),
                        ),
                        if (errorMessage != null) ...[
                          const SizedBox(height: 14),
                          Text(errorMessage!, style: const TextStyle(color: VertexColors.error, fontSize: 12)),
                        ],
                        const SizedBox(height: 22),
                        SizedBox(
                          height: 50,
                          child: ElevatedButton(
                            onPressed: isSubmitting ? null : _signIn,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: VertexColors.midnight800,
                              disabledBackgroundColor: VertexColors.midnight800.withValues(alpha: 0.7),
                              foregroundColor: Colors.white,
                              shape: const StadiumBorder(),
                              elevation: 0,
                            ),
                            child: isSubmitting
                                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                : const Text('SIGN IN', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, letterSpacing: 1.6)),
                          ),
                        ),
                        const SizedBox(height: 25),
                        Center(
                          child: Wrap(
                            alignment: WrapAlignment.center,
                            children: [
                              const Text("Don't have an account? ", style: TextStyle(color: Color(0xFF89918F), fontSize: 12)),
                              GestureDetector(
                                onTap: () {},
                                child: const Text('Contact your administrator', style: TextStyle(color: VertexColors.gold500, fontSize: 12, fontWeight: FontWeight.w700)),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(String hint) => InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0xFFB7C0BE), fontSize: 13),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(9), borderSide: const BorderSide(color: Color(0xFFD9DFDD))),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(9), borderSide: const BorderSide(color: Color(0xFFD9DFDD))),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(9), borderSide: const BorderSide(color: VertexColors.midnight500, width: 1.4)),
      );
}

class _BrandHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Column(
        children: [
          Image.asset('assets/images/vertex-logo.png', width: 48, height: 38, fit: BoxFit.contain, color: Colors.white, colorBlendMode: BlendMode.srcIn),
          const SizedBox(height: 8),
          Text('VERTEX', style: VertexTypography.label.copyWith(color: Colors.white, fontSize: 16, letterSpacing: 3.2)),
          const SizedBox(height: 4),
          Text('INTERNATIONAL', style: VertexTypography.eyebrow.copyWith(fontSize: 11, letterSpacing: 1.1)),
          const SizedBox(height: 29),
          Text('Welcome Back', style: VertexTypography.h1.copyWith(fontSize: 27, color: Colors.white)),
          const SizedBox(height: 5),
          const Text('Sign in to your account', style: TextStyle(color: Color(0xFFB7C4C0), fontSize: 14)),
        ],
      );
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(text, style: const TextStyle(color: VertexColors.gray800, fontSize: 12, fontWeight: FontWeight.w600));
}
