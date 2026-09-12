import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/colors.dart';
import 'vertex_app_bar_leading.dart';

class RecruiterDrawer extends StatelessWidget {
  const RecruiterDrawer({super.key, this.activeRoute = '/recruiter'});

  final String activeRoute;

  static const _items = [
    (Icons.dashboard_outlined, 'Overview', '/recruiter'),
    (Icons.people_outline, 'My Candidates', '/recruiter/candidates'),
    (Icons.flight_takeoff_outlined, 'Cases', '/recruiter/cases'),
    (Icons.bar_chart_outlined, 'Reports', '/recruiter/reports'),
    (Icons.warning_amber_outlined, 'Exceptions', '/recruiter/exceptions'),
  ];

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: VertexColors.midnight950,
      child: SafeArea(
        child: Column(
          children: [
            _header(),
            const Divider(color: Colors.white12, height: 1),
            const SizedBox(height: 8),
            for (final item in _items)
              _tile(context, icon: item.$1, label: item.$2, route: item.$3),
            const Spacer(),
            const Divider(color: Colors.white12, height: 1),
            _tile(context, icon: Icons.logout, label: 'Log out', route: '/home'),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _header() => Padding(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
        child: Row(
          children: [
            const VertexCircleLeading(icon: Icons.person_outline),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'VERTEX',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2.0,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'REGIONAL RECRUITER',
                  style: TextStyle(
                    color: VertexColors.gold400,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.4,
                  ),
                ),
              ],
            ),
          ],
        ),
      );

  Widget _tile(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String route,
  }) {
    final active = route == activeRoute && label != 'Log out';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: ListTile(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        tileColor: active
            ? VertexColors.gold500.withValues(alpha: 0.15)
            : Colors.transparent,
        leading: VertexCircleLeading(
          icon: icon,
          active: active,
          size: 32,
          iconSize: 16,
        ),
        title: Text(
          label,
          style: TextStyle(
            color: active ? VertexColors.gold400 : Colors.white70,
            fontSize: 14,
            fontWeight: active ? FontWeight.w700 : FontWeight.w400,
          ),
        ),
        trailing: active
            ? Container(
                width: 4,
                height: 20,
                decoration: BoxDecoration(
                  color: VertexColors.gold400,
                  borderRadius: BorderRadius.circular(2),
                ),
              )
            : null,
        onTap: () {
          Navigator.of(context).pop();
          context.go(route);
        },
      ),
    );
  }
}
