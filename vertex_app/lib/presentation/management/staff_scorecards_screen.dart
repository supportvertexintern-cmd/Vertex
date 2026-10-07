import 'package:flutter/material.dart';
import '../../app/theme/colors.dart';
import '../../data/models/management_models.dart';
import '../shared/vertex_app_bar_leading.dart';
import '../director/director_drawer.dart';

class ManagementStaffScorecardsScreen extends StatefulWidget {
  const ManagementStaffScorecardsScreen({super.key});

  @override
  State<ManagementStaffScorecardsScreen> createState() =>
      _ManagementStaffScorecardsScreenState();
}

class _ManagementStaffScorecardsScreenState
    extends State<ManagementStaffScorecardsScreen> {
  bool _loading = true;
  List<StaffScorecardRow> _staff = [];
  String? _expandedId;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadStaff();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadStaff() async {
    await Future.delayed(const Duration(milliseconds: 500));
    setState(() {
      _staff = [
        StaffScorecardRow(
          id: '1',
          fullName: 'In-House Supervisor A',
          assignedCountries: ['Kenya', 'Nigeria', 'Ghana'],
        ),
        StaffScorecardRow(
          id: '2',
          fullName: 'In-House Supervisor B',
          assignedCountries: ['Poland', 'Germany'],
        ),
      ];
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/staff-scorecards'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'CONTROL',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Staff Scorecards',
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
        padding: const EdgeInsets.all(18),
        children: [
          const Text(
            'Staff Scorecards.',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 28,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Monthly Supervisory Performance Scorecards for each In-House Supervisor.',
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 20),

          TextField(
            controller: _searchController,
            onChanged: (v) => setState(() {}),
            decoration: _decoration('Search by name...', Icons.search),
          ),
          const SizedBox(height: 16),

          if (_loading)
            const Center(
                child: CircularProgressIndicator(color: VertexColors.midnight500))
          else if (_staff.isEmpty)
            _emptyState('No In-House Supervisors on file yet.')
          else
            ..._filtered().map((s) => _buildStaffCard(s)),
        ],
      ),
    );
  }

  Widget _buildStaffCard(StaffScorecardRow s) {
    final isExpanded = _expandedId == s.id;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Column(
        children: [
          // Header (Tap to expand)
          InkWell(
            onTap: () => setState(() => _expandedId = isExpanded ? null : s.id),
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const Icon(Icons.verified_user_outlined,
                      color: VertexColors.gold600, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          s.fullName,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 15,
                            color: VertexColors.midnight900,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          s.assignedCountries.isEmpty
                              ? 'No country assigned'
                              : s.assignedCountries.join(', '),
                          style: const TextStyle(
                            color: VertexColors.gray600,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                    color: VertexColors.gold600,
                  ),
                ],
              ),
            ),
          ),

          // Expanded Panels
          if (isExpanded) ...[
            const Divider(height: 1, color: VertexColors.ivory200),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // KPI Target Panel (Mocked)
                  const Text(
                    'KPI TARGETS',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: VertexColors.midnight900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: VertexColors.ivory50,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Verified Candidates Target',
                          style: TextStyle(
                            fontSize: 12,
                            color: VertexColors.midnight900,
                          ),
                        ),
                        Text(
                          '150',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: VertexColors.gold600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Scorecard Panel (Mocked)
                  const Text(
                    'MONTHLY SCORECARD',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: VertexColors.midnight900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: VertexColors.ivory50,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      children: [
                        _scoreRow('Reporting Timeliness', 'A'),
                        _scoreRow('Team Performance', 'B+'),
                        _scoreRow('Exception Handling', 'A-'),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _scoreRow(String label, String grade) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: VertexColors.midnight900,
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: VertexColors.midnight500.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                grade,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: VertexColors.midnight500,
                ),
              ),
            ),
          ],
        ),
      );

  List<StaffScorecardRow> _filtered() {
    final needle = _searchController.text.trim().toLowerCase();
    return _staff
        .where((s) => needle.isEmpty || s.fullName.toLowerCase().contains(needle))
        .toList();
  }

  Widget _emptyState(String msg) => Container(
        padding: const EdgeInsets.all(40),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Center(
            child: Text(msg,
                style: const TextStyle(color: VertexColors.gray600, fontSize: 13))),
      );

  InputDecoration _decoration(String hint, IconData icon) => InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: VertexColors.gray400, fontSize: 13),
        prefixIcon: Icon(icon, color: VertexColors.gold600, size: 20),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.gold600, width: 1.4)),
      );
}
