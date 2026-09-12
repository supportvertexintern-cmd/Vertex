import 'package:flutter/material.dart';

import '../../../app/theme/colors.dart';

class TargetCard extends StatelessWidget {
  const TargetCard({
    super.key,
    required this.current,
    required this.target,
    required this.label,
  });

  final int current;
  final int target;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(17),
        decoration: BoxDecoration(
          color: VertexColors.midnight900,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Verified records',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
                Text(
                  '$current / $target',
                  style: const TextStyle(
                    color: VertexColors.gold300,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 13),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: current / target,
                minHeight: 7,
                backgroundColor: Colors.white12,
                valueColor: const AlwaysStoppedAnimation(VertexColors.gold400),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              label,
              style: const TextStyle(color: Colors.white60, fontSize: 11),
            ),
          ],
        ),
      );
}
