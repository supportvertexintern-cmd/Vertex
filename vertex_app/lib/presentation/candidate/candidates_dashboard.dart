import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../app/theme/typography.dart';
import '../../core/auth/candidate_store.dart';
import '../shared/recruiter_drawer.dart';

class CandidatesDashboard extends StatelessWidget {
  const CandidatesDashboard({super.key});

  @override
  Widget build(BuildContext context) {
    final records = context.watch<CandidateStore>().records;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const RecruiterDrawer(activeRoute: '/recruiter/candidates'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 72,
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu, color: Colors.white),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'RECRUITER WORKSPACE',
              style: VertexTypography.eyebrow.copyWith(
                color: VertexColors.gold300,
                fontSize: 9,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 3),
            const Text(
              'My Candidates',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Register new candidate',
            onPressed: () => context.push('/recruiter/intake'),
            icon: const Icon(Icons.person_add_alt_1, color: VertexColors.gold400),
          ),
          const SizedBox(width: 6),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/recruiter/intake'),
        backgroundColor: VertexColors.midnight800,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.person_add_alt_1, size: 20),
        label: const Text(
          'REGISTER',
          style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.0),
        ),
      ),
      body: records.isEmpty ? _empty(context) : _list(context, records),
    );
  }

  Widget _empty(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(36),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: VertexColors.ivory100,
                  shape: BoxShape.circle,
                  border: Border.all(color: VertexColors.ivory200),
                ),
                child: const Icon(
                  Icons.people_outline,
                  color: VertexColors.gold500,
                  size: 34,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'No candidates yet',
                style: VertexTypography.h2.copyWith(
                  color: VertexColors.midnight900,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Register your first intake record to start building your pipeline.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: VertexColors.gray600,
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: () => context.push('/recruiter/intake'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: VertexColors.midnight800,
                  foregroundColor: Colors.white,
                  shape: const StadiumBorder(),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 14,
                  ),
                ),
                icon: const Icon(Icons.person_add_alt_1, size: 18),
                label: const Text(
                  'REGISTER CANDIDATE',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                  ),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _list(BuildContext context, List<CandidateRecord> records) => Column(
        children: [
          // Summary band
          Container(
            color: VertexColors.midnight900,
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            child: Row(
              children: [
                _stat(records.length.toString(), 'TOTAL'),
                _divider(),
                _stat(
                  records
                      .where((r) =>
                          DateTime.now().difference(r.registeredAt).inDays < 7)
                      .length
                      .toString(),
                  'THIS WEEK',
                ),
                _divider(),
                _stat(
                  records
                      .where((r) =>
                          DateTime.now().difference(r.registeredAt).inDays < 30)
                      .length
                      .toString(),
                  'THIS MONTH',
                ),
              ],
            ),
          ),
          // List
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 100),
              itemCount: records.length,
              itemBuilder: (_, i) => _card(records[i]),
            ),
          ),
        ],
      );

  Widget _stat(String value, String label) => Expanded(
        child: Column(
          children: [
            Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white54,
                fontSize: 9,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.2,
              ),
            ),
          ],
        ),
      );

  Widget _divider() => Container(
        width: 1,
        height: 32,
        color: Colors.white12,
        margin: const EdgeInsets.symmetric(horizontal: 4),
      );

  Widget _card(CandidateRecord r) {
    final daysAgo = DateTime.now().difference(r.registeredAt).inDays;
    final timeLabel = daysAgo == 0
        ? 'Today'
        : daysAgo == 1
            ? 'Yesterday'
            : '$daysAgo days ago';

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
                r.fullName.isNotEmpty ? r.fullName[0].toUpperCase() : '?',
                style: const TextStyle(
                  color: VertexColors.midnight800,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(width: 13),
          // Info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.fullName,
                  style: const TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${r.nationality}  ·  ${r.opportunity}',
                  style: const TextStyle(
                    color: VertexColors.gray600,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: VertexColors.midnight500.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Text(
                        'Registered',
                        style: TextStyle(
                          color: VertexColors.midnight500,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      timeLabel,
                      style: const TextStyle(
                        color: VertexColors.gray400,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const Icon(
            Icons.arrow_forward_ios,
            color: VertexColors.gray400,
            size: 13,
          ),
        ],
      ),
    );
  }
}
