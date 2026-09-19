import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorRecruitersScreen extends StatefulWidget {
  const SupervisorRecruitersScreen({super.key});

  @override
  State<SupervisorRecruitersScreen> createState() =>
      _SupervisorRecruitersScreenState();
}

class _SupervisorRecruitersScreenState extends State<SupervisorRecruitersScreen> {
  final _searchController = TextEditingController();
  String _sortBy = 'Name';
  bool _sortAscending = true;
  final bool _loading = false;

  static const _sortOptions = ['Name', 'Candidates', 'Conversion', 'Last Report'];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Recruiter> _filteredAndSorted(List<Recruiter> recruiters) {
    final needle = _searchController.text.trim().toLowerCase();
    final list = needle.isEmpty
        ? List.of(recruiters)
        : recruiters
            .where((r) =>
                r.name.toLowerCase().contains(needle) ||
                r.email.toLowerCase().contains(needle))
            .toList();

    list.sort((a, b) {
      int diff;
      switch (_sortBy) {
        case 'Candidates':
          diff = a.totalCandidates.compareTo(b.totalCandidates);
        case 'Conversion':
          diff = a.conversionRate.compareTo(b.conversionRate);
        case 'Last Report':
          diff = (a.lastReportAt ?? DateTime(0)).compareTo(b.lastReportAt ?? DateTime(0));
        default:
          diff = a.name.toLowerCase().compareTo(b.name.toLowerCase());
      }
      return _sortAscending ? diff : -diff;
    });
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final recruiters = context.watch<SupervisorStore>().recruiters;
    final visible = _filteredAndSorted(recruiters);

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(activeRoute: '/supervisor/recruiters'),
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
              'Recruiters',
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
                  'Recruiters.',
                  style: TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 7),
                const Text(
                  'Every recruiter under you, all-time candidates sourced, and conversion rate. Tap a recruiter to set targets, review reports, and leave a note.',
                  style: TextStyle(
                    color: VertexColors.gray600,
                    fontSize: 13,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _searchController,
                  onChanged: (v) => setState(() {}),
                  cursorColor: VertexColors.gold600,
                  style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Search by name or email...',
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
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Text('Sort by: ',
                        style: TextStyle(color: VertexColors.gray600, fontSize: 12)),
                    DropdownButton<String>(
                      value: _sortBy,
                      underline: const SizedBox(),
                      dropdownColor: Colors.white,
                      style: const TextStyle(
                        color: VertexColors.gold600,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                      items: _sortOptions
                          .map((s) => DropdownMenuItem(
                                value: s,
                                child: Text(s),
                              ))
                          .toList(),
                      onChanged: (v) => setState(() => _sortBy = v ?? 'Name'),
                    ),
                    const Spacer(),
                    Text(
                      _sortAscending ? 'ASC' : 'DESC',
                      style: const TextStyle(
                        color: VertexColors.gray600,
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.8,
                      ),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      tooltip: _sortAscending ? 'Ascending' : 'Descending',
                      icon: Icon(
                        _sortAscending ? Icons.arrow_upward : Icons.arrow_downward,
                        color: VertexColors.gold600,
                        size: 18,
                      ),
                      onPressed: () =>
                          setState(() => _sortAscending = !_sortAscending),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(
                        color: VertexColors.midnight500))
                : visible.isEmpty
                    ? _empty(context, recruiters.isEmpty)
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                        itemCount: visible.length,
                        itemBuilder: (_, i) => _recruiterCard(visible[i]),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _empty(BuildContext context, bool noRecruitersAtAll) => Center(
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
                child: const Icon(Icons.people_outline,
                    color: VertexColors.midnight500, size: 34),
              ),
              const SizedBox(height: 20),
              Text(
                noRecruitersAtAll
                    ? 'No recruiters assigned'
                    : 'No matches found',
                style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                noRecruitersAtAll
                    ? 'Recruiters assigned to your country will appear here.'
                    : 'Try adjusting your search or sort.',
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

  Widget _recruiterCard(Recruiter r) {
    final initial = r.name.isNotEmpty ? r.name[0].toUpperCase() : '?';
    final lastReport = r.lastReportAt == null
        ? '—'
        : '${r.lastReportAt!.day.toString().padLeft(2, '0')}/'
            '${r.lastReportAt!.month.toString().padLeft(2, '0')}/'
            '${r.lastReportAt!.year}';

    return InkWell(
      onTap: () => context.push('/supervisor/recruiters/${r.id}'),
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
                    r.name,
                    style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    r.email,
                    style: const TextStyle(
                        color: VertexColors.gray600, fontSize: 12),
                  ),
                  const SizedBox(height: 9),
                  Row(
                    children: [
                      _miniMetric('${r.totalCandidates}', 'CANDIDATES'),
                      _miniDivider(),
                      _miniMetric(r.conversionRate.toStringAsFixed(0), 'CONVERSION %'),
                      _miniDivider(),
                      _miniMetric(lastReport, 'LAST REPORT'),
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