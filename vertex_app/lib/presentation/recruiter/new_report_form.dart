import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/candidate_store.dart';
import '../../core/auth/report_store.dart';
import '../shared/recruiter_drawer.dart';
import '../shared/vertex_app_bar_leading.dart';

class NewReportForm extends StatefulWidget {
  const NewReportForm({super.key});

  @override
  State<NewReportForm> createState() => _NewReportFormState();
}

class _NewReportFormState extends State<NewReportForm> {
  final _formKey = GlobalKey<FormState>();
  final _summaryController = TextEditingController();

  ReportType _type = ReportType.daily;
  DateTime? _date;
  String? _overallStatus;
  bool _attemptedSubmit = false;
  bool _submitting = false;
  bool _declarationAccepted = false;

  final List<TextEditingController> _candidateActivityRows = [];
  final List<TextEditingController> _issueRows = [];
  final _keyAchievementController = TextEditingController();
  final _tomorrowPriorityController = TextEditingController();

  static const _statuses = [
    'On Track',
    'At Risk',
    'Behind Target',
    'Exceeded Target',
  ];

  // KPI rows — targets are editable, actuals are auto-populated then editable
  late final List<_KpiRow> _kpis = [
    _KpiRow('New candidates identified'),
    _KpiRow('Candidates screened'),
    _KpiRow('Candidates passed screening gate'),
    _KpiRow('Candidates guided to apply'),
    _KpiRow('Applications submitted'),
    _KpiRow('Candidate follow-ups completed'),
    _KpiRow('CRM records updated / corrected'),
  ];

  @override
  void initState() {
    super.initState();
    // Auto-populate actuals after first frame so context is available
    WidgetsBinding.instance.addPostFrameCallback((_) => _autoPopulate());
  }

  void _autoPopulate() {
    final candidates = context.read<CandidateStore>().records;
    final now = DateTime.now();

    final inPeriod = candidates.where((c) {
      final diff = now.difference(c.registeredAt).inDays;
      return switch (_type) {
        ReportType.daily => diff < 1,
        ReportType.weekly => diff < 7,
        ReportType.monthly => diff < 30,
      };
    }).toList();

    setState(() {
      _kpis[0].actualController.text = inPeriod.length.toString();
      // Remaining rows default to 0 — recruiter fills them in
      for (var i = 1; i < _kpis.length; i++) {
        if (_kpis[i].actualController.text.isEmpty) {
          _kpis[i].actualController.text = '0';
        }
      }
    });
  }

