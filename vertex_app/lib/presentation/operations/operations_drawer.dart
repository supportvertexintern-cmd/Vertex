import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/colors.dart';
import '../shared/vertex_app_bar_leading.dart';

class OperationsDrawer extends StatelessWidget {
  const OperationsDrawer({super.key, this.activeRoute = '/operations'});

  final String activeRoute;

  static const _items = [
    (Icons.flight_takeoff_outlined, 'Cases', '/operations'),
    (Icons.inbox_outlined, 'Partner Submissions', '/operations/partner-submissions'),
    (Icons.event_outlined, 'Consultations', '/operations/consultations'),
    (Icons.download_outlined, 'Backup', '/operations/backup'),
  ];

  @override
  Widget build(BuildContext context) => Drawer(
        backgroundColor: VertexColors.midnight950,
        child: SafeArea(
          child: Column(children: [
            _header(),
            const Divider(color: Colors.white12, height: 1),
            const SizedBox(height: 8),
            for (final item in _items) _tile(context, item),
            const Spacer(),
            const Divider(color: Colors.white12, height: 1),
            _tile(context, (Icons.logout, 'Log out', '/home')),
            const SizedBox(height: 8),
          ]),
        ),
      );

  Widget _header() => Padding(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
        child: Row(children: [
          const VertexCircleLeading(icon: Icons.flight_takeoff_outlined),
          const SizedBox(width: 12),
          const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('VERTEX', style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: 2)), SizedBox(height: 2), Text('OPERATIONS', style: TextStyle(color: VertexColors.gold400, fontSize: 9, fontWeight: FontWeight.w700, letterSpacing: 1.4))]),
        ]),
      );

  Widget _tile(BuildContext context, (IconData, String, String) item) {
    final active = item.$3 == activeRoute && item.$2 != 'Log out';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: Material(
        color: Colors.transparent,
        child: ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          tileColor: active ? VertexColors.gold500.withValues(alpha: 0.15) : Colors.transparent,
          leading: VertexCircleLeading(icon: item.$1, active: active, size: 32, iconSize: 16),
          title: Text(item.$2, style: TextStyle(color: active ? VertexColors.gold400 : Colors.white70, fontSize: 14, fontWeight: active ? FontWeight.w700 : FontWeight.w400)),
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
            context.go(item.$3);
          },
        ),
      ),
    );
  }
}
