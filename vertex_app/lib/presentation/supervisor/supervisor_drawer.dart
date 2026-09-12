import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/colors.dart';

class SupervisorDrawer extends StatelessWidget {
  const SupervisorDrawer({super.key, this.activeRoute = '/supervisor'});

  final String activeRoute;

  static const _items = [
    (Icons.dashboard_outlined, 'Overview', '/supervisor'),
    (Icons.people_outline, 'Recruiters', '/supervisor/recruiters'),
    (Icons.people_alt_outlined, 'Candidates', '/supervisor/candidates'),
    (Icons.flight_takeoff_outlined, 'Cases', '/supervisor/cases'),
    (Icons.bar_chart_outlined, 'Reports', '/supervisor/reports'),
    (Icons.warning_amber_outlined, 'Exceptions', '/supervisor/exceptions'),
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
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: VertexColors.gold500.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.supervisor_account_outlined,
                  color: VertexColors.gold400, size: 22),
            ),
            const SizedBox(width: 12),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('VERTEX', style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: 2)),
                SizedBox(height: 2),
                Text('COUNTRY SUPERVISOR', style: TextStyle(color: VertexColors.gold400, fontSize: 9, fontWeight: FontWeight.w700, letterSpacing: 1.1)),
              ],
            ),
          ],
        ),
      );

  Widget _tile(BuildContext context, {required IconData icon, required String label, required String route}) {
    final active = route == activeRoute && label != 'Log out';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: Material(
        color: Colors.transparent,
        child: ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          tileColor: active ? VertexColors.gold500.withValues(alpha: 0.15) : Colors.transparent,
          leading: Icon(icon, color: active ? VertexColors.gold400 : Colors.white54, size: 21),
          title: Text(label, style: TextStyle(color: active ? VertexColors.gold400 : Colors.white70, fontSize: 14, fontWeight: active ? FontWeight.w700 : FontWeight.w400)),
          onTap: () {
            Navigator.of(context).pop();
            context.go(route);
          },
        ),
      ),
    );
  }
}
