import 'package:flutter/material.dart';

import '../../../app/theme/colors.dart';

class ReportDueCard extends StatelessWidget {
  const ReportDueCard({
    super.key,
    required this.type,
    required this.status,
    required this.urgent,
  });

  final String type;
  final String status;
  final bool urgent;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(children: [
          Icon(
            Icons.calendar_today_outlined,
            color: urgent ? VertexColors.gold500 : VertexColors.gray400,
            size: 18,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              '$type activity report',
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ),
          Text(
            status,
            style: TextStyle(
              color: urgent ? VertexColors.warning : VertexColors.gray600,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ]),
      );
}
