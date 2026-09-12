import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/report_store.dart';
import '../shared/recruiter_drawer.dart';

class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const RecruiterDrawer(activeRoute: '/recruiter/reports'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 72,
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu, color: Colors.white),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
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
            SizedBox(height: 3),
            Text(
              'Reports',
              style: TextStyle(
                  color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
            ),
          ],
        ),
        actions: const [],
      ),
      body: Consumer<ReportStore>(
        builder: (context, reportStore, _) => SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
            children: [
          // Header row with Submit button
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Reports',
                      style: TextStyle(
                          color: VertexColors.midnight900,
                          fontSize: 26,
                          fontWeight: FontWeight.w800),
                    ),
                    SizedBox(height: 6),
                    Text(
                      'Daily, weekly, and monthly reports follow the Supervisory Reporting Framework — '
                      'weekly/monthly KPI actuals auto-populate from the candidates you sourced in the period you pick.',
                      style: TextStyle(
                          color: VertexColors.gray600, fontSize: 13, height: 1.5),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 118,
                child: ElevatedButton.icon(
                    onPressed: () => context.push('/recruiter/reports/new'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: VertexColors.midnight800,
                      foregroundColor: Colors.white,
                      shape: const StadiumBorder(),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 12),
                      elevation: 0,
                    ),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text(
                      'SUBMIT\nREPORT',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.8,
                          height: 1.3),
                    ),
                  ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          const SizedBox(height: 24),

          if (reportStore.reports.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 52, horizontal: 24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: VertexColors.ivory200),
              ),
              child: Column(
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: const BoxDecoration(
                      color: VertexColors.ivory100,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.bar_chart_outlined,
                        color: VertexColors.midnight500, size: 30),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'No reports submitted yet.',
                    style: TextStyle(
                        color: VertexColors.midnight900,
                        fontSize: 16,
                        fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Tap "SUBMIT REPORT" to create your first report.',
                    textAlign: TextAlign.center,
                    style:
                        TextStyle(color: VertexColors.gray600, fontSize: 13),
                  ),
                ],
              ),
            )
          else
              ...reportStore.reports.map(_reportCard),
            ],
          ),
        ),
      ),
    );
  }

  Widget _reportCard(RecruiterReport r) {
    final typeLabel = switch (r.type) {
      ReportType.daily => 'Daily',
      ReportType.weekly => 'Weekly',
      ReportType.monthly => 'Monthly',
    };

    final (statusColor, statusLabel) = switch (r.status) {
      ReportStatus.draft => (VertexColors.gray400, 'Draft'),
      ReportStatus.submitted => (VertexColors.midnight500, 'Submitted'),
      ReportStatus.approved => (VertexColors.gold600, 'Approved'),
      ReportStatus.rejected => (VertexColors.error, 'Rejected'),
    };

    final dateStr =
        '${r.date.day.toString().padLeft(2, '0')}/${r.date.month.toString().padLeft(2, '0')}/${r.date.year}';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: VertexColors.midnight800.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(11),
            ),
            child: const Icon(Icons.bar_chart_outlined,
                color: VertexColors.midnight800, size: 22),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$typeLabel Activity Report',
                  style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 14,
                      fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 3),
                Text(
                  '$dateStr  ·  ${r.overallStatus}',
                  style: const TextStyle(
                      color: VertexColors.gray600, fontSize: 12),
                ),
                const SizedBox(height: 5),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(
                        color: statusColor,
                        fontSize: 10,
                        fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.arrow_forward_ios,
              color: VertexColors.gray400, size: 13),
        ],
      ),
    );
  }
}
