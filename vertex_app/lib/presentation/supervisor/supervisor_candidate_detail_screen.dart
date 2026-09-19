import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorCandidateDetailScreen extends StatelessWidget {
  const SupervisorCandidateDetailScreen({super.key, required this.candidateId});

  final String candidateId;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<SupervisorStore>();
    final candidate = store.candidateById(candidateId);
    final (statusColor, statusLabel) =
        candidate == null ? _statusStyle('') : _statusStyle(candidate.status);

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(activeRoute: '/supervisor/candidates'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () => context.pop(),
          icon: const VertexCircleLeading(icon: Icons.arrow_back, iconSize: 18),
        ),
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
              'Candidate Detail',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: candidate == null
          ? _notFound()
          : SafeArea(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
                children: [
                  _headerCard(candidate, statusColor, statusLabel),
                  const SizedBox(height: 22),
                  const _SectionLabel('PROGRAMME & PROFILE'),
                  const SizedBox(height: 10),
                  _profileCard(candidate),
                  const SizedBox(height: 22),
                  const _SectionLabel('VERIFICATION STATUS'),
                  const SizedBox(height: 10),
                  _verificationCard(candidate, statusColor, statusLabel),
                ],
              ),
            ),
    );
  }

  Widget _headerCard(
          SupervisorCandidate c, Color statusColor, String statusLabel) =>
      Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: VertexColors.midnight800.withValues(alpha: 0.08),
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Text(
                  c.fullName.isNotEmpty ? c.fullName[0].toUpperCase() : '?',
                  style: const TextStyle(
                    color: VertexColors.midnight800,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    c.fullName,
                    style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'Candidate #${c.id}',
                    style: const TextStyle(
                        color: VertexColors.gray600, fontSize: 12),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      statusLabel,
                      style: TextStyle(
                        color: statusColor,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _profileCard(SupervisorCandidate c) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Column(
          children: [
            _infoRow(Icons.public_outlined, 'Nationality', c.nationality),
            _infoRow(Icons.work_outline, 'Opportunity', c.opportunity),
            if (c.gender != null)
              _infoRow(Icons.person_outline, 'Gender', c.gender!),
            if (c.phone != null)
              _infoRow(Icons.phone_outlined, 'Phone', c.phone!),
            if (c.email != null) _infoRow(Icons.mail_outline, 'Email', c.email!),
            if (c.passportNumber != null)
              _infoRow(
                  Icons.badge_outlined, 'Passport number', c.passportNumber!),
            _infoRow(
              Icons.event_outlined,
              'Registered',
              _dateLabel(c.registeredAt),
            ),
          ],
        ),
      );

  Widget _infoRow(IconData icon, String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Icon(icon, color: VertexColors.gold500, size: 18),
            const SizedBox(width: 12),
            SizedBox(
              width: 118,
              child: Text(
                label.toUpperCase(),
                style: const TextStyle(
                  color: VertexColors.gray600,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                ),
              ),
            ),
            Expanded(
              child: Text(
                value,
                style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      );

  Widget _verificationCard(
          SupervisorCandidate c, Color statusColor, String statusLabel) =>
      Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_outlined,
                    color: statusColor, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Current status: $statusLabel',
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            for (final (index, step) in _verificationSteps(c).indexed) ...[
              _stepTile(
                number: index + 1,
                label: step.$1,
                done: step.$2,
                last: index == 3,
              ),
            ],
          ],
        ),
      );

  List<(String, bool)> _verificationSteps(SupervisorCandidate c) {
    final status = c.status;
    return [
      ('Candidate intake recorded', status.isNotEmpty),
      (
        'Documents verified in country',
        status != 'Pending Verification' && status.isNotEmpty
      ),
      (
        'Embassy appointment booked',
        status == 'Visa Processing' || status == 'Ready to Depart'
      ),
      ('Visa granted', status == 'Ready to Depart'),
    ];
  }

  Widget _stepTile({
    required int number,
    required String label,
    required bool done,
    required bool last,
  }) =>
      IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Column(
              children: [
                Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: done
                        ? VertexColors.midnight500
                        : VertexColors.ivory100,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: done
                          ? VertexColors.midnight500
                          : VertexColors.ivory200,
                    ),
                  ),
                  child: Icon(
                    done ? Icons.check : Icons.circle_outlined,
                    color: done ? Colors.white : VertexColors.gray400,
                    size: 14,
                  ),
                ),
                if (!last)
                  Expanded(
                    child: Container(
                      width: 1,
                      color: done
                          ? VertexColors.midnight500
                          : VertexColors.ivory200,
                    ),
                  ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: last ? 0 : 16),
                child: Text(
                  label,
                  style: TextStyle(
                    color: done
                        ? VertexColors.midnight900
                        : VertexColors.gray600,
                    fontSize: 12.5,
                    fontWeight: done ? FontWeight.w700 : FontWeight.w400,
                  ),
                ),
              ),
            ),
          ],
        ),
      );

  Widget _notFound() => const Center(
        child: Padding(
          padding: EdgeInsets.all(36),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.person_off_outlined,
                  color: VertexColors.midnight500, size: 44),
              SizedBox(height: 16),
              Text(
                'Candidate not found',
                style: TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      );

  String _dateLabel(DateTime date) {
    final months = const [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${date.day.toString().padLeft(2, '0')} '
        '${months[date.month - 1]} ${date.year}';
  }
}

(Color, String) _statusStyle(String status) => switch (status) {
      'Pending Verification' => (VertexColors.gold600, 'Pending Verification'),
      'In Process' => (VertexColors.info, 'In Process'),
      'Visa Processing' => (VertexColors.midnight500, 'Visa Processing'),
      'Ready to Depart' => (VertexColors.success, 'Ready to Depart'),
      _ => (VertexColors.gray400, status),
    };

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Text(
        label,
        style: const TextStyle(
          color: VertexColors.gray600,
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      );
}