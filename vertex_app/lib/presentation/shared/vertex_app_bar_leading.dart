import 'package:flutter/material.dart';

import '../../app/theme/colors.dart';

/// Gold-circle icon used in AppBars, drawer headers, and drawer tiles.
class VertexCircleLeading extends StatelessWidget {
  const VertexCircleLeading({
    super.key,
    required this.icon,
    this.active = true,
    this.size = 40,
    this.iconSize = 22,
  });

  final IconData icon;
  final bool active;
  final double size;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: VertexColors.gold500.withValues(alpha: active ? 0.15 : 0.06),
        shape: BoxShape.circle,
      ),
      child: Icon(
        icon,
        color: active ? VertexColors.gold400 : Colors.white54,
        size: iconSize,
      ),
    );
  }
}

/// Gold-circle menu control used as the AppBar leading on every workspace screen.
class VertexAppBarLeading extends StatelessWidget {
  const VertexAppBarLeading({super.key});

  @override
  Widget build(BuildContext context) {
    return Builder(
      builder: (ctx) => IconButton(
        tooltip: 'Open menu',
        onPressed: () => Scaffold.of(ctx).openDrawer(),
        icon: const VertexCircleLeading(
          icon: Icons.menu,
          iconSize: 20,
        ),
      ),
    );
  }
}
