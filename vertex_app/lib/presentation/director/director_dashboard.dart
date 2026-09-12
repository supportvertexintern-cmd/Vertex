import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/candidate_store.dart';
import '../../core/auth/case_store.dart';
import '../../core/auth/exception_store.dart';
import '../../core/auth/report_store.dart';
import 'director_drawer.dart';

class DirectorDashboard extends StatelessWidget {
  const DirectorDashboard({super.key});

  @override
  Widget build(BuildContext context) {
    final candidates = context.watch<CandidateStore>().records;
    final cases = context.watch<CaseStore>().records;
    final reports = context.watch<ReportStore>().reports;
    final openExceptions = context.watch<ExceptionStore>().openExceptions;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu, color: Colors.white),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('VERTEX MANAGEMENT', style: TextStyle(color: VertexColors.gold300, fontSize: 9, fontWeight: FontWeight.w600, letterSpacing: 1.2)),
            SizedBox(height: 4),
            Text('Control Dashboard', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
        children: [
          const Text('Control dashboard.', style: TextStyle(color: VertexColors.midnight900, fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text('Real-time visibility across candidates, cases, reporting, and operational exceptions.', style: TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.45)),
          const SizedBox(height: 22),
          _metricGrid([
            _Metric(icon: Icons.people_outline, label: 'Agent sign-ups', value: '${candidates.length}'),
            _Metric(icon: Icons.flight_takeoff_outlined, label: 'Active cases', value: '${cases.where((c) => c.status == CaseStatus.active).length}'),
            _Metric(icon: Icons.warning_amber_outlined, label: 'Open exceptions', value: '${openExceptions.length}'),
          ]),
          const SizedBox(height: 24),
          _sectionTitle('Operational snapshot'),
          const SizedBox(height: 10),
          _snapshotCard(
            icon: Icons.people_outline,
            title: 'Candidate pipeline',
            detail: '${candidates.length} candidate records currently available across the recruitment workspace.',
            value: '${candidates.length}',
            color: VertexColors.midnight500,
          ),
          _snapshotCard(
            icon: Icons.description_outlined,
            title: 'Submitted reports',
            detail: '${reports.length} reports have been submitted by the active workspace.',
            value: '${reports.length}',
            color: VertexColors.gold600,
          ),
          _snapshotCard(
            icon: Icons.warning_amber_outlined,
            title: 'Governance exceptions',
            detail: openExceptions.isEmpty ? 'No open exceptions require management attention.' : 'Open issues require review and escalation.',
            value: '${openExceptions.length}',
            color: openExceptions.isEmpty ? VertexColors.success : VertexColors.error,
          ),
          const SizedBox(height: 14),
          _sectionTitle('Case flow'),
          const SizedBox(height: 10),
          _caseFlow(cases),
        ],
      ),
    );
  }

  Widget _metricGrid(List<_Metric> metrics) => LayoutBuilder(
        builder: (context, constraints) {
          final columns = constraints.maxWidth > 620 ? 3 : 1;
          return GridView.count(
            crossAxisCount: columns,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: columns == 1 ? 4.2 : 1.45,
            children: [for (final metric in metrics) _metricCard(metric)],
          );
        },
      );

  Widget _metricCard(_Metric metric) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)),
        child: Row(
          children: [
            Container(width: 42, height: 42, decoration: const BoxDecoration(color: VertexColors.ivory100, shape: BoxShape.circle), child: Icon(metric.icon, color: VertexColors.midnight700, size: 21)),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [Text(metric.value, style: const TextStyle(color: VertexColors.midnight900, fontSize: 22, fontWeight: FontWeight.w800)), Text(metric.label.toUpperCase(), style: const TextStyle(color: VertexColors.gray600, fontSize: 9, letterSpacing: 0.8))]),
          ],
        ),
      );

  Widget _snapshotCard({required IconData icon, required String title, required String detail, required String value, required Color color}) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)),
        child: Row(children: [Icon(icon, color: color, size: 22), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(color: VertexColors.midnight900, fontSize: 14, fontWeight: FontWeight.w700)), const SizedBox(height: 4), Text(detail, style: const TextStyle(color: VertexColors.gray600, fontSize: 12, height: 1.35))])), Text(value, style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.w800)]),
      );

  Widget _caseFlow(List<CaseRecord> cases) {
    final active = cases.where((c) => c.status == CaseStatus.active).length;
    final pending = cases.where((c) => c.status == CaseStatus.pending).length;
    final closed = cases.where((c) => c.status == CaseStatus.closed).length;
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)),
      child: Column(children: [_flowRow('Active', active, VertexColors.midnight700), _flowRow('Pending', pending, VertexColors.gold600), _flowRow('Closed', closed, VertexColors.gray600)]),
    );
  }

  Widget _flowRow(String label, int value, Color color) => Padding(padding: const EdgeInsets.symmetric(vertical: 7), child: Row(children: [SizedBox(width: 72, child: Text(label, style: const TextStyle(color: VertexColors.gray600, fontSize: 12))), Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: value == 0 ? 0 : 1, minHeight: 9, backgroundColor: VertexColors.ivory100, color: color))), const SizedBox(width: 10), SizedBox(width: 24, child: Text('$value', textAlign: TextAlign.right, style: const TextStyle(color: VertexColors.midnight900, fontSize: 12, fontWeight: FontWeight.w700))]));

  Widget _sectionTitle(String text) => Text(text.toUpperCase(), style: const TextStyle(color: VertexColors.gray600, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4));
}

class _Metric {
  const _Metric({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;
}

class DirectorSectionScreen extends StatelessWidget {
  const DirectorSectionScreen({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: DirectorDrawer(activeRoute: '/management/$title'.toLowerCase().replaceAll(' ', '-')),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu, color: Colors.white),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
        title: Text(title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
        children: [
          Text('$title.', style: const TextStyle(color: VertexColors.midnight900, fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text('$title controls for the Director workspace will appear here.', style: const TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.45)),
        ],
      ),
    );
  }
}