  @override
  void dispose() {
    _summaryController.dispose();
    _keyAchievementController.dispose();
    _tomorrowPriorityController.dispose();
    for (final k in _kpis) {
      k.dispose();
    }
    for (final c in _candidateActivityRows) {
      c.dispose();
    }
    for (final c in _issueRows) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save({required bool submit}) async {
    setState(() => _attemptedSubmit = true);
    if (!_formKey.currentState!.validate() || !_declarationAccepted) {
      setState(() {});
      return;
    }

    setState(() => _submitting = true);
    await Future<void>.delayed(const Duration(milliseconds: 500));
    if (!mounted) return;

    final entries = _kpis
        .map((k) => KpiEntry(
              name: k.name,
              target: int.tryParse(k.targetController.text),
              actual: int.tryParse(k.actualController.text),
              comment: k.commentController.text.trim(),
            ))
        .toList();

    context.read<ReportStore>().add(
          RecruiterReport(
            id: DateTime.now().millisecondsSinceEpoch.toString(),
            type: _type,
            date: _date!,
            overallStatus: _overallStatus!,
            executiveSummary: _summaryController.text.trim(),
            kpiEntries: entries,
            status: submit ? ReportStatus.submitted : ReportStatus.draft,
            createdAt: DateTime.now(),
          ),
        );

    setState(() => _submitting = false);
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: VertexColors.midnight800,
        content: Text(
          submit ? 'Report submitted successfully.' : 'Draft saved.',
          style: const TextStyle(color: Colors.white),
        ),
      ),
    );
    context.go('/recruiter/reports');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const RecruiterDrawer(activeRoute: '/recruiter/reports'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        title: const Text(
          'New Report',
          style: TextStyle(
              color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
        ),
        leading: const VertexAppBarLeading(),
        actions: [
          TextButton(
            onPressed: () => context.pop(),
            child: const Text(
              'CANCEL',
              style: TextStyle(
                  color: VertexColors.gold400,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.0),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 34),
          children: [
            const Text(
              'Activity Report',
              style: TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 22,
                  fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            const Text(
              'KPI actuals are auto-populated from your records for the selected period.',
              style: TextStyle(
                  color: VertexColors.gray600, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 22),

            // ── 01 Report details ─────────────────────────────────────────
            _sectionHeader('01', 'Report details'),
            // Type + Date row
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 13),
                    child: DropdownButtonFormField<ReportType>(
                      initialValue: _type,
                      isExpanded: true,
                      style: const TextStyle(
                          color: VertexColors.gold600,
                          fontSize: 14,
                          fontWeight: FontWeight.w600),
                      dropdownColor: Colors.white,
                      iconEnabledColor: VertexColors.gold600,
                      decoration: _decoration('Report type'),
                      items: const [
                        DropdownMenuItem(
                            value: ReportType.daily,
                            child: Text('Daily Activity Report')),
                        DropdownMenuItem(
                            value: ReportType.weekly, child: Text('Weekly')),
                        DropdownMenuItem(
                            value: ReportType.monthly, child: Text('Monthly')),
                      ],
                      onChanged: (v) {
                        if (v == null) return;
                        setState(() => _type = v);
                        _autoPopulate();
                      },
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(child: _dateField()),
              ],
            ),
            // Overall status
            Padding(
              padding: const EdgeInsets.only(bottom: 13),
              child: DropdownButtonFormField<String>(
                initialValue: _overallStatus,
                isExpanded: true,
                style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 14,
                    fontWeight: FontWeight.w600),
                dropdownColor: Colors.white,
                iconEnabledColor: VertexColors.gold600,
                decoration: _decoration('Overall status *'),
                autovalidateMode: _attemptedSubmit
                    ? AutovalidateMode.onUserInteraction
                    : AutovalidateMode.disabled,
                validator: (v) => v == null ? 'Required' : null,
                items: _statuses
                    .map((s) => DropdownMenuItem(
                          value: s,
                          child: Text(s,
                              style: const TextStyle(
                                  color: VertexColors.gold600,
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600)),
                        ))
                    .toList(),
                onChanged: (v) => setState(() => _overallStatus = v),
              ),
            ),
            // Campaign (disabled — no campaigns yet)
            Padding(
              padding: const EdgeInsets.only(bottom: 13),
              child: IgnorePointer(
                child: DropdownButtonFormField<String>(
                  initialValue: null,
                  isExpanded: true,
                  style: const TextStyle(
                      color: VertexColors.gray400,
                      fontSize: 14,
                      fontWeight: FontWeight.w600),
                  dropdownColor: Colors.white,
                  iconDisabledColor: VertexColors.gray400,
                  decoration: _decoration('Campaign').copyWith(
                    hintText: 'No active campaigns in your country',
                    hintStyle: const TextStyle(
                        color: VertexColors.gray400, fontSize: 13),
                    fillColor: VertexColors.ivory100,
                  ),
                  items: const [],
                  onChanged: null,
                ),
              ),
            ),
            const SizedBox(height: 4),

            // ── 02 Executive summary ──────────────────────────────────────
            _sectionHeader('02', 'Executive summary'),
            Padding(
              padding: const EdgeInsets.only(bottom: 13),
              child: TextFormField(
                controller: _summaryController,
                maxLines: 5,
                autovalidateMode: _attemptedSubmit
                    ? AutovalidateMode.onUserInteraction
                    : AutovalidateMode.disabled,
                cursorColor: VertexColors.gold600,
                style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 14,
                    fontWeight: FontWeight.w600),
                validator: (v) =>
                    v == null || v.trim().isEmpty ? 'Required' : null,
                decoration: _decoration('Executive summary *').copyWith(
                  hintText:
                      'Progress, achievements, shortfalls, urgent issues, decisions required, overall status.',
                  hintStyle: const TextStyle(
                      color: VertexColors.gray400,
                      fontSize: 12,
                      height: 1.5),
                  alignLabelWithHint: true,
                ),
              ),
            ),
            const SizedBox(height: 8),

            // ── 03 KPI table ──────────────────────────────────────────────
            _sectionHeader('03', 'Target and Performance'),
            const SizedBox(height: 4),
            _kpiTable(),
            const SizedBox(height: 24),

            // ── 04 Candidate Activity ─────────────────────────────────────
            _sectionHeader('04', 'Candidate Activity'),
            const SizedBox(height: 4),
            _dynamicRowsSection(
              rows: _candidateActivityRows,
              hint: 'Describe candidate activity…',
              onAdd: () => setState(() =>
                  _candidateActivityRows.add(TextEditingController())),
              onRemove: (i) => setState(() {
                _candidateActivityRows[i].dispose();
                _candidateActivityRows.removeAt(i);
              }),
            ),
            const SizedBox(height: 24),

            // ── 05 Issues / Blockers ──────────────────────────────────────
            _sectionHeader('05', 'Issue / Blocker'),
            const SizedBox(height: 4),
            _dynamicRowsSection(
              rows: _issueRows,
              hint: 'Describe issue or blocker…',
              onAdd: () => setState(
                  () => _issueRows.add(TextEditingController())),
              onRemove: (i) => setState(() {
                _issueRows[i].dispose();
                _issueRows.removeAt(i);
              }),
            ),
            const SizedBox(height: 24),

            // ── 06 Key Achievement ────────────────────────────────────────
            _sectionHeader('06', 'Key Achievement'),
            Padding(
              padding: const EdgeInsets.only(bottom: 13),
              child: TextField(
                controller: _keyAchievementController,
                maxLines: 3,
                cursorColor: VertexColors.gold600,
                style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 14,
                    fontWeight: FontWeight.w600),
                decoration: _decoration('Key achievement').copyWith(
                  hintText: 'What was the standout achievement this period?',
                  hintStyle: const TextStyle(
                      color: VertexColors.gray400, fontSize: 12, height: 1.5),
                  alignLabelWithHint: true,
                ),
              ),
            ),
            const SizedBox(height: 8),

            // ── 07 Tomorrow's Priority ────────────────────────────────────
            _sectionHeader('07', "Tomorrow's Priority"),
            Padding(
              padding: const EdgeInsets.only(bottom: 13),
              child: TextField(
                controller: _tomorrowPriorityController,
                maxLines: 3,
                cursorColor: VertexColors.gold600,
                style: const TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 14,
                    fontWeight: FontWeight.w600),
                decoration: _decoration("Tomorrow's priority").copyWith(
                  hintText: 'What is the top priority for tomorrow?',
                  hintStyle: const TextStyle(
                      color: VertexColors.gray400, fontSize: 12, height: 1.5),
                  alignLabelWithHint: true,
                ),
              ),
            ),
            const SizedBox(height: 16),

            // ── Declaration + Submit ──────────────────────────────────────
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _declarationAccepted,
              activeColor: VertexColors.midnight500,
              onChanged: (v) =>
                  setState(() => _declarationAccepted = v ?? false),
              title: Text(
                'I confirm that the information above is complete and accurate.',
                style: TextStyle(
                  color: !_declarationAccepted && _attemptedSubmit
                      ? VertexColors.error
                      : VertexColors.gray800,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (!_declarationAccepted && _attemptedSubmit) ...[
              const Padding(
                padding: EdgeInsets.only(left: 4, bottom: 8),
                child: Text(
                  'You must certify the report before submitting.',
                  style: TextStyle(color: VertexColors.error, fontSize: 11),
                ),
              ),
            ],
            const SizedBox(height: 12),
            SizedBox(
              height: 52,
              child: ElevatedButton(
                onPressed: _submitting ? null : () => _save(submit: true),
                style: ElevatedButton.styleFrom(
                  backgroundColor: VertexColors.midnight800,
                  foregroundColor: Colors.white,
                  shape: const StadiumBorder(),
                ),
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Text(
                        'CERTIFY & SUBMIT',
                        style: TextStyle(
                            fontWeight: FontWeight.w800, letterSpacing: 1.1),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Dynamic rows section ───────────────────────────────────────────

  Widget _dynamicRowsSection({
    required List<TextEditingController> rows,
    required String hint,
    required VoidCallback onAdd,
    required void Function(int) onRemove,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Column(
        children: [
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
              child: Row(
                children: [
                  const Icon(Icons.inbox_outlined,
                      color: VertexColors.gray400, size: 18),
                  const SizedBox(width: 10),
                  const Text('No rows yet.',
                      style: TextStyle(
                          color: VertexColors.gray400, fontSize: 13)),
                ],
              ),
            )
          else
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0)
                const Divider(height: 1, color: VertexColors.ivory200),
              Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: rows[i],
                        cursorColor: VertexColors.gold600,
                        style: const TextStyle(
                            color: VertexColors.gold600,
                            fontSize: 13,
                            fontWeight: FontWeight.w600),
                        decoration: InputDecoration(
                          hintText: hint,
                          hintStyle: const TextStyle(
                              color: VertexColors.gray400, fontSize: 12),
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 10),
                          filled: true,
                          fillColor: VertexColors.ivory50,
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(9),
                              borderSide: const BorderSide(
                                  color: VertexColors.ivory200)),
                          enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(9),
                              borderSide: const BorderSide(
                                  color: VertexColors.ivory200)),
                          focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(9),
                              borderSide: const BorderSide(
                                  color: VertexColors.gold600, width: 1.2)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      onPressed: () => onRemove(i),
                      icon: const Icon(Icons.close,
                          size: 17, color: VertexColors.gray400),
                    ),
                  ],
                ),
              ),
            ],
          const Divider(height: 1, color: VertexColors.ivory200),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: onAdd,
              icon: const Icon(Icons.add, size: 16, color: VertexColors.gold600),
              label: const Text(
                'Add row',
                style: TextStyle(
                    color: VertexColors.gold600,
                    fontSize: 13,
                    fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── KPI table ─────────────────────────────────────────────────────────────

  Widget _kpiTable() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: VertexColors.ivory200),
      ),
      clipBehavior: Clip.hardEdge,
      child: Column(
        children: [
          // Header
          Container(
            color: VertexColors.midnight900,
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: const Row(
              children: [
                Expanded(
                    flex: 5,
                    child: _HeaderCell('KPI')),
                Expanded(
                    flex: 2,
                    child: _HeaderCell('TARGET', center: true)),
                Expanded(
                    flex: 2,
                    child: _HeaderCell('ACTUAL', center: true)),
                Expanded(
                    flex: 2,
                    child: _HeaderCell('VARIANCE', center: true)),
                Expanded(
                    flex: 3,
                    child: _HeaderCell('COMMENT')),
              ],
            ),
          ),
          // Rows
          for (var i = 0; i < _kpis.length; i++) ...[
            if (i > 0)
              const Divider(height: 1, color: VertexColors.ivory200),
            _kpiRow(_kpis[i]),
          ],
        ],
      ),
    );
  }

  Widget _kpiRow(_KpiRow kpi) {
    final target = int.tryParse(kpi.targetController.text);
    final actual = int.tryParse(kpi.actualController.text);
    final variance = (target != null && actual != null) ? actual - target : null;
    final varianceColor = variance == null
        ? VertexColors.gray400
        : variance >= 0
            ? VertexColors.midnight500
            : VertexColors.error;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // KPI name
          Expanded(
            flex: 5,
            child: Text(
              kpi.name,
              style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 12,
                  fontWeight: FontWeight.w600),
            ),
          ),
          // Target
          Expanded(
            flex: 2,
            child: _numericCell(kpi.targetController, onChanged: (_) => setState(() {})),
          ),
          // Actual
          Expanded(
            flex: 2,
            child: _numericCell(kpi.actualController, onChanged: (_) => setState(() {})),
          ),
          // Variance
          Expanded(
            flex: 2,
            child: Center(
              child: Text(
                variance != null
                    ? (variance >= 0 ? '+$variance' : '$variance')
                    : '–',
                style: TextStyle(
                    color: varianceColor,
                    fontSize: 12,
                    fontWeight: FontWeight.w700),
              ),
            ),
          ),
          // Comment
          Expanded(
            flex: 3,
            child: TextField(
              controller: kpi.commentController,
              cursorColor: VertexColors.gold600,
              style: const TextStyle(
                  color: VertexColors.gray800, fontSize: 11),
              decoration: InputDecoration(
                hintText: 'Note…',
                hintStyle: const TextStyle(
                    color: VertexColors.gray400, fontSize: 11),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 8),
                filled: true,
                fillColor: VertexColors.ivory50,
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide:
                        const BorderSide(color: VertexColors.ivory200)),
                enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide:
                        const BorderSide(color: VertexColors.ivory200)),
                focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(
                        color: VertexColors.gold600, width: 1.2)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _numericCell(TextEditingController controller,
          {ValueChanged<String>? onChanged}) =>
      Center(
        child: SizedBox(
          width: 48,
          child: TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            textAlign: TextAlign.center,
            cursorColor: VertexColors.gold600,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: onChanged,
            style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 13,
                fontWeight: FontWeight.w700),
            decoration: InputDecoration(
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
              filled: true,
              fillColor: VertexColors.ivory50,
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide:
                      const BorderSide(color: VertexColors.ivory200)),
              enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide:
                      const BorderSide(color: VertexColors.ivory200)),
              focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(
                      color: VertexColors.gold600, width: 1.2)),
            ),
          ),
        ),
      );

  // ── Date field ────────────────────────────────────────────────────────────

  Widget _dateField() {
    final label = _date == null
        ? 'Date *'
        : '${_date!.day.toString().padLeft(2, '0')}/${_date!.month.toString().padLeft(2, '0')}/${_date!.year}';

    return Padding(
      padding: const EdgeInsets.only(bottom: 13),
      child: FormField<DateTime>(
        validator: (_) => _date == null ? 'Required' : null,
        autovalidateMode: _attemptedSubmit
            ? AutovalidateMode.onUserInteraction
            : AutovalidateMode.disabled,
        builder: (state) => InkWell(
          onTap: () async {
            final picked = await showDatePicker(
              context: context,
              initialDate: _date ?? DateTime.now(),
              firstDate: DateTime(2020),
              lastDate: DateTime.now(),
              builder: (ctx, child) => Theme(
                data: Theme.of(ctx).copyWith(
                  datePickerTheme: DatePickerThemeData(
                    backgroundColor: Colors.white,
                    headerBackgroundColor: VertexColors.midnight800,
                    headerForegroundColor: Colors.white,
                    dayForegroundColor:
                        WidgetStateProperty.resolveWith((states) {
                      if (states.contains(WidgetState.selected)) {
                        return Colors.white;
                      }
                      return VertexColors.midnight900;
                    }),
                    dayBackgroundColor:
                        WidgetStateProperty.resolveWith((states) {
                      if (states.contains(WidgetState.selected)) {
                        return VertexColors.gold600;
                      }
                      return Colors.transparent;
                    }),
                    todayForegroundColor:
                        WidgetStateProperty.all(VertexColors.gold600),
                    todayBorder: const BorderSide(
                        color: VertexColors.gold600, width: 1.4),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(22)),
                  ),
                  textButtonTheme: TextButtonThemeData(
                    style: TextButton.styleFrom(
                        foregroundColor: VertexColors.gold600),
                  ),
                ),
                child: child!,
              ),
            );
            if (picked != null) {
              setState(() => _date = picked);
              state.didChange(picked);
            }
          },
          borderRadius: BorderRadius.circular(11),
          child: InputDecorator(
            decoration: _decoration('Date *').copyWith(
              errorText: state.errorText,
              suffixIcon: const Icon(Icons.calendar_month_outlined,
                  color: VertexColors.gold600, size: 20),
            ),
            isEmpty: _date == null,
            child: Text(
              _date == null ? '' : label,
              style: const TextStyle(
                  color: VertexColors.gold600,
                  fontSize: 14,
                  fontWeight: FontWeight.w600),
            ),
          ),
        ),
      ),
    );
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  Widget _sectionHeader(String number, String title) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          children: [
            Text(number,
                style: const TextStyle(
                    color: VertexColors.gold500,
                    fontSize: 12,
                    fontWeight: FontWeight.w800)),
            const SizedBox(width: 12),
            Text(title,
                style: const TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 17,
                    fontWeight: FontWeight.w800)),
          ],
        ),
      );

  InputDecoration _decoration(String label) => InputDecoration(
        labelText: label,
        labelStyle:
            const TextStyle(color: VertexColors.gray600, fontSize: 12),
        floatingLabelStyle: const TextStyle(
            color: VertexColors.midnight700,
            fontSize: 12,
            fontWeight: FontWeight.w600),
        errorStyle:
            const TextStyle(color: VertexColors.error, fontSize: 11),
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
        errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.error)),
        focusedErrorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide:
                const BorderSide(color: VertexColors.error, width: 1.4)),
      );
}

// ── KPI row state holder ───────────────────────────────────────────────────

class _KpiRow {
  _KpiRow(this.name)
      : targetController = TextEditingController(),
        actualController = TextEditingController(),
        commentController = TextEditingController();

  final String name;
  final TextEditingController targetController;
  final TextEditingController actualController;
  final TextEditingController commentController;

  void dispose() {
    targetController.dispose();
    actualController.dispose();
    commentController.dispose();
  }
}

// ── Table header cell ──────────────────────────────────────────────────────

class _HeaderCell extends StatelessWidget {
  const _HeaderCell(this.text, {this.center = false});
  final String text;
  final bool center;

  @override
  Widget build(BuildContext context) => Text(
        text,
        textAlign: center ? TextAlign.center : TextAlign.left,
        style: const TextStyle(
          color: Colors.white70,
          fontSize: 9,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.1,
        ),
      );
}
