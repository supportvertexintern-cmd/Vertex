import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/colors.dart';
import '../../data/models/management_models.dart';
import '../shared/vertex_app_bar_leading.dart';
import '../director/director_drawer.dart';

class ManagementReportsScreen extends StatefulWidget {
  const ManagementReportsScreen({super.key});

  @override
  State<ManagementReportsScreen> createState() =>
      _ManagementReportsScreenState();
}

class _ManagementReportsScreenState extends State<ManagementReportsScreen> {
  // Metrics State
  String _cadence = 'weekly';
  final _metricsSearchController = TextEditingController();
  String _countryFilter = 'All countries';
  bool _loadingMetrics = true;
  List<ReportMetricsRow> _metrics = [];

  // Portfolio Reports State
  bool _loadingReports = true;
  List<PortfolioReportRow> _portfolioReports = [];

  @override
  void initState() {
    super.initState();
    _loadMetrics();
    _loadPortfolioReports();
  }

  @override
  void dispose() {
    _metricsSearchController.dispose();
    super.dispose();
  }

  Future<void> _loadMetrics() async {
    await Future.delayed(const Duration(milliseconds: 400));
    setState(() {
      _metrics = [
        ReportMetricsRow(
          id: '1',
          fullName: 'Kenya Regional Recruiter',
          role: 'regional_recruiter',
          countryName: 'Kenya',
          submittedCount: 12,
          verifiedCount: 10,
          returnedCount: 2,
          lastReportAt: DateTime.now().subtract(const Duration(days: 1)),
        ),
        ReportMetricsRow(
          id: '2',
          fullName: 'Nigeria Supervisor',
          role: 'country_supervisor',
          countryName: 'Nigeria',
          submittedCount: 4,
          verifiedCount: 3,
          returnedCount: 1,
          lastReportAt: DateTime.now().subtract(const Duration(days: 3)),
        ),
      ];
      _loadingMetrics = false;
    });
  }

  Future<void> _loadPortfolioReports() async {
    await Future.delayed(const Duration(milliseconds: 500));
    setState(() {
      _portfolioReports = [
        PortfolioReportRow(
          id: 'r1',
          type: 'monthly',
          status: 'submitted',
          periodStart: DateTime.now().subtract(const Duration(days: 30)),
          periodEnd: DateTime.now(),
          submitterName: 'In-House Supervisor',
        ),
        PortfolioReportRow(
          id: 'r2',
          type: 'weekly',
          status: 'verified',
          periodStart: DateTime.now().subtract(const Duration(days: 7)),
          periodEnd: DateTime.now(),
          submitterName: 'In-House Supervisor',
        ),
      ];
      _loadingReports = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final countries =
        _metrics.map((m) => m.countryName).whereType<String>().toSet().toList();
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/reports'),
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
              'Reports',
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
            'Reports.',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 28,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Submission metrics for every recruiter and country supervisor, and the actual In-House Supervisor portfolio reports submitted to you.',
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 24),

          // Section 1: Report Submission Metrics
          const Text(
            'REPORT SUBMISSION METRICS',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: ['daily', 'weekly', 'monthly'].map((c) {
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(
                    c.toUpperCase(),
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: _cadence == c ? Colors.white : VertexColors.midnight900,
                    ),
                  ),
                  selected: _cadence == c,
                  onSelected: (v) => setState(() => _cadence = c),
                  selectedColor: VertexColors.midnight900,
                  backgroundColor: VertexColors.ivory100,
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _metricsSearchController,
            onChanged: (v) => setState(() {}),
            decoration: _decoration('Search by name...', Icons.search),
          ),
          const SizedBox(height: 10),
          _dropdown(
            'All countries',
            ['All countries', ...countries],
            (v) => setState(() => _countryFilter = v!),
          ),
          const SizedBox(height: 16),
          if (_loadingMetrics)
            const Center(
                child: CircularProgressIndicator(color: VertexColors.midnight500))
          else if (_filteredMetrics().isEmpty)
            _emptyState('No staff match your filters.')
          else
            ..._filteredMetrics().map((m) => _buildMetricCard(m)),

          const SizedBox(height: 32),

          // Section 2: Portfolio Reports
          const Text(
            'PORTFOLIO REPORTS (IN-HOUSE → MANAGEMENT)',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 10),
          if (_loadingReports)
            const Center(
                child: CircularProgressIndicator(color: VertexColors.midnight500))
          else if (_portfolioReports.isEmpty)
            _emptyState('No portfolio reports yet.')
          else
            ..._portfolioReports.map((r) => _buildPortfolioCard(r)),
        ],
      ),
    );
  }

  Widget _buildMetricCard(ReportMetricsRow m) => Container(
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
            Text(
              m.fullName,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 15,
                color: VertexColors.midnight900,
              ),
            ),
            Text(
              '${m.role.replaceAll('_', ' ').toUpperCase()} · ${m.countryName ?? '—'}',
              style: const TextStyle(color: VertexColors.gray600, fontSize: 11),
            ),
            const Divider(height: 20, color: VertexColors.ivory200),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _stat('Submitted', m.submittedCount.toString(),
                    VertexColors.midnight900),
                _stat('Verified', m.verifiedCount.toString(),
                    VertexColors.midnight500),
                _stat('Returned', m.returnedCount.toString(), VertexColors.error),
                _stat(
                    'Last',
                    m.lastReportAt != null
                        ? '${m.lastReportAt!.day}/${m.lastReportAt!.month}'
                        : '—',
                    VertexColors.gray600),
              ],
            ),
          ],
        ),
      );

  Widget _buildPortfolioCard(PortfolioReportRow r) {
    final isPending = r.status == 'submitted';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: InkWell(
        onTap: () => context.push('/management/reports/${r.id}'),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        r.type.toUpperCase(),
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                          color: VertexColors.midnight900,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding:
                            const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: isPending
                              ? const Color(0xFFFFF8E1)
                              : const Color(0xFFE8F5E9),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          r.status.toUpperCase(),
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            color: isPending
                                ? VertexColors.gold600
                                : VertexColors.midnight500,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${r.submitterName} · ${r.periodStart.day}/${r.periodStart.month} - ${r.periodEnd.day}/${r.periodEnd.month}',
                    style: const TextStyle(
                      color: VertexColors.gray600,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: VertexColors.gold600, size: 20),
          ],
        ),
      ),
    );
  }

  Widget _stat(String label, String value, Color color) => Column(
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 9,
              color: VertexColors.gray600,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              fontSize: 14,
              color: color,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      );

  List<ReportMetricsRow> _filteredMetrics() {
    final needle = _metricsSearchController.text.trim().toLowerCase();
    return _metrics.where((m) {
      if (_countryFilter != 'All countries' && m.countryName != _countryFilter) {
        return false;
      }
      if (needle.isNotEmpty && !m.fullName.toLowerCase().contains(needle)) {
        return false;
      }
      return true;
    }).toList();
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

  Widget _dropdown(String label, List<String> options,
          ValueChanged<String?> onChanged) =>
      DropdownButtonFormField<String>(
        initialValue: label,
        isExpanded: true,
        style: const TextStyle(
          color: VertexColors.gold600,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
        decoration: InputDecoration(
          filled: true,
          fillColor: Colors.white,
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(11),
              borderSide: const BorderSide(color: VertexColors.ivory200)),
        ),
        items: options
            .map((o) => DropdownMenuItem(
                  value: o,
                  child: Text(o, style: const TextStyle(fontSize: 12)),
                ))
            .toList(),
        onChanged: onChanged,
      );
}
