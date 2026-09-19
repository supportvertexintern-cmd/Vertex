import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/candidate_store.dart';
import '../../core/auth/case_store.dart';
import '../../core/auth/exception_store.dart';
import '../../core/auth/report_store.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorDashboard extends StatelessWidget {
  const SupervisorDashboard({super.key});
  @override
  Widget build(BuildContext context) {
    final candidates = context.watch<CandidateStore>().records;
    final cases = context.watch<CaseStore>().records;
    final reports = context.watch<ReportStore>().reports;
    final exceptions = context.watch<ExceptionStore>().openExceptions;
    final recruiters = context.watch<SupervisorStore>().recruiters;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('AGENT NETWORK', style: TextStyle(color: VertexColors.gold300, fontSize: 9, fontWeight: FontWeight.w600, letterSpacing: 1.2)),
          SizedBox(height: 4),
          Text('Country Overview', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
        ]),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
        children: [
          const Text('Kenya overview.', style: TextStyle(color: VertexColors.midnight900, fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 7),
          const Text('Your country recruiter team, candidate pipeline, and progress against target this month.', style: TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.45)),
          const SizedBox(height: 22),
          _metrics([
            _Metric(Icons.supervisor_account_outlined, 'Recruiters', '${recruiters.length}'),
            _Metric(Icons.people_alt_outlined, 'Candidates in country', '${candidates.length}'),
            _Metric(Icons.pending_actions_outlined, 'Awaiting verification', '${reports.where((r) => r.status == ReportStatus.submitted).length}'),
            _Metric(Icons.description_outlined, 'Reports awaiting review', '${reports.length}'),
          ]),
          const SizedBox(height: 24),
          _sectionCard(title: 'Country performance vs target this month', icon: Icons.track_changes, child: const Text('No active campaign targets touch your country yet.', style: TextStyle(color: VertexColors.gray600, fontSize: 12))),
          const SizedBox(height: 14),
          _sectionCard(title: 'Operational attention', icon: Icons.warning_amber_outlined, child: Text(exceptions.isEmpty ? 'No open exceptions require your review.' : '${exceptions.length} open exception(s) require your review.', style: const TextStyle(color: VertexColors.gray600, fontSize: 12))),
          const SizedBox(height: 14),
          _sectionCard(title: 'Case flow', icon: Icons.flight_takeoff_outlined, child: Column(children: [
            _flowRow('Active', cases.where((c) => c.status == CaseStatus.active).length, VertexColors.midnight700),
            _flowRow('Pending', cases.where((c) => c.status == CaseStatus.pending).length, VertexColors.gold600),
            _flowRow('Closed', cases.where((c) => c.status == CaseStatus.closed).length, VertexColors.gray600),
          ])),
        ],
      ),
    );
  }

  Widget _metrics(List<_Metric> metrics) => LayoutBuilder(builder: (context, constraints) => GridView.count(crossAxisCount: constraints.maxWidth > 620 ? 4 : 1, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), crossAxisSpacing: 10, mainAxisSpacing: 10, childAspectRatio: constraints.maxWidth > 620 ? 1.35 : 4.2, children: [for (final metric in metrics) _metricCard(metric)]));

  Widget _metricCard(_Metric metric) => Container(padding: const EdgeInsets.all(15), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)), child: Row(children: [Container(width: 40, height: 40, decoration: const BoxDecoration(color: VertexColors.ivory100, shape: BoxShape.circle), child: Icon(metric.icon, color: VertexColors.midnight700, size: 20)), const SizedBox(width: 10), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [Text(metric.value, style: const TextStyle(color: VertexColors.midnight900, fontSize: 21, fontWeight: FontWeight.w800)), Text(metric.label.toUpperCase(), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: VertexColors.gray600, fontSize: 8.5, letterSpacing: 0.6))]))]));

  Widget _sectionCard({required String title, required IconData icon, required Widget child}) => Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(children: [Icon(icon, color: VertexColors.gold600, size: 17), const SizedBox(width: 8), Expanded(child: Text(title.toUpperCase(), style: const TextStyle(color: VertexColors.gray600, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.1)))]), const SizedBox(height: 14), child]));

  Widget _flowRow(String label, int value, Color color) => Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: Row(children: [SizedBox(width: 70, child: Text(label, style: const TextStyle(color: VertexColors.gray600, fontSize: 12))), Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: value == 0 ? 0 : 1, minHeight: 8, backgroundColor: VertexColors.ivory100, color: color))), const SizedBox(width: 10), Text('$value', style: const TextStyle(color: VertexColors.midnight900, fontSize: 12, fontWeight: FontWeight.w700))]));
}

class _Metric {
  const _Metric(this.icon, this.label, this.value);
  final IconData icon;
  final String label;
  final String value;
}

class SupervisorSectionScreen extends StatelessWidget {
  const SupervisorSectionScreen({super.key, required this.title});
  final String title;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: VertexColors.ivory50,
        drawer: SupervisorDrawer(activeRoute: '/supervisor/${title.toLowerCase()}'),
        appBar: AppBar(backgroundColor: VertexColors.midnight950, toolbarHeight: 76, leading: const VertexAppBarLeading(), title: Text(title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700))),
        body: ListView(padding: const EdgeInsets.fromLTRB(18, 22, 18, 32), children: [Text('$title.', style: const TextStyle(color: VertexColors.midnight900, fontSize: 28, fontWeight: FontWeight.w800)), const SizedBox(height: 8), Text('$title workflows for the Country Supervisor workspace will appear here.', style: const TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.45))]),
      );
}
