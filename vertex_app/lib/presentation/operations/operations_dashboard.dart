import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/case_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'operations_drawer.dart';

class OperationsDashboard extends StatelessWidget {
  const OperationsDashboard({super.key});

  @override
  Widget build(BuildContext context) {
    final cases = context.watch<CaseStore>().records;
    final active = cases.where((c) => c.status == CaseStatus.active).length;
    final pending = cases.where((c) => c.status == CaseStatus.pending).length;
    final closed = cases.where((c) => c.status == CaseStatus.closed).length;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const OperationsDrawer(),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('MOBILITY LIFECYCLE', style: TextStyle(color: VertexColors.gold300, fontSize: 9, fontWeight: FontWeight.w600, letterSpacing: 1.2)), SizedBox(height: 4), Text('Cases', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700))]),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
        children: [
          const Text('Cases.', style: TextStyle(color: VertexColors.midnight900, fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 7),
          const Text('Every active case across every region and country, from registration through permit, visa, and departure. Payments are Finance\'s own lane.', style: TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.45)),
          const SizedBox(height: 22),
          _summaryGrid([
            _Summary(Icons.folder_open_outlined, 'Active cases', '$active'),
            _Summary(Icons.pending_actions_outlined, 'Pending review', '$pending'),
            _Summary(Icons.check_circle_outline, 'Closed cases', '$closed'),
          ]),
          const SizedBox(height: 24),
          _section('Case pipeline', Icons.flight_takeoff_outlined, Column(children: [_flow('Active cases', active, VertexColors.midnight700), _flow('Pending cases', pending, VertexColors.gold600), _flow('Closed cases', closed, VertexColors.gray600)])),
          const SizedBox(height: 14),
          if (cases.isEmpty)
            _section('Operational queue', Icons.inbox_outlined, const Text('No active cases are waiting for operational action.', style: TextStyle(color: VertexColors.gray600, fontSize: 12)))
          else
            ...cases.take(5).map(_caseCard),
        ],
      ),
    );
  }

  Widget _summaryGrid(List<_Summary> summaries) => LayoutBuilder(builder: (context, constraints) => GridView.count(crossAxisCount: constraints.maxWidth > 620 ? 3 : 1, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), crossAxisSpacing: 10, mainAxisSpacing: 10, childAspectRatio: constraints.maxWidth > 620 ? 1.45 : 4.2, children: [for (final summary in summaries) _summaryCard(summary)]));

  Widget _summaryCard(_Summary summary) => Container(padding: const EdgeInsets.all(15), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)), child: Row(children: [Container(width: 42, height: 42, decoration: const BoxDecoration(color: VertexColors.ivory100, shape: BoxShape.circle), child: Icon(summary.icon, color: VertexColors.midnight700, size: 21)), const SizedBox(width: 12), Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [Text(summary.value, style: const TextStyle(color: VertexColors.midnight900, fontSize: 22, fontWeight: FontWeight.w800)), Text(summary.label.toUpperCase(), style: const TextStyle(color: VertexColors.gray600, fontSize: 9, letterSpacing: 0.7))])]));

  Widget _section(String title, IconData icon, Widget child) => Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(children: [Icon(icon, color: VertexColors.gold600, size: 17), const SizedBox(width: 8), Text(title.toUpperCase(), style: const TextStyle(color: VertexColors.gray600, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.1))]), const SizedBox(height: 14), child]));

  Widget _flow(String label, int value, Color color) => Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [SizedBox(width: 105, child: Text(label, style: const TextStyle(color: VertexColors.gray600, fontSize: 12))), Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: value == 0 ? 0 : 1, minHeight: 9, backgroundColor: VertexColors.ivory100, color: color))), const SizedBox(width: 10), Text('$value', style: const TextStyle(color: VertexColors.midnight900, fontSize: 12, fontWeight: FontWeight.w700))]));

  Widget _caseCard(CaseRecord item) => Container(margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(15), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)), child: Row(children: [const Icon(Icons.flight_takeoff_outlined, color: VertexColors.midnight700, size: 22), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(item.candidateName, style: const TextStyle(color: VertexColors.midnight900, fontSize: 14, fontWeight: FontWeight.w700)), const SizedBox(height: 4), Text('${item.destination}  ·  ${item.jobTitle}', style: const TextStyle(color: VertexColors.gray600, fontSize: 12))])), Text(item.status.name.toUpperCase(), style: const TextStyle(color: VertexColors.gold600, fontSize: 10, fontWeight: FontWeight.w700))]));
}

class _Summary {
  const _Summary(this.icon, this.label, this.value);
  final IconData icon;
  final String label;
  final String value;
}

class OperationsSectionScreen extends StatelessWidget {
  const OperationsSectionScreen({super.key, required this.title});
  final String title;

  @override
  Widget build(BuildContext context) => Scaffold(backgroundColor: VertexColors.ivory50, drawer: OperationsDrawer(activeRoute: '/operations/${title.toLowerCase().replaceAll(' ', '-')}'), appBar: AppBar(backgroundColor: VertexColors.midnight950, toolbarHeight: 76, leading: const VertexAppBarLeading(), title: Text(title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700))), body: ListView(padding: const EdgeInsets.fromLTRB(18, 22, 18, 32), children: [Text('$title.', style: const TextStyle(color: VertexColors.midnight900, fontSize: 28, fontWeight: FontWeight.w800)), const SizedBox(height: 8), Text('$title workflows for the Operations workspace will appear here.', style: const TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.45))]));
}
