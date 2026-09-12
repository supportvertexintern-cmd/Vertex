import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/auth_manager.dart';
import '../../core/auth/candidate_store.dart';
import '../shared/recruiter_drawer.dart';
import 'widgets/metric_card.dart';
import 'widgets/workspace_link.dart';

class RecruiterOverview extends StatelessWidget {
  const RecruiterOverview({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthManager>();
    final store = context.watch<CandidateStore>();
    final total = store.records.length;
    final thisWeek = store.records
        .where((r) => DateTime.now().difference(r.registeredAt).inDays < 7)
        .length;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const RecruiterDrawer(activeRoute: '/recruiter'),
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
            const Text(
              'RECRUITER WORKSPACE',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 3),
            const Text(
              'Overview',
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
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
        children: [
          // Greeting
          Text(
            'Welcome back${auth.role != null ? ', ${auth.role!.displayLabel}' : ''}.',
            style: const TextStyle(
              color: VertexColors.midnight900,
              fontSize: 20,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Here\'s a snapshot of your pipeline.',
            style: TextStyle(color: VertexColors.gray600, fontSize: 13),
          ),
          const SizedBox(height: 20),

          // Metrics row
          Row(
            children: [
              MetricCard(
                value: total.toString(),
                label: 'Total candidates',
                icon: Icons.people_outline,
                accent: VertexColors.midnight500,
              ),
              const SizedBox(width: 10),
              MetricCard(
                value: thisWeek.toString(),
                label: 'Registered this week',
                icon: Icons.person_add_alt_1_outlined,
                accent: VertexColors.gold500,
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Workspace section
          const Text(
            'WORKSPACE',
            style: TextStyle(
              color: VertexColors.gray400,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.4,
            ),
          ),
          const SizedBox(height: 8),
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: VertexColors.ivory200),
            ),
            child: Column(
              children: [
                WorkspaceLink(
                  icon: Icons.people_outline,
                  label: 'My intake records',
                  onTap: () => context.go('/recruiter/candidates'),
                ),
                const Divider(height: 1, indent: 16, endIndent: 16, color: VertexColors.ivory200),
                WorkspaceLink(
                  icon: Icons.person_add_alt_1_outlined,
                  label: 'Register new candidate',
                  onTap: () => context.push('/recruiter/intake'),
                ),
                const Divider(height: 1, indent: 16, endIndent: 16, color: VertexColors.ivory200),
                WorkspaceLink(
                  icon: Icons.bar_chart_outlined,
                  label: 'Reports',
                  onTap: () => context.go('/recruiter/reports'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
