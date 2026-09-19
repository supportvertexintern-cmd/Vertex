import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorReportsScreen extends StatelessWidget {
  const SupervisorReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<SupervisorStore>();

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(activeRoute: '/supervisor/reports'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'AGENT NETWORK',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Reports',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 100),
        children: [
          const Text(
            'Reports.',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 28,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          const Text(
            "Verify or return your recruiters' submissions, then create your own daily, weekly, or monthly country report — it previews what's ready to pull in from their verified reports, but you always review and submit it yourself.",
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 22),

          _sectionTitle('Recruiter submissions'),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 2),
            child: Text(
              'Require verification before they can be consolidated.',
              style: const TextStyle(
                color: VertexColors.gray600,
                fontSize: 11,
              ),
            ),
          ),
          const SizedBox(height: 10),
          if (store.recruiterSubmissions.isEmpty)
            _empty(state: _EmptyKind.submissions)
          else
            for (final report in store.recruiterSubmissions)
              _reportCard(context, report),

          const SizedBox(height: 26),

          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(child: _sectionTitle('Country reports (to In-House)')),
              TextButton.icon(
                onPressed: () => context.push('/supervisor/reports/new'),
                icon: const Icon(Icons.add, size: 16, color: VertexColors.gold600),
                label: const Text(
                  'CREATE REPORT',
                  style: TextStyle(
                    color: VertexColors.gold600,
                    fontWeight: FontWeight.w800,
                    fontSize: 11,
                  ),
                ),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 2),
            child: Text(
              'Compiled by you and sent up to In-House management.',
              style: const TextStyle(
                color: VertexColors.gray600,
                fontSize: 11,
              ),
            ),
          ),
          const SizedBox(height: 10),
          if (store.countryReports.isEmpty)
            _empty(state: _EmptyKind.country)
          else
            for (final report in store.countryReports)
              _reportCard(context, report),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title) => Text(
        title.toUpperCase(),
        style: const TextStyle(
          color: VertexColors.midnight900,
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 1.0,
        ),
      );

  Widget _empty({required _EmptyKind state}) => Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(
          children: [
            Icon(
              state == _EmptyKind.submissions
                  ? Icons.assignment_outlined
                  : Icons.summarize_outlined,
              color: VertexColors.midnight500.withValues(alpha: 0.4),
              size: 22,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                state == _EmptyKind.submissions
                    ? 'No recruiter submissions yet.'
                    : 'No country reports created yet.',
                style: const TextStyle(
                  color: VertexColors.gray600,
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
      );

  Widget _reportCard(BuildContext context, ReportRow report) {
    final isPending = report.status == 'submitted';
    final isReturned = report.status == 'returned';
    final statusColor = isPending
        ? VertexColors.gold600
        : (isReturned ? VertexColors.error : VertexColors.midnight500);
    final statusBg = isPending
        ? const Color(0xFFFFF8E1)
        : (isReturned ? const Color(0xFFFFEBEE) : const Color(0xFFE8F5E9));
    final periodText =
        '${report.periodStart.day}/${report.periodStart.month}'
        ' - ${report.periodEnd.day}/${report.periodEnd.month} '
        '${report.periodEnd.year}';
    final isMine = report.submitterName == 'Country Supervisor';

    return InkWell(
      onTap: () => context.push('/supervisor/reports/${report.id}'),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: statusBg,
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(
                isMine
                    ? Icons.summarize_outlined
                    : Icons.assignment_outlined,
                color: statusColor,
                size: 19,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          report.type.toUpperCase(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 12,
                            color: VertexColors.midnight900,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: statusBg,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          report.status.toUpperCase(),
                          style: TextStyle(
                            fontSize: 8,
                            fontWeight: FontWeight.w800,
                            color: statusColor,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    periodText,
                    style: const TextStyle(
                      color: VertexColors.gray600,
                      fontSize: 11,
                    ),
                  ),
                  if (!isMine)
                    Text(
                      'By ${report.submitterName}',
                      style: const TextStyle(
                        color: VertexColors.gray600,
                        fontSize: 11,
                      ),
                    ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right,
                color: VertexColors.gold600, size: 20),
          ],
        ),
      ),
    );
  }
}

enum _EmptyKind { submissions, country }