import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/candidate_store.dart';
import '../../core/auth/case_store.dart';
import '../../core/auth/exception_store.dart';
import 'hr_drawer.dart';

class HrDashboard extends StatelessWidget {
  const HrDashboard({super.key});

  @override
  Widget build(BuildContext context) {
    final candidates = context.watch<CandidateStore>().records;
    final cases = context.watch<CaseStore>().records;
    final exceptions = context.watch<ExceptionStore>().openExceptions;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const HrDrawer(),
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
            Text('PARTNER NETWORK', style: TextStyle(color: VertexColors.gold300, fontSize: 9, fontWeight: FontWeight.w600, letterSpacing: 1.2)),
            SizedBox(height: 4),
            Text('Partner Submissions', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Partner Submissions.', style: TextStyle(color: VertexColors.midnight900, fontSize: 28, fontWeight: FontWeight.w800)),
                    SizedBox(height: 7),
                    Text('Review partner-submitted candidates, confirm documentation, and hand complete cases to Operations.', style: TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.45)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 54,
                height: 48,
                child: ElevatedButton(
                  onPressed: () => context.go('/hr/self-applications'),
                  style: ElevatedButton.styleFrom(backgroundColor: VertexColors.midnight800, foregroundColor: Colors.white, shape: const StadiumBorder(), padding: EdgeInsets.zero),
                  child: const Icon(Icons.add, size: 20),
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),
          _summaryGrid([
            _Summary(icon: Icons.pending_actions_outlined, label: 'Awaiting review', value: '${candidates.length}'),
            _Summary(icon: Icons.folder_shared_outlined, label: 'Cases handed off', value: '${cases.length}'),
            _Summary(icon: Icons.warning_amber_outlined, label: 'Needs attention', value: '${exceptions.length}'),
          ]),
          const SizedBox(height: 24),
          _sectionLabel('Submission queue'),
          const SizedBox(height: 10),
          if (candidates.isEmpty)
            _emptyCard('No partner submissions are waiting for review.')
          else
            ...candidates.take(5).map((candidate) => _candidateCard(candidate)),
          const SizedBox(height: 24),
          _sectionLabel('Review checklist'),
          const SizedBox(height: 10),
          _checklistCard(),
        ],
      ),
    );
  }

  Widget _summaryGrid(List<_Summary> summaries) => LayoutBuilder(
        builder: (context, constraints) => GridView.count(
          crossAxisCount: constraints.maxWidth > 620 ? 3 : 1,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
          childAspectRatio: constraints.maxWidth > 620 ? 1.45 : 4.2,
          children: [for (final summary in summaries) _summaryCard(summary)],
        ),
      );

  Widget _summaryCard(_Summary summary) => Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)),
        child: Row(
          children: [
            Container(width: 42, height: 42, decoration: const BoxDecoration(color: VertexColors.ivory100, shape: BoxShape.circle), child: Icon(summary.icon, color: VertexColors.midnight700, size: 21)),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [Text(summary.value, style: const TextStyle(color: VertexColors.midnight900, fontSize: 22, fontWeight: FontWeight.w800)), Text(summary.label.toUpperCase(), style: const TextStyle(color: VertexColors.gray600, fontSize: 9, letterSpacing: 0.7))]),
          ],
        ),
      );

  Widget _candidateCard(CandidateRecord candidate) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)),
        child: Row(
          children: [
            Container(width: 42, height: 42, decoration: BoxDecoration(color: VertexColors.midnight800.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(11)), child: const Icon(Icons.person_outline, color: VertexColors.midnight800, size: 22)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(candidate.fullName, style: const TextStyle(color: VertexColors.midnight900, fontSize: 14, fontWeight: FontWeight.w700)), const SizedBox(height: 4), Text('${candidate.nationality}  ·  ${candidate.opportunity}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: VertexColors.gray600, fontSize: 12))])),
            const Icon(Icons.chevron_right, color: VertexColors.gray400, size: 20),
          ],
        ),
      );

  Widget _checklistCard() => Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)),
        child: Column(children: [_checkRow(Icons.description_outlined, 'Documents complete', 'Confirm passport and required records'), _checkRow(Icons.verified_user_outlined, 'Eligibility screened', 'Verify the candidate meets programme criteria'), _checkRow(Icons.flight_takeoff_outlined, 'Ready for Operations', 'Create or hand off the case once approved')]),
      );

  Widget _checkRow(IconData icon, String title, String detail) => Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(children: [Icon(icon, color: VertexColors.gold600, size: 20), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(color: VertexColors.midnight900, fontSize: 13, fontWeight: FontWeight.w700)), const SizedBox(height: 2), Text(detail, style: const TextStyle(color: VertexColors.gray600, fontSize: 11))]))]));

  Widget _emptyCard(String text) => Container(padding: const EdgeInsets.symmetric(vertical: 38, horizontal: 20), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: VertexColors.ivory200)), child: Center(child: Text(text, textAlign: TextAlign.center, style: const TextStyle(color: VertexColors.gray600, fontSize: 13))));

  Widget _sectionLabel(String text) => Text(text.toUpperCase(), style: const TextStyle(color: VertexColors.gray600, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4));
}

class _Summary {
  const _Summary({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;
}

class HrSectionScreen extends StatelessWidget {
  const HrSectionScreen({super.key, required this.title});

  final String title;

  String get _route {
    switch (title) {
      case 'Self Applications':
        return '/hr/self-applications';
      case 'Cases':
        return '/hr/cases';
      case 'Backup':
        return '/hr/backup';
      default:
        return '/hr';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: HrDrawer(activeRoute: _route),
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
          Text('$title workflows for the Human Resources workspace will appear here.', style: const TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.45)),
        ],
      ),
    );
  }
}
