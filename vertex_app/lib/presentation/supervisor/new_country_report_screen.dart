import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/supervisor_store.dart';
import '../shared/vertex_app_bar_leading.dart';

class NewCountryReportScreen extends StatefulWidget {
  const NewCountryReportScreen({super.key});

  @override
  State<NewCountryReportScreen> createState() =>
      _NewCountryReportScreenState();
}

class _NewCountryReportScreenState extends State<NewCountryReportScreen> {
  static const _typeOptions = [
    ('daily', 'Daily Control Review'),
    ('weekly', 'Weekly Consolidated Report'),
    ('monthly', 'Monthly Country Performance Report'),
  ];

  String _type = 'weekly';
  DateTime? _periodStart;
  DateTime? _periodEnd;
  bool _certified = false;
  bool _saving = false;
  final _contentController = TextEditingController();

  @override
  void dispose() {
    _contentController.dispose();
    super.dispose();
  }

  bool get _isDaily => _type == 'daily';

  Future<void> _selectPeriod() async {
    if (_isDaily) {
      final picked = await showDatePicker(
        context: context,
        initialDate: DateTime.now(),
        firstDate: DateTime(2020),
        lastDate: DateTime.now(),
      );
      if (picked != null) {
        setState(() {
          _periodStart = picked;
          _periodEnd = picked;
        });
      }
    } else if (_type == 'weekly') {
      final picked = await showDatePicker(
        context: context,
        initialDate: DateTime.now(),
        firstDate: DateTime(2020),
        lastDate: DateTime.now(),
      );
      if (picked != null) {
        final monday = picked.subtract(Duration(days: picked.weekday - 1));
        final sunday = monday.add(const Duration(days: 6));
        setState(() {
          _periodStart = monday;
          _periodEnd = sunday;
        });
      }
    } else {
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(2020),
        lastDate: DateTime.now(),
      );
      if (picked != null) {
        setState(() {
          _periodStart = picked.start;
          _periodEnd = picked.end;
        });
      }
    }
  }

  Future<void> _submit(SupervisorStore store, ConsolidationPreview? preview) async {
    if (!_certified || _periodStart == null) return;
    final children = [
      for (final entry in preview?.roster ?? const <RosterEntry>[])
        if (entry.status == 'verified' && entry.reportId != null)
          ChildReport(
            id: entry.reportId!,
            submitterName: entry.fullName,
            status: 'verified',
          ),
    ];
    setState(() => _saving = true);
    store.submitCountryReport(
      type: _type,
      periodStart: _periodStart!,
      periodEnd: _periodEnd!,
      notes: _contentController.text.trim(),
      childReports: children,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(content: Text('Country report submitted successfully.')),
      );
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<SupervisorStore>();
    final preview = (!_isDaily && _periodStart != null && _periodEnd != null)
        ? store.previewForPeriod(_periodStart!, _periodEnd!)
        : null;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
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
              'Create Country Report',
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
            'Create Country Report.',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 26,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          const Text(
            "Pick a type and period — we'll pull in what your recruiters have already verified for it. Review, fill in the rest, and submit when ready.",
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 20),

          DropdownButtonFormField<String>(
            initialValue: _type,
            isExpanded: true,
            style: const TextStyle(
              color: VertexColors.gold600,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
            dropdownColor: Colors.white,
            iconEnabledColor: VertexColors.gold600,
            decoration: _fieldDecoration('Report Type'),
            items: [
              for (final option in _typeOptions)
                DropdownMenuItem(
                  value: option.$1,
                  child: Text(
                    option.$2,
                    style: const TextStyle(
                      color: VertexColors.gold600,
                      fontSize: 14,
                    ),
                  ),
                ),
            ],
            onChanged: (value) {
              if (value == null) return;
              setState(() {
                _type = value;
                _periodStart = null;
                _periodEnd = null;
                _certified = false;
              });
            },
          ),
          const SizedBox(height: 14),

          InkWell(
            onTap: _selectPeriod,
            borderRadius: BorderRadius.circular(11),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(11),
                border: Border.all(color: VertexColors.ivory200),
              ),
              child: Row(
                children: [
                  const Icon(Icons.calendar_today_outlined,
                      color: VertexColors.gold600, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _periodStart == null
                          ? _pickerHint()
                          : '${_periodStart!.day}/${_periodStart!.month}/${_periodStart!.year}'
                              ' - ${_periodEnd!.day}/${_periodEnd!.month}/${_periodEnd!.year}',
                      style: TextStyle(
                        color: _periodStart == null
                            ? VertexColors.gray400
                            : VertexColors.gold600,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Icon(Icons.chevron_right,
                      color: VertexColors.gray400, size: 18),
                ],
              ),
            ),
          ),
          const SizedBox(height: 22),

          if (preview != null) ...[
            _buildPreviewSection(preview),
            const SizedBox(height: 22),
          ],

          if (_periodStart != null) ...[
            const Text(
              'REPORT CONTENT',
              style: TextStyle(
                color: VertexColors.midnight900,
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.0,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _contentController,
              maxLines: 5,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText:
                    'Fill in your executive summary, achievements, and issues...',
                hintStyle:
                    const TextStyle(color: VertexColors.gray400, fontSize: 13),
                filled: true,
                fillColor: Colors.white,
                contentPadding: const EdgeInsets.all(13),
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
                      color: VertexColors.gold600, width: 1.3),
                ),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'For weekly and monthly reports, verified recruiter reports for the period are pulled in automatically. You still review and certify everything.',
              style: TextStyle(color: VertexColors.gray600, fontSize: 11),
            ),
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Checkbox(
                  value: _certified,
                  onChanged: (value) =>
                      setState(() => _certified = value ?? false),
                  activeColor: VertexColors.midnight500,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                const Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Text(
                      'I certify that the information in this report is accurate and complete.',
                      style: TextStyle(
                        fontSize: 12,
                        color: VertexColors.midnight900,
                        height: 1.4,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 52,
              child: ElevatedButton(
                onPressed: (_certified &&
                        !_saving &&
                        !(preview?.alreadyConsolidated ?? false))
                    ? () => _submit(store, preview)
                    : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: VertexColors.midnight800,
                  foregroundColor: Colors.white,
                  shape: const StadiumBorder(),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'CERTIFY & SUBMIT COUNTRY REPORT',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                        ),
                      ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _pickerHint() {
    if (_isDaily) return 'Select a day...';
    if (_type == 'weekly') return 'Select a week (auto-computed Mon - Sun)...';
    return 'Select a period...';
  }

  InputDecoration _fieldDecoration(String label) => InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: VertexColors.gray600, fontSize: 12),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
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
              const BorderSide(color: VertexColors.gold600, width: 1.4),
        ),
      );

  Widget _buildPreviewSection(ConsolidationPreview preview) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'RECRUITER SUBMISSIONS FOR THIS PERIOD',
          style: TextStyle(
            color: VertexColors.midnight900,
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.0,
          ),
        ),
        const SizedBox(height: 8),
        if (preview.roster.isEmpty)
          const Text(
            'No recruiters assigned to your country yet.',
            style: TextStyle(color: VertexColors.gray600, fontSize: 13),
          )
        else
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: VertexColors.ivory200),
            ),
            child: Column(
              children: [
                for (var i = 0; i < preview.roster.length; i++)
                  _rosterRow(preview.roster, i, preview.roster[i]),
              ],
            ),
          ),
        if (preview.verifiedReportIds.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.info_outline,
                    color: VertexColors.gold600, size: 16),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'No verified recruiter reports for this period yet — you can still submit a note-only report.',
                    style: TextStyle(
                      color: VertexColors.gold600,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
        if (preview.alreadyConsolidated)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.report_problem_outlined,
                    color: VertexColors.error, size: 16),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'A country report for this exact period has already been submitted.',
                    style: TextStyle(
                      color: VertexColors.error,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _rosterRow(List<RosterEntry> roster, int index, RosterEntry entry) {
    final hasDivider = index < roster.length - 1;

    String label;
    Color color;
    switch (entry.status) {
      case 'verified':
        label = 'Verified';
        color = VertexColors.midnight500;
      case 'submitted':
        label = 'Awaiting review';
        color = VertexColors.gold600;
      case 'returned':
        label = 'Returned';
        color = VertexColors.error;
      default:
        label = 'No report';
        color = VertexColors.gray400;
    }

    return Container(
      decoration: BoxDecoration(
        border: hasDivider
            ? const Border(bottom: BorderSide(color: VertexColors.ivory200))
            : null,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      child: Row(
        children: [
          Expanded(
            child: Text(
              entry.fullName,
              style: const TextStyle(
                fontSize: 13,
                color: VertexColors.midnight900,
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(5),
            ),
            child: Text(
              label.toUpperCase(),
              style: TextStyle(
                fontSize: 9,
                fontWeight: FontWeight.w800,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}