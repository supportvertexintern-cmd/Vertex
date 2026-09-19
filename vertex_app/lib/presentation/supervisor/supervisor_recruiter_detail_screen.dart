import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorRecruiterDetailScreen extends StatefulWidget {
  const SupervisorRecruiterDetailScreen({super.key, required this.recruiterId});

  final String recruiterId;

  @override
  State<SupervisorRecruiterDetailScreen> createState() =>
      _SupervisorRecruiterDetailScreenState();
}

class _SupervisorRecruiterDetailScreenState
    extends State<SupervisorRecruiterDetailScreen> {
  final _noteController = TextEditingController();
  final Map<String, TextEditingController> _campaignControllers = {};
  final Map<String, TextEditingController> _kpiControllers = {};
  KpiPeriod _kpiPeriod = KpiPeriod.daily;

  @override
  void dispose() {
    _noteController.dispose();
    for (final c in _campaignControllers.values) {
      c.dispose();
    }
    for (final c in _kpiControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  SupervisorStore get _store => context.read<SupervisorStore>();

  void _snack(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _switchKpiPeriod(KpiPeriod period) {
    final detail = _store.detailFor(widget.recruiterId);
    setState(() {
      _kpiPeriod = period;
      if (detail == null) return;
      for (final kpi in detail.kpiTargets) {
        final value = kpi.valueFor(period);
        _kpiControllers[kpi.metric]?.text = value == null ? '' : '$value';
      }
    });
  }

  void _saveKpiTarget(KpiTarget kpi) {
    final value =
        int.tryParse(_kpiControllers[kpi.metric]?.text.trim() ?? '');
    _store.updateKpiTarget(widget.recruiterId, kpi.metric, _kpiPeriod, value);
    _snack('KPI target saved.');
  }

  void _saveCampaignTarget(CampaignTargetRow target) {
    final value =
        int.tryParse(_campaignControllers[target.id]?.text.trim() ?? '');
    _store.updateCampaignTarget(widget.recruiterId, target.id, value ?? 0);
    _snack('Target saved.');
  }

  void _verifyReport(ReportRow report) {
    _store.verifyReport(widget.recruiterId, report.id);
    _snack('Report verified.');
  }

  Future<void> _showReturnDialog(ReportRow report) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _ReturnReportDialog(),
    );
    if (reason == null || !mounted) return;
    _store.returnReport(widget.recruiterId, report.id, reason);
    _snack('Report returned to recruiter.');
  }

  void _sendNote() {
    final text = _noteController.text.trim();
    if (text.isEmpty) return;
    final recruiter = _store.recruiterById(widget.recruiterId);
    _store.addNote(widget.recruiterId, text, 'Country Supervisor');
    _noteController.clear();
    _snack('Note sent${recruiter == null ? '' : ' to ${recruiter.name}'}.');
  }

  Future<void> _newScorecard() async {
    final recruiter = _store.recruiterById(widget.recruiterId);
    final title = await showDialog<String>(
      context: context,
      builder: (_) => const _NewScorecardDialog(),
    );
    if (title == null || !mounted) return;
    final name =
        title.trim().isEmpty ? '${recruiter?.name ?? 'Recruiter'} Review' : title.trim();
    _store.addScorecard(widget.recruiterId, name);
    _snack('Scorecard added.');
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<SupervisorStore>();
    final recruiter = store.recruiterById(widget.recruiterId);
    final detail = store.detailFor(widget.recruiterId);

    if (recruiter == null || detail == null) {
      return Scaffold(
        backgroundColor: VertexColors.ivory50,
        appBar: _backAppBar('Recruiter Detail'),
        body: const Center(
          child: Text(
            'Recruiter not found',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(activeRoute: '/supervisor/recruiters'),
      appBar: _backAppBar('Recruiter Detail'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 40),
        children: [
          _headerCard(recruiter),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _metricCard(
                  '${detail.candidatesThisMonth}',
                  'Candidates this month',
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _metricCard(
                  '${detail.conversionRateThisMonth.toStringAsFixed(0)}%',
                  'Conversion rate this month',
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // ── Progress vs target this month ───────────────────────────
          _sectionTitle('Progress vs target this month', Icons.track_changes),
          const SizedBox(height: 10),
          if (detail.targetProgress.isEmpty)
            _emptyText('No target set yet — set one below.')
          else
            ...detail.targetProgress.map(
              (p) => Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: VertexColors.ivory200),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        '${p.metric} (${p.campaignName})',
                        style: const TextStyle(
                          color: VertexColors.midnight900,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Text(
                      '${p.actualValue} / ${p.targetValue}',
                      style: const TextStyle(
                        color: VertexColors.gold600,
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 24),

          // ── Campaign target allocation ──────────────────────────────
          _sectionTitle('Campaign target allocation', Icons.assignment_outlined),
          const SizedBox(height: 10),
          if (detail.campaignTargets.isEmpty)
            _emptyText('No active campaign targets for your country yet.')
          else
            ...detail.campaignTargets.map(_campaignRow),
          const SizedBox(height: 24),

          // ── Reports ──────────────────────────────────────────────────
          _sectionTitle('Reports', Icons.description_outlined),
          const SizedBox(height: 10),
          if (detail.reports.isEmpty)
            _emptyText('No reports submitted yet.')
          else
            ...detail.reports.map(_reportTile),
          const SizedBox(height: 24),

          // ── KPI targets ──────────────────────────────────────────────
          _sectionTitle('KPI targets', Icons.format_list_numbered),
          const SizedBox(height: 10),
          _kpiPeriodSelector(),
          const SizedBox(height: 10),
          if (detail.kpiTargets.isEmpty)
            _emptyText('No KPI targets configured for this recruiter.')
          else
            ...detail.kpiTargets.map(_kpiRow),
          const SizedBox(height: 24),

          // ── Scorecard ─────────────────────────────────────────────────
          _sectionTitle('Supervisory Performance Scorecard', Icons.emoji_events_outlined),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _newScorecard,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: VertexColors.midnight800,
                    side: const BorderSide(color: VertexColors.midnight800),
                    shape: const StadiumBorder(),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text(
                    'NEW SCORECARD',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.8,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (detail.scorecards.isEmpty)
            _emptyText('No scorecards yet.')
          else
            ...detail.scorecards.map(
              (s) => Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: VertexColors.ivory200),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.emoji_events_outlined,
                        color: VertexColors.gold500, size: 18),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            s.title,
                            style: const TextStyle(
                              color: VertexColors.midnight900,
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _dateLabel(s.createdAt),
                            style: const TextStyle(
                                color: VertexColors.gray600, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 24),

          // ── Notes ─────────────────────────────────────────────────────
          _sectionTitle(
            'Notes to ${recruiter.name.split(' ').first}',
            Icons.chat_bubble_outline,
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: _noteController,
                  maxLines: 2,
                  cursorColor: VertexColors.gold600,
                  style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Write a note…',
                    hintStyle: const TextStyle(
                        color: VertexColors.gray400, fontSize: 12),
                    filled: true,
                    fillColor: Colors.white,
                    contentPadding: const EdgeInsets.all(12),
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
              ),
              const SizedBox(width: 8),
              IconButton(
                onPressed: _sendNote,
                icon: const Icon(Icons.send, color: VertexColors.gold600),
                style: IconButton.styleFrom(
                  backgroundColor: Colors.white,
                  side: const BorderSide(color: VertexColors.ivory200),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (detail.notes.isEmpty)
            _emptyText('No notes sent yet.')
          else
            ...detail.notes.map(_noteTile),
        ],
      ),
    );
  }

  AppBar _backAppBar(String title) => AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () => context.pop(),
          icon: const VertexCircleLeading(icon: Icons.arrow_back, iconSize: 18),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'AGENT NETWORK',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      );

  Widget _headerCard(Recruiter r) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: VertexColors.midnight800.withValues(alpha: 0.08),
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Text(
                  r.name.isNotEmpty ? r.name[0].toUpperCase() : '?',
                  style: const TextStyle(
                    color: VertexColors.midnight800,
                    fontSize: 20,
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
                    r.name,
                    style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    r.email,
                    style: const TextStyle(
                        color: VertexColors.gray600, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _metricCard(String value, String label) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 24,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: const TextStyle(
                color: VertexColors.gray600,
                fontSize: 10,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      );

  Widget _sectionTitle(String title, IconData icon) => Row(
        children: [
          Icon(icon, color: VertexColors.gold600, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              title.toUpperCase(),
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.0,
              ),
            ),
          ),
        ],
      );

  Widget _emptyText(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(
          text,
          style: const TextStyle(color: VertexColors.gray600, fontSize: 13),
        ),
      );

  Widget _campaignRow(CampaignTargetRow target) {
    final controller = _campaignControllers.putIfAbsent(
      target.id,
      () => TextEditingController(text: '${target.targetValue}'),
    );
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '${target.metric} (${target.campaignName})',
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          SizedBox(
            width: 70,
            child: TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              cursorColor: VertexColors.gold600,
              style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
              decoration: InputDecoration(
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
                filled: true,
                fillColor: VertexColors.ivory50,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: VertexColors.ivory200),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide:
                      const BorderSide(color: VertexColors.gold600, width: 1.2),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            onPressed: () => _saveCampaignTarget(target),
            style: TextButton.styleFrom(
              backgroundColor: VertexColors.midnight800,
              foregroundColor: Colors.white,
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: const Text(
              'Save',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }

  Widget _reportTile(ReportRow r) {
    final isPending = r.status == 'submitted';
    final periodLabel =
        '${r.periodStart.day}/${r.periodStart.month} - '
        '${r.periodEnd.day}/${r.periodEnd.month}';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isPending ? const Color(0xFFFFF8E1) : Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isPending ? VertexColors.gold500 : VertexColors.ivory200,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${r.type} · $periodLabel',
                  style: const TextStyle(
                    fontSize: 12,
                    color: VertexColors.gray600,
                  ),
                ),
              ),
              if (isPending)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextButton(
                      onPressed: () => _verifyReport(r),
                      child: const Text(
                        'VERIFY',
                        style: TextStyle(
                          color: VertexColors.midnight500,
                          fontWeight: FontWeight.w800,
                          fontSize: 11,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: () => _showReturnDialog(r),
                      child: const Text(
                        'RETURN',
                        style: TextStyle(
                          color: VertexColors.error,
                          fontWeight: FontWeight.w800,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                )
              else
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: r.status == 'verified'
                        ? const Color(0xFFE8F5E9)
                        : const Color(0xFFFFEBEE),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    r.status.toUpperCase(),
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: r.status == 'verified'
                          ? VertexColors.midnight500
                          : VertexColors.error,
                    ),
                  ),
                ),
            ],
          ),
          if (r.notes != null) ...[
            const SizedBox(height: 8),
            Text(
              r.notes!,
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 13,
              ),
            ),
          ],
          if (r.returnReason != null) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFFFEBEE).withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                'Return reason: ${r.returnReason}',
                style: const TextStyle(
                  color: VertexColors.error,
                  fontSize: 12,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _kpiPeriodSelector() => Row(
        children: [
          for (final (period, label) in const [
            (KpiPeriod.daily, 'Daily'),
            (KpiPeriod.weekly, 'Weekly'),
            (KpiPeriod.monthly, 'Monthly'),
          ])
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(
                  label,
                  style: TextStyle(
                    color: _kpiPeriod == period
                        ? Colors.white
                        : VertexColors.gold600,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                selected: _kpiPeriod == period,
                selectedColor: VertexColors.gold600,
                backgroundColor: Colors.white,
                side: const BorderSide(color: VertexColors.ivory200),
                showCheckmark: false,
                onSelected: (_) => _switchKpiPeriod(period),
              ),
            ),
        ],
      );

  Widget _kpiRow(KpiTarget kpi) {
    final controller = _kpiControllers.putIfAbsent(
      kpi.metric,
      () => TextEditingController(
          text: kpi.valueFor(_kpiPeriod)?.toString() ?? ''),
    );
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              kpi.metric,
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          SizedBox(
            width: 66,
            child: TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              cursorColor: VertexColors.gold600,
              style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
              decoration: InputDecoration(
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 9, vertical: 9),
                hintText: 'Target',
                hintStyle: const TextStyle(
                    color: VertexColors.gray400, fontSize: 11),
                filled: true,
                fillColor: VertexColors.ivory50,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: VertexColors.ivory200),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide:
                      const BorderSide(color: VertexColors.gold600, width: 1.2),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            onPressed: () => _saveKpiTarget(kpi),
            style: TextButton.styleFrom(
              backgroundColor: VertexColors.midnight800,
              foregroundColor: Colors.white,
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: const Text(
              'Save',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }

  Widget _noteTile(NoteRow n) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${n.authorName} · ${_dateLabel(n.createdAt)}',
              style: const TextStyle(
                  color: VertexColors.gray600, fontSize: 11),
            ),
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: VertexColors.ivory200),
              ),
              child: Text(
                n.message,
                style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 13,
                ),
              ),
            ),
          ],
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

class _ReturnReportDialog extends StatefulWidget {
  const _ReturnReportDialog();

  @override
  State<_ReturnReportDialog> createState() => _ReturnReportDialogState();
}

class _ReturnReportDialogState extends State<_ReturnReportDialog> {
  final _controller = TextEditingController();
  bool get _valid => _controller.text.trim().length >= 5;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text(
        'Return Report',
        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
      content: TextField(
        controller: _controller,
        maxLines: 3,
        autofocus: true,
        onChanged: (_) => setState(() {}),
        decoration: InputDecoration(
          hintText: 'Reason for return (min 5 chars)…',
          border: const OutlineInputBorder(
            borderSide: BorderSide(color: VertexColors.ivory200),
          ),
          enabledBorder: const OutlineInputBorder(
            borderSide: BorderSide(color: VertexColors.ivory200),
          ),
          focusedBorder: const OutlineInputBorder(
            borderSide: BorderSide(color: VertexColors.gold600, width: 1.2),
          ),
          errorText: _valid ? null : 'Please enter at least 5 characters.',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('CANCEL',
              style: TextStyle(color: VertexColors.gray600)),
        ),
        ElevatedButton(
          onPressed: _valid
              ? () => Navigator.of(context).pop(_controller.text.trim())
              : null,
          style: ElevatedButton.styleFrom(
            backgroundColor: VertexColors.error,
            foregroundColor: Colors.white,
          ),
          child: const Text('RETURN'),
        ),
      ],
    );
  }
}

class _NewScorecardDialog extends StatefulWidget {
  const _NewScorecardDialog();

  @override
  State<_NewScorecardDialog> createState() => _NewScorecardDialogState();
}

class _NewScorecardDialogState extends State<_NewScorecardDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text(
        'New Scorecard',
        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
      content: TextField(
        controller: _controller,
        autofocus: true,
        decoration: const InputDecoration(
          hintText: 'Scorecard title (e.g. Q3 2026 Review)',
          border: OutlineInputBorder(
            borderSide: BorderSide(color: VertexColors.ivory200),
          ),
          enabledBorder: OutlineInputBorder(
            borderSide: BorderSide(color: VertexColors.ivory200),
          ),
          focusedBorder: OutlineInputBorder(
            borderSide: BorderSide(color: VertexColors.gold600, width: 1.2),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('CANCEL',
              style: TextStyle(color: VertexColors.gray600)),
        ),
        ElevatedButton(
          onPressed: () => Navigator.of(context).pop(_controller.text),
          style: ElevatedButton.styleFrom(
            backgroundColor: VertexColors.midnight800,
            foregroundColor: Colors.white,
          ),
          child: const Text('CREATE'),
        ),
      ],
    );
  }
}