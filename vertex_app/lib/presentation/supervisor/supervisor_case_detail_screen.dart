import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorCaseDetailScreen extends StatelessWidget {
  const SupervisorCaseDetailScreen({super.key, required this.caseId});

  final String caseId;

  @override
  Widget build(BuildContext context) {
    final caseRecord = context.watch<SupervisorStore>().caseById(caseId);

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(activeRoute: '/supervisor/cases'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'MOBILITY LIFECYCLE',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Case Detail',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: caseRecord == null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Case not found.',
                    style: TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'This case may have been removed.',
                    style: TextStyle(color: VertexColors.gray600, fontSize: 13),
                  ),
                  const SizedBox(height: 18),
                  OutlinedButton.icon(
                    onPressed: () => context.go('/supervisor/cases'),
                    icon: const Icon(Icons.arrow_back, size: 18),
                    label: const Text('Back to cases'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: VertexColors.midnight800,
                      side: const BorderSide(color: VertexColors.ivory200),
                    ),
                  ),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 100),
              children: [
                const Text(
                  'Case detail.',
                  style: TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  'Read-only — case status and document updates are handled by Operations, payments by Finance.',
                  style: TextStyle(
                    color: VertexColors.gray600,
                    fontSize: 13,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 20),

                _candidateCard(caseRecord),
                const SizedBox(height: 26),

                _sectionTitle(context, 'Mobility Lifecycle', Icons.timeline),
                const SizedBox(height: 10),
                _timelineCard(caseRecord),
                const SizedBox(height: 26),

                _sectionTitle(context, 'Documents', Icons.folder_open),
                const SizedBox(height: 4),
                Padding(
                  padding: const EdgeInsets.only(left: 26),
                  child: Text(
                    'Read-only · uploaded by Operations',
                    style: TextStyle(
                      color: VertexColors.gray600,
                      fontSize: 11,
                      height: 1.45,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                _documentsCard(caseRecord),
                const SizedBox(height: 26),

                _sectionTitle(context, 'Payments', Icons.payments_outlined),
                const SizedBox(height: 4),
                Padding(
                  padding: const EdgeInsets.only(left: 26),
                  child: Text(
                    'Read-only · processed by Finance',
                    style: TextStyle(
                      color: VertexColors.gray600,
                      fontSize: 11,
                      height: 1.45,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                _paymentCard(caseRecord),
              ],
            ),
    );
  }

  Widget _sectionTitle(BuildContext context, String title, IconData icon) =>
      Row(
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          Icon(icon, color: VertexColors.gold600, size: 15),
          const SizedBox(width: 9),
          Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: VertexColors.midnight900,
              fontSize: 12,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.0,
            ),
          ),
        ],
      );

  Widget _candidateCard(SupervisorCase c) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: VertexColors.midnight800.withValues(alpha: 0.08),
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      c.candidateName.isNotEmpty
                          ? c.candidateName[0].toUpperCase()
                          : '?',
                      style: const TextStyle(
                        color: VertexColors.midnight800,
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        c.candidateName,
                        style: const TextStyle(
                          color: VertexColors.midnight900,
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        c.recruiterName,
                        style: const TextStyle(
                            color: VertexColors.gray600, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: VertexColors.gold600.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    c.currentStage.toUpperCase(),
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: VertexColors.gold600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 15),
            const Divider(height: 1, color: VertexColors.ivory200),
            const SizedBox(height: 13),
            Row(
              children: [
                _infoColumn('COUNTRY', c.country),
                const SizedBox(width: 20),
                _infoColumn('CASE STATUS', c.status),
                const SizedBox(width: 20),
                _infoColumn('STAGE', c.currentStage),
              ],
            ),
          ],
        ),
      );

  Widget _infoColumn(String label, String value) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                color: VertexColors.gray600,
                fontSize: 9,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.7,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      );

  Widget _timelineCard(SupervisorCase c) => Container(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Column(
          children: [
            for (var i = 0; i < c.timeline.length; i++)
              _timelineRow(c.timeline[i], isLast: i == c.timeline.length - 1),
          ],
        ),
      );

  Widget _timelineRow(TimelineEvent event, {required bool isLast}) {
    final isCompleted = event.status == TimelineStatus.completed;
    final isCurrent = event.status == TimelineStatus.current;
    final color = isCompleted
        ? VertexColors.midnight500
        : (isCurrent ? VertexColors.gold600 : VertexColors.gray400);
    final date = event.date;
    final dateText = date != null
        ? '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}'
        : null;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          RepaintBoundary(
            child: CustomPaint(
              painter: _TimelineDashPainter(
                connectorColor: isLast ? null : VertexColors.ivory200,
              ),
              child: SizedBox(
                width: 22,
                child: Center(
                  child: Icon(
                    isCompleted
                        ? Icons.check_circle
                        : (isCurrent
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked),
                    color: color,
                    size: 20,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        event.stage,
                        style: TextStyle(
                          color: isCurrent
                              ? VertexColors.midnight900
                              : VertexColors.gray800,
                          fontSize: 14,
                          fontWeight:
                              isCurrent ? FontWeight.w800 : FontWeight.w600,
                        ),
                      ),
                      if (isCurrent)
                        Container(
                          margin: const EdgeInsets.only(left: 9),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 1),
                          decoration: BoxDecoration(
                            color:
                                VertexColors.gold600.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Text(
                            'CURRENT',
                            style: TextStyle(
                              fontSize: 8,
                              fontWeight: FontWeight.w800,
                              color: VertexColors.gold600,
                              letterSpacing: 0.6,
                            ),
                          ),
                        ),
                    ],
                  ),
                  if (dateText != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        dateText,
                        style: const TextStyle(
                            color: VertexColors.gray600, fontSize: 11),
                      ),
                    ),
                  if (event.notes != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 5),
                      child: Text(
                        event.notes!,
                        style: const TextStyle(
                          color: VertexColors.gray600,
                          fontSize: 12,
                          height: 1.4,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _documentsCard(SupervisorCase c) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: c.documents.isEmpty
            ? _readOnlyEmpty(Icons.folder_open, 'No documents uploaded yet.')
            : Column(
                children: [
                  for (final doc in c.documents)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          const Icon(Icons.insert_drive_file_outlined,
                              color: VertexColors.gold600, size: 20),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              doc,
                              style: const TextStyle(
                                color: VertexColors.midnight900,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const Icon(Icons.lock_outline,
                              color: VertexColors.gray400, size: 16),
                        ],
                      ),
                    ),
                ],
              ),
      );

  Widget _paymentCard(SupervisorCase c) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(
          children: [
            const Icon(Icons.check_circle_outline,
                color: VertexColors.midnight500, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                c.paymentStatus,
                style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const Icon(Icons.lock_outline, color: VertexColors.gray400, size: 16),
          ],
        ),
      );

  Widget _readOnlyEmpty(IconData icon, String message) => Row(
        children: [
          Icon(icon, color: VertexColors.gray400, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: VertexColors.gray600, fontSize: 13),
            ),
          ),
          const Icon(Icons.lock_outline, color: VertexColors.gray400, size: 16),
        ],
      );
}

class _TimelineDashPainter extends CustomPainter {
  _TimelineDashPainter({this.connectorColor});

  final Color? connectorColor;

  @override
  void paint(Canvas canvas, Size size) {
    if (connectorColor == null) return;
    final paint = Paint()
      ..color = connectorColor!
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;

    const dashW = 3.0;
    const gap = 3.0;
    var y = 22.0;
    final maxY = size.height;
    while (y < maxY) {
      canvas.drawLine(Offset(11, y), Offset(11, (y + dashW).clamp(0, maxY)), paint);
      y += dashW + gap;
    }
  }

  @override
  bool shouldRepaint(covariant _TimelineDashPainter oldDelegate) =>
      oldDelegate.connectorColor != connectorColor;
}