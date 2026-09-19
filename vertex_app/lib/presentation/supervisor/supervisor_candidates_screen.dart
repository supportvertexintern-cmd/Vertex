import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorCandidatesScreen extends StatefulWidget {
  const SupervisorCandidatesScreen({super.key});

  @override
  State<SupervisorCandidatesScreen> createState() =>
      _SupervisorCandidatesScreenState();
}

class _SupervisorCandidatesScreenState extends State<SupervisorCandidatesScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  String _selectedStatus = 'All statuses';

  static const _statuses = [
    'All statuses',
    'Pending Verification',
    'In Process',
    'Visa Processing',
    'Ready to Depart',
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final allCandidates = context.watch<SupervisorStore>().candidates;

    final candidates = allCandidates.where((c) {
      final matchesQuery = _query.isEmpty ||
          c.fullName.toLowerCase().contains(_query) ||
          c.nationality.toLowerCase().contains(_query) ||
          c.opportunity.toLowerCase().contains(_query);
      final matchesStatus = _selectedStatus == 'All statuses' ||
          c.status == _selectedStatus;
      return matchesQuery && matchesStatus;
    }).toList();

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(activeRoute: '/supervisor/candidates'),
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
              'Candidates',
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
          if (allCandidates.isNotEmpty)
            Container(
              color: VertexColors.midnight900,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              child: Row(
                children: [
                  _stat(allCandidates.length.toString(), 'TOTAL'),
                  _divider(),
                  _stat(
                    allCandidates
                        .where((c) => c.status == 'Pending Verification')
                        .length
                        .toString(),
                    'PENDING\nVERIFICATION',
                  ),
                  _divider(),
                  _stat(
                    allCandidates
                        .where((c) => c.status == 'Ready to Depart')
                        .length
                        .toString(),
                    'READY TO\nDEPART',
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Column(
              children: [
                TextField(
                  controller: _searchController,
                  cursorColor: VertexColors.gold600,
                  style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                  onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
                  decoration: InputDecoration(
                    hintText: 'Search candidates...',
                    hintStyle: const TextStyle(
                        color: VertexColors.gray400, fontSize: 13),
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
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _selectedStatus,
                  isExpanded: true,
                  style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                  dropdownColor: Colors.white,
                  iconEnabledColor: VertexColors.gold600,
                  decoration: InputDecoration(
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
                  items: _statuses
                      .map((s) => DropdownMenuItem(
                            value: s,
                            child: Text(s,
                                style: const TextStyle(
                                    color: VertexColors.gold600,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600)),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedStatus = v ?? 'All statuses'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: candidates.isEmpty
                ? _empty(context, allCandidates.isEmpty)
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                    itemCount: candidates.length,
                    itemBuilder: (_, i) => _candidateCard(candidates[i]),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _empty(BuildContext context, bool noCandidatesAtAll) => Center(
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
                child: const Icon(Icons.people_alt_outlined,
                    color: VertexColors.midnight500, size: 34),
              ),
              const SizedBox(height: 20),
              Text(
                noCandidatesAtAll
                    ? 'No candidates in your country yet'
                    : 'No matches found',
                style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                noCandidatesAtAll
                    ? 'Candidate intake records will appear here as recruiters register them.'
                    : 'Try adjusting your search or filter.',
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

  Widget _candidateCard(SupervisorCandidate c) {
    final (statusColor, statusLabel) = _statusStyle(c.status);
    final daysAgo = DateTime.now().difference(c.registeredAt).inDays;
    final timeLabel = daysAgo == 0
        ? 'Today'
        : daysAgo == 1
            ? 'Yesterday'
            : '$daysAgo days ago';
    final initial = c.fullName.isNotEmpty ? c.fullName[0].toUpperCase() : '?';

    return InkWell(
      onTap: () => context.push('/supervisor/candidates/${c.id}'),
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
                  initial,
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
                  Text(
                    c.fullName,
                    style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${c.nationality}  ·  ${c.opportunity}',
                    style: const TextStyle(
                        color: VertexColors.gray600, fontSize: 12),
                  ),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: statusColor,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        timeLabel,
                        style: const TextStyle(
                            color: VertexColors.gray400, fontSize: 11),
                      ),
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

  Widget _stat(String value, String label) => Expanded(
        child: Column(
          children: [
            Text(value,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w800)),
            const SizedBox(height: 3),
            Text(label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.1,
                    height: 1.4)),
          ],
        ),
      );

  Widget _divider() => Container(
        width: 1,
        height: 32,
        color: Colors.white12,
        margin: const EdgeInsets.symmetric(horizontal: 4),
      );
}

(Color, String) _statusStyle(String status) => switch (status) {
      'Pending Verification' => (VertexColors.gold600, 'Pending Verification'),
      'In Process' => (VertexColors.info, 'In Process'),
      'Visa Processing' => (VertexColors.midnight500, 'Visa Processing'),
      'Ready to Depart' => (VertexColors.success, 'Ready to Depart'),
      _ => (VertexColors.gray400, status),
    };