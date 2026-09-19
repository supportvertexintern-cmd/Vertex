import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorReportDetailScreen extends StatefulWidget {
  const SupervisorReportDetailScreen({super.key, required this.reportId});

  final String reportId;

  @override
  State<SupervisorReportDetailScreen> createState() =>
      _SupervisorReportDetailScreenState();
}

class _SupervisorReportDetailScreenState
    extends State<SupervisorReportDetailScreen> {
  late final TextEditingController _returnController;
  late final TextEditingController _editController;
  bool _editing = false;

  @override
  void initState() {
    super.initState();
    _returnController = TextEditingController();
    _editController = TextEditingController();
  }

  @override
  void dispose() {
    _returnController.dispose();
    _editController.dispose();
    super.dispose();
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _verify(SupervisorStore store) {
    store.verifyReport(widget.reportId);
    _snack('Report verified.');
  }

  void _return(SupervisorStore store) {
    final reason = _returnController.text.trim();
    if (reason.length < 5) return;
    store.returnReport(widget.reportId, reason);
    _returnController.clear();
    _snack('Report returned to recruiter.');
  }

  void _resubmit(SupervisorStore store) {
    final updated = _editController.text.trim();
    if (updated.length < 5) return;
    store.resubmitCountryReport(widget.reportId, updated);
    setState(() => _editing = false);
    _snack('Report resubmitted.');
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<SupervisorStore>();
    final report = store.reportById(widget.reportId);

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(activeRoute: '/supervisor/reports'),
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
              'Report Detail',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: report == null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Report not found.',
                    style: TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'This report may have been removed.',
                    style: TextStyle(color: VertexColors.gray600, fontSize: 13),
                  ),
                  const SizedBox(height: 18),
                  OutlinedButton.icon(
                    onPressed: () => _back(context),
                    icon: const Icon(Icons.arrow_back, size: 18),
                    label: const Text('Back to reports'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: VertexColors.midnight800,
                      side: const BorderSide(color: VertexColors.ivory200),
                    ),
                  ),
                ],
              ),
            )
          : _buildBody(context, store, report),
    );
  }

  Widget _buildBody(BuildContext context, SupervisorStore store, ReportRow report) {
    final isMine = report.scopeLevel == 'country';
    final isPending = report.status == 'submitted';
    final isReturned = report.status == 'returned';
    final periodText =
        '${report.periodStart.day}/${report.periodStart.month}/${report.periodStart.year}'
        ' - ${report.periodEnd.day}/${report.periodEnd.month}/${report.periodEnd.year}';
    final statusColor = isPending
        ? VertexColors.gold600
        : (isReturned ? VertexColors.error : VertexColors.midnight500);
    final statusBg = isPending
        ? const Color(0xFFFFF8E1)
        : (isReturned ? const Color(0xFFFFEBEE) : const Color(0xFFE8F5E9));

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 100),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                isMine ? 'Your country report' : 'Submitted by ${report.submitterName}',
                style: const TextStyle(color: VertexColors.gray600, fontSize: 13),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: statusBg,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                report.status.toUpperCase(),
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  color: statusColor,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 3),
        Text(
          periodText,
          style: const TextStyle(color: VertexColors.gray600, fontSize: 12),
        ),
        const SizedBox(height: 18),

        if (isReturned && report.returnReason != null) ...[
          Container(
            padding: const EdgeInsets.all(12),
            margin: const EdgeInsets.only(bottom: 16),
            decoration: BoxDecoration(
              color: const Color(0xFFFFEBEE),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: VertexColors.error.withValues(alpha: 0.3)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.report_problem_outlined,
                    color: VertexColors.error, size: 18),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '${isMine ? 'Returned by In-House' : 'Returned'}: ${report.returnReason}',
                    style: const TextStyle(
                      color: VertexColors.error,
                      fontSize: 13,
                      height: 1.45,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],

        _headerCard(context, report, periodText),
        const SizedBox(height: 22),

        if (!isMine && isPending) ...[
          ElevatedButton.icon(
            onPressed: () => _verify(store),
            icon: const Icon(Icons.check_circle_outline, size: 18),
            label: const Text(
              'VERIFY REPORT',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: VertexColors.midnight800,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 48),
              shape: const StadiumBorder(),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: ValueListenableBuilder<TextEditingValue>(
                  valueListenable: _returnController,
                  builder: (context, value, _) {
                    final tooShort =
                        value.text.trim().isNotEmpty && value.text.trim().length < 5;
                    return TextField(
                      controller: _returnController,
                      maxLines: 1,
                      decoration: InputDecoration(
                        hintText: 'Reason for return...',
                        hintStyle: const TextStyle(fontSize: 12),
                        errorText: tooShort
                            ? 'Reason must be at least 5 characters'
                            : null,
                        filled: true,
                        fillColor: Colors.white,
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 13),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(11),
                          borderSide: const BorderSide(color: VertexColors.ivory200),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(11),
                          borderSide: const BorderSide(color: VertexColors.ivory200),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(11),
                          borderSide: const BorderSide(
                              color: VertexColors.error, width: 1.3),
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(width: 8),
              ValueListenableBuilder<TextEditingValue>(
                valueListenable: _returnController,
                builder: (context, value, _) => ElevatedButton(
                  onPressed: value.text.trim().length < 5
                      ? null
                      : () => _return(store),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: VertexColors.error,
                    foregroundColor: Colors.white,
                    shape: const StadiumBorder(),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 14),
                  ),
                  child: const Text(
                    'RETURN',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),
        ],

        if (isMine && isReturned && !_editing) ...[
          ElevatedButton.icon(
            onPressed: () {
              _editController.text = report.notes ?? '';
              setState(() => _editing = true);
            },
            icon: const Icon(Icons.edit, size: 18),
            label: const Text(
              'EDIT & RESUBMIT',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: VertexColors.midnight800,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 48),
              shape: const StadiumBorder(),
            ),
          ),
          const SizedBox(height: 22),
        ],

        if (isMine && report.childReports.isNotEmpty) ...[
          _consolidationCard(report),
          const SizedBox(height: 22),
        ],

        if (_editing)
          _editForm(context, store)
        else
          _contentCard(report),
      ],
    );
  }

  Widget _headerCard(BuildContext context, ReportRow report, String periodText) =>
      Container(
        padding: const EdgeInsets.all(16),
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
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: VertexColors.gold600.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    report.scopeLevel == 'country'
                        ? Icons.summarize_outlined
                        : Icons.assignment_outlined,
                    color: VertexColors.gold600,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        report.type.toUpperCase(),
                        style: const TextStyle(
                          color: VertexColors.midnight900,
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        report.scopeLevel == 'country'
                            ? 'Country report · sent to In-House'
                            : 'Recruiter submission · ${report.submitterName}',
                        style: const TextStyle(
                            color: VertexColors.gray600, fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Divider(height: 1, color: VertexColors.ivory200),
            const SizedBox(height: 13),
            Row(
              children: [
                _infoColumn('PERIOD', periodText),
                const SizedBox(width: 20),
                _infoColumn('STATUS', report.status),
              ],
            ),
          ],
        ),
      );

  Widget _infoColumn(String label, String value) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                color: VertexColors.gray600,
                fontSize: 9,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.7,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              value,
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      );

  Widget _consolidationCard(ReportRow report) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: VertexColors.ivory100,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.call_split, size: 16, color: VertexColors.midnight500),
                const SizedBox(width: 8),
                Text(
                  '${report.childReports.length} recruiter report(s) consolidated',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: VertexColors.midnight900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            for (final child in report.childReports)
              Padding(
                padding: const EdgeInsets.only(bottom: 7),
                child: Row(
                  children: [
                    const Icon(Icons.article_outlined,
                        size: 13, color: VertexColors.gray600),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        child.submitterName,
                        style: const TextStyle(
                            fontSize: 12, color: VertexColors.midnight900),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE8F5E9),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        child.status.toUpperCase(),
                        style: const TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: VertexColors.midnight500,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      );

  Widget _contentCard(ReportRow report) {
    final notes = report.notes?.trim();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Executive Summary',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 14,
              color: VertexColors.midnight900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            notes == null || notes.isEmpty
                ? 'No content provided.'
                : notes,
            style: const TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _editForm(BuildContext context, SupervisorStore store) {
    final isTooShort = _editController.text.trim().length < 5;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Edit Report Content',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 14,
              color: VertexColors.midnight900,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Correct the executive summary, then certify and resubmit to In-House.',
            style: TextStyle(color: VertexColors.gray600, fontSize: 12),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _editController,
            maxLines: 5,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'Update your executive summary...',
              filled: true,
              fillColor: VertexColors.ivory50,
              contentPadding: const EdgeInsets.all(12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide: const BorderSide(color: VertexColors.ivory200),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide: const BorderSide(color: VertexColors.ivory200),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide:
                    const BorderSide(color: VertexColors.gold600, width: 1.3),
              ),
              errorText: isTooShort ? 'At least 5 characters required' : null,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed:
                      isTooShort ? null : () => _resubmit(store),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: VertexColors.midnight800,
                    foregroundColor: Colors.white,
                    shape: const StadiumBorder(),
                  ),
                  child: const Text(
                    'CERTIFY & RESUBMIT',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 11),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                onPressed: () => setState(() => _editing = false),
                style: OutlinedButton.styleFrom(
                  foregroundColor: VertexColors.gray600,
                  side: const BorderSide(color: VertexColors.ivory200),
                  shape: const StadiumBorder(),
                ),
                child: const Text('CANCEL'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _back(BuildContext context) => context.pop();
}