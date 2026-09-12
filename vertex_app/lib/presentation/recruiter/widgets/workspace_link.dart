import 'package:flutter/material.dart';

import '../../../app/theme/colors.dart';

class WorkspaceLink extends StatelessWidget {
  const WorkspaceLink({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 4),
        leading: Icon(icon, color: VertexColors.midnight800, size: 21),
        title: Text(
          label,
          style: const TextStyle(
            color: VertexColors.midnight900,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
        trailing: const Icon(
          Icons.arrow_forward_ios,
          color: VertexColors.gray400,
          size: 13,
        ),
      );
}
