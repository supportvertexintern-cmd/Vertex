import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/management_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'director_drawer.dart';

const Map<String, String> _sourceLabels = {
  'self_registered': 'Self-Registered',
  'recruiter_sourced': 'Recruiter-Sourced',
  'partner_sourced': 'Partner-Sourced',
};

class ManagementCasesScreen extends StatefulWidget {
  const ManagementCasesScreen({super.key});

  @override
  State<ManagementCasesScreen> createState() => _ManagementCasesScreenState();
}

class _ManagementCasesScreenState extends State<ManagementCasesScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  String _stageFilter = 'All stages';
  String _statusFilter = 'All statuses';
  String _sourceFilter = 'All sources';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<ManagementStore>();

    final rows = store.managementCases.where((c) {
      if (_stageFilter != 'All stages' && c.currentStage != _stageFilter) {
        return false;
      }
      if (_statusFilter != 'All statuses' &&
          c.opsReviewStatus != _statusFilter.toLowerCase()) {
        return false;
      }
      if (_sourceFilter != 'All sources' && c.source != _sourceFilter) {
        return false;
      }
      if (_query.isNotEmpty &&
          !c.candidateName.toLowerCase().contains(_query) &&
          !c.country.toLowerCase().contains(_query) &&
          !c.jobTitle.toLowerCase().contains(_query)) {
        return false;
      }
      return true;
    });

    final stages = store.managementCases.map((c) => c.currentStage).toSet();
    final pendingCount =
        store.managementCases.where((c) => c.opsReviewStatus == 'pending').length;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/cases'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'MANAGEMENT',
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
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 100),
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
            'Oversight across all candidate journeys, from document collection to placement.',
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: pendingCount > 0
                  ? const Color(0xFFFFF8E1)
                  : const Color(0xFFE8F5E9),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              pendingCount > 0
                  ? '$pendingCount case(s) awaiting Ops review.'
                  : 'No cases awaiting Ops review.',
              style: TextStyle(
                color: pendingCount > 0
                    ? VertexColors.gold600
                    : VertexColors.midnight500,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: 18),

          TextField(
            controller: _searchController,
            onChanged: (v) =>
                setState(() => _query = v.trim().toLowerCase()),
            cursorColor: VertexColors.gold600,
            style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 14,
                fontWeight: FontWeight.w600),
            decoration: _decoration(
                'Search by candidate, country, or job...', Icons.search),
          ),
          const SizedBox(height: 10),
          _filterDropdown(
            value: _stageFilter,
            options: ['All stages', ...stages],
            onChanged: (v) => setState(() => _stageFilter = v ?? _stageFilter),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _filterDropdown(
                  value: _statusFilter,
                  options: const [
                    'All statuses',
                    'Pending',
                    'Confirmed',
                    'Rejected',
                  ],
                  onChanged: (v) =>
                      setState(() => _statusFilter = v ?? _statusFilter),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _filterDropdown(
                  value: _sourceFilter,
                  options: const [
                    'All sources',
                    'self_registered',
                    'recruiter_sourced',
                    'partner_sourced',
                  ],
                  onChanged: (v) =>
                      setState(() => _sourceFilter = v ?? _sourceFilter),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),

          if (rows.isEmpty)
            _emptyState('No cases match your filters.')
          else
            for (final row in rows) _buildCaseCard(row),
        ],
      ),
    );
  }

  Widget _buildCaseCard(ManagementCaseRow row) {
    final opsColor = switch (row.opsReviewStatus) {
      'confirmed' => VertexColors.midnight500,
      'rejected' => VertexColors.error,
      _ => VertexColors.gold600,
    };
    final opsBg = switch (row.opsReviewStatus) {
      'confirmed' => const Color(0xFFE8F5E9),
      'rejected' => const Color(0xFFFFEBEE),
      _ => const Color(0xFFFFF8E1),
    };
    final source = _sourceLabels[row.source] ?? row.source;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: VertexColors.midnight800.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.folder_outlined,
                    color: VertexColors.midnight800, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      row.candidateName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                        color: VertexColors.midnight900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${row.jobTitle} · ${row.country}',
                      style: const TextStyle(
                          color: VertexColors.gray600, fontSize: 11),
                    ),
                  ],
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: opsBg,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  row.opsReviewStatus.toUpperCase(),
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    color: opsColor,
                  ),
                ),
              ),
            ],
          ),
          const Divider(height: 22, color: VertexColors.ivory200),
          Row(
            children: [
              _info('STAGE', row.currentStage),
              const SizedBox(width: 16),
              _info(
                'SOURCE',
                source,
                color: VertexColors.gold600,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  row.recruiterName != null
                      ? 'Recruiter: ${row.recruiterName}'
                      : row.partnerName != null
                          ? 'Partner: ${row.partnerName}'
                          : 'Self-Registered candidate',
                  style: const TextStyle(
                      color: VertexColors.gray600, fontSize: 11),
                ),
              ),
              Text(
                'Opened ${row.createdAt.day}/${row.createdAt.month}/${row.createdAt.year}',
                style: const TextStyle(
                    color: VertexColors.gray400, fontSize: 10),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _info(String label, String value, {Color? color}) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 8,
                color: VertexColors.gray600,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              value,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: color ?? VertexColors.midnight900,
              ),
            ),
          ],
        ),
      );

  InputDecoration _decoration(String hint, IconData icon) => InputDecoration(
        hintText: hint,
        hintStyle:
            const TextStyle(color: VertexColors.gray400, fontSize: 13),
        prefixIcon: Icon(icon, color: VertexColors.gold600, size: 20),
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide:
                const BorderSide(color: VertexColors.gold600, width: 1.4)),
      );

  Widget _filterDropdown({
    required String value,
    required List<String> options,
    required ValueChanged<String?> onChanged,
  }) =>
      DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        style: const TextStyle(
            color: VertexColors.gold600,
            fontSize: 13,
            fontWeight: FontWeight.w600),
        dropdownColor: Colors.white,
        iconEnabledColor: VertexColors.gold600,
        decoration: InputDecoration(
          filled: true,
          fillColor: Colors.white,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(11),
              borderSide: const BorderSide(color: VertexColors.ivory200)),
          enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(11),
              borderSide: const BorderSide(color: VertexColors.ivory200)),
          focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(11),
              borderSide:
                  const BorderSide(color: VertexColors.gold600, width: 1.4)),
        ),
        items: options
            .map((o) => DropdownMenuItem(
                value: o,
                child: Text(
                  o == 'self_registered'
                      ? 'Self-Registered'
                      : o == 'recruiter_sourced'
                          ? 'Recruiter-Sourced'
                          : o == 'partner_sourced'
                              ? 'Partner-Sourced'
                              : o,
                  style: const TextStyle(fontSize: 13),
                )))
            .toList(),
        onChanged: onChanged,
      );

  Widget _emptyState(String msg) => Container(
        padding: const EdgeInsets.all(36),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Center(
          child: Text(msg,
              style:
                  const TextStyle(color: VertexColors.gray600, fontSize: 13)),
        ),
      );
}