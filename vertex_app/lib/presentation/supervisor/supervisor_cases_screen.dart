import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorCasesScreen extends StatefulWidget {
  const SupervisorCasesScreen({super.key});

  @override
  State<SupervisorCasesScreen> createState() => _SupervisorCasesScreenState();
}

class _SupervisorCasesScreenState extends State<SupervisorCasesScreen> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<SupervisorCase> _filtered(List<SupervisorCase> cases) {
    final needle = _query.trim().toLowerCase();
    if (needle.isEmpty) return cases;
    return cases
        .where((c) =>
            c.candidateName.toLowerCase().contains(needle) ||
            c.recruiterName.toLowerCase().contains(needle))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final allCases = context.watch<SupervisorStore>().cases;
    final cases = _filtered(allCases);

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
              'Cases',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Cases.',
                  style: TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 7),
                const Text(
                  "Every case across your country's recruiters — offer through permit, visa, and travel. Read-only oversight: Operations handles case and document updates, Finance handles payments.",
                  style: TextStyle(
                    color: VertexColors.gray600,
                    fontSize: 13,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _searchController,
                  onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
                  cursorColor: VertexColors.gold600,
                  style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Search cases...',
                    hintStyle:
                        const TextStyle(color: VertexColors.gray400, fontSize: 13),
                    prefixIcon: const Icon(Icons.search,
                        color: VertexColors.gold600, size: 20),
                    filled: true,
                    fillColor: Colors.white,
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(11),
                        borderSide:
                            const BorderSide(color: VertexColors.ivory200)),
                    enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(11),
                        borderSide:
                            const BorderSide(color: VertexColors.ivory200)),
                    focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(11),
                        borderSide: const BorderSide(
                            color: VertexColors.gold600, width: 1.4)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: cases.isEmpty
                ? _empty(context, allCases.isEmpty)
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                    itemCount: cases.length,
                    itemBuilder: (_, i) => _caseCard(cases[i]),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _empty(BuildContext context, bool noCasesAtAll) => Center(
        child: Padding(
          padding: const EdgeInsets.all(36),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: const BoxDecoration(
                  color: VertexColors.ivory100,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.flight_takeoff_outlined,
                    color: VertexColors.midnight500, size: 34),
              ),
              const SizedBox(height: 20),
              Text(
                noCasesAtAll ? 'No active cases yet' : 'No matches found',
                style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                noCasesAtAll
                    ? 'No active cases in your country yet.'
                    : 'Try adjusting your search.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: VertexColors.gray600,
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
      );

  Widget _caseCard(SupervisorCase c) {
    final isDelayed = c.status == 'Delayed';
    final updatedAt =
        '${c.lastUpdated.day.toString().padLeft(2, '0')}/'
        '${c.lastUpdated.month.toString().padLeft(2, '0')}/'
        '${c.lastUpdated.year}';

    return InkWell(
      onTap: () => context.push('/supervisor/cases/${c.id}'),
      borderRadius: BorderRadius.circular(14),
      child: Container(
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
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Text(
                  c.candidateName.isNotEmpty ? c.candidateName[0].toUpperCase() : '?',
                  style: const TextStyle(
                    color: VertexColors.midnight800,
                    fontSize: 18,
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
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          c.candidateName,
                          style: const TextStyle(
                            color: VertexColors.midnight900,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: isDelayed
                              ? const Color(0xFFFFEBEE)
                              : const Color(0xFFE8F5E9),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          c.status.toUpperCase(),
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            color: isDelayed
                                ? VertexColors.error
                                : VertexColors.midnight500,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    c.recruiterName,
                    style: const TextStyle(
                        color: VertexColors.gray600, fontSize: 12),
                  ),
                  const SizedBox(height: 9),
                  Row(
                    children: [
                      _miniMetric(c.currentStage, 'CURRENT STAGE'),
                      _miniDivider(),
                      _miniMetric(updatedAt, 'LAST UPDATED'),
                    ],
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios,
                color: VertexColors.gray400, size: 13),
          ],
        ),
      ),
    );
  }

  Widget _miniMetric(String value, String label) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: VertexColors.gray600,
                fontSize: 8,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.7,
              ),
            ),
          ],
        ),
      );

  Widget _miniDivider() => Container(
        width: 1,
        height: 26,
        color: VertexColors.ivory200,
        margin: const EdgeInsets.symmetric(horizontal: 10),
      );
}