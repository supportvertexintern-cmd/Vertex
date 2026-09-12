import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/case_store.dart';
import '../shared/recruiter_drawer.dart';
import '../shared/vertex_app_bar_leading.dart';

class MyCasesScreen extends StatefulWidget {
  const MyCasesScreen({super.key});

  @override
  State<MyCasesScreen> createState() => _MyCasesScreenState();
}

class _MyCasesScreenState extends State<MyCasesScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  String? _selectedStatus = 'All statuses';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final allRecords = context.watch<CaseStore>().records;

    final records = allRecords.where((r) {
      final matchesQuery = _query.isEmpty ||
          r.candidateName.toLowerCase().contains(_query) ||
          r.destination.toLowerCase().contains(_query) ||
          r.jobTitle.toLowerCase().contains(_query);
      final matchesStatus = _selectedStatus == 'All statuses' ||
          r.status.name.toLowerCase() == _selectedStatus!.toLowerCase();
      return matchesQuery && matchesStatus;
    }).toList();

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const RecruiterDrawer(activeRoute: '/recruiter/cases'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'RECRUITER WORKSPACE',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'My Cases',
              style: TextStyle(
                  color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),

      body: Column(
        children: [
          // Stats band
          if (allRecords.isNotEmpty)
            Container(
              color: VertexColors.midnight900,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              child: Row(
                children: [
                  _stat(allRecords.length.toString(), 'TOTAL'),
                  _divider(),
                  _stat(
                    allRecords
                        .where((r) => r.status == CaseStatus.active)
                        .length
                        .toString(),
                    'ACTIVE',
                  ),
                  _divider(),
                  _stat(
                    allRecords
                        .where((r) => r.status == CaseStatus.pending)
                        .length
                        .toString(),
                    'PENDING',
                  ),
                ],
              ),
            ),
          // Search + filter
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
                      fontWeight: FontWeight.w600),
                  onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
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
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: _selectedStatus,
                  isExpanded: true,
                  style: const TextStyle(
                      color: VertexColors.gold600,
                      fontSize: 14,
                      fontWeight: FontWeight.w600),
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
                  items: ['All statuses', 'Active', 'Pending', 'Closed']
                      .map((s) => DropdownMenuItem(
                            value: s,
                            child: Text(s,
                                style: const TextStyle(
                                    color: VertexColors.gold600,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600)),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedStatus = v),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          // List or empty state
          Expanded(
            child: records.isEmpty
                ? _empty(context, allRecords.isEmpty)
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                    itemCount: records.length,
                    itemBuilder: (_, i) => _card(records[i]),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _empty(BuildContext context, bool noRecordsAtAll) => Center(
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
                noRecordsAtAll ? 'No cases yet' : 'No matches found',
                style: const TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 22,
                    fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                noRecordsAtAll
                    ? 'Cases are assigned to you by your supervisor.'
                    : 'Try adjusting your search or filter.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: VertexColors.gray600, fontSize: 13, height: 1.5),
              ),

            ],
          ),
        ),
      );

  Widget _card(CaseRecord r) {
    final daysAgo = DateTime.now().difference(r.createdAt).inDays;
    final timeLabel = daysAgo == 0
        ? 'Today'
        : daysAgo == 1
            ? 'Yesterday'
            : '$daysAgo days ago';

    final (statusColor, statusLabel) = switch (r.status) {
      CaseStatus.active => (VertexColors.midnight500, 'Active'),
      CaseStatus.pending => (VertexColors.gold600, 'Pending'),
      CaseStatus.closed => (VertexColors.gray400, 'Closed'),
    };

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
          // Avatar
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: VertexColors.midnight800.withValues(alpha: 0.08),
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                r.candidateName.isNotEmpty
                    ? r.candidateName[0].toUpperCase()
                    : '?',
                style: const TextStyle(
                    color: VertexColors.midnight800,
                    fontSize: 18,
                    fontWeight: FontWeight.w800),
              ),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.candidateName,
                  style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 14,
                      fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 3),
                Text(
                  '${r.destination}  ·  ${r.jobTitle}',
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
                            fontWeight: FontWeight.w700),
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
                style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2)),
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
