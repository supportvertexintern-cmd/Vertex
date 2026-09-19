import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/exception_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'supervisor_drawer.dart';

class SupervisorExceptionsScreen extends StatefulWidget {
  const SupervisorExceptionsScreen({super.key});

  @override
  State<SupervisorExceptionsScreen> createState() =>
      _SupervisorExceptionsScreenState();
}

class _SupervisorExceptionsScreenState extends State<SupervisorExceptionsScreen> {
  // --- List State ---
  final _searchController = TextEditingController();
  String _query = '';
  String _selectedCategory = 'All categories';
  String _selectedLevel = 'All levels';

  // --- Inline Form State ---
  bool _isAddingNew = false;
  final _formKey = GlobalKey<FormState>();
  final _crmRef = TextEditingController();
  final _issueStatement = TextEditingController();
  final _immediateImpact = TextEditingController();
  final _actionsTaken = TextEditingController();
  final _rootCause = TextEditingController();
  final _optionsConsidered = TextEditingController();
  final _recommendation = TextEditingController();
  final _decisionRequired = TextEditingController();
  final _actionDialogController = TextEditingController();
  final _formAnchorKey = GlobalKey();

  String _exceptionType = 'Candidate eligibility / screening';
  DateTime? _targetDate;
  List<String> _correctiveActions = [];

  @override
  void dispose() {
    _searchController.dispose();
    _crmRef.dispose();
    _issueStatement.dispose();
    _immediateImpact.dispose();
    _actionsTaken.dispose();
    _rootCause.dispose();
    _optionsConsidered.dispose();
    _recommendation.dispose();
    _decisionRequired.dispose();
    _actionDialogController.dispose();
    super.dispose();
  }

  void _resetForm() {
    _formKey.currentState?.reset();
    _crmRef.clear();
    _issueStatement.clear();
    _immediateImpact.clear();
    _actionsTaken.clear();
    _rootCause.clear();
    _optionsConsidered.clear();
    _recommendation.clear();
    _decisionRequired.clear();
    setState(() {
      _exceptionType = 'Candidate eligibility / screening';
      _targetDate = null;
      _correctiveActions = [];
    });
  }

  Future<void> _submitException() async {
    if (!_formKey.currentState!.validate()) return;
    final now = DateTime.now();
    context.read<ExceptionStore>().add(
          RecruiterException(
            id: now.millisecondsSinceEpoch.toString(),
            reference: 'EXC-${now.millisecondsSinceEpoch.toString().substring(7)}',
            type: _exceptionType,
            crmRef: _crmRef.text.trim(),
            issueStatement: _issueStatement.text.trim(),
            immediateImpact: _immediateImpact.text.trim(),
            actionsTaken: _actionsTaken.text.trim(),
            rootCause: _rootCause.text.trim(),
            optionsConsidered: _optionsConsidered.text.trim(),
            recommendation: _recommendation.text.trim(),
            decisionRequired: _decisionRequired.text.trim(),
            targetDate: _targetDate,
            correctiveActions:
                _correctiveActions.map((a) => CorrectiveAction(description: a)).toList(),
            createdAt: now,
          ),
        );
    _resetForm();
    setState(() => _isAddingNew = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: VertexColors.midnight800,
          content:
              Text('Exception raised successfully.', style: TextStyle(color: Colors.white)),
        ),
      );
    }
  }

  void _addCorrectiveAction() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add Corrective Action',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        content: TextField(
          controller: _actionDialogController,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Describe the corrective action...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('CANCEL',
                style: TextStyle(color: VertexColors.gray600)),
          ),
          ElevatedButton(
            onPressed: () {
              if (_actionDialogController.text.trim().isNotEmpty) {
                setState(() =>
                    _correctiveActions.add(_actionDialogController.text.trim()));
                _actionDialogController.clear();
                Navigator.pop(ctx);
              }
            },
            style: ElevatedButton.styleFrom(
                backgroundColor: VertexColors.midnight800),
            child: const Text('ADD', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  void _openNewExceptionForm() {
    setState(() => _isAddingNew = true);
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<ExceptionStore>();

    List<RecruiterException> applyFilter(List<RecruiterException> list) =>
        list.where((e) {
          final q = _query.toLowerCase();
          final matchesQuery = q.isEmpty ||
              e.reference.toLowerCase().contains(q) ||
              e.issueStatement.toLowerCase().contains(q);
          final matchesCategory = _selectedCategory == 'All categories' ||
              e.type == _selectedCategory;
          return matchesQuery && matchesCategory;
        }).toList();

    final open = applyFilter(store.openExceptions);
    final closed = applyFilter(store.closedExceptions);

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const SupervisorDrawer(activeRoute: '/supervisor/exceptions'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'GOVERNANCE',
              style: TextStyle(
                  color: VertexColors.gold300,
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.2),
            ),
            SizedBox(height: 4),
            Text(
              'Exceptions',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
        children: [
          // Header
          const Text(
            'Exceptions.',
            style: TextStyle(
                color: VertexColors.midnight900,
                fontSize: 28,
                fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          const Text(
            'Raise an issue immediately, independent of the regular reporting cycle — '
            'it escalates up the same Regional Recruiter → Country Supervisor → '
            'In-House Supervisor → Management line.',
            style: TextStyle(
                color: VertexColors.gray600, fontSize: 13, height: 1.45),
          ),
          const SizedBox(height: 18),

          // Toggle button
          if (!_isAddingNew)
            SizedBox(
              height: 48,
              child: ElevatedButton.icon(
                onPressed: _openNewExceptionForm,
                icon: const Icon(Icons.add, size: 20),
                label: const Text('RAISE EXCEPTION',
                    style: TextStyle(
                        fontWeight: FontWeight.w800, letterSpacing: 1.0)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: VertexColors.midnight800,
                  foregroundColor: Colors.white,
                  shape: const StadiumBorder(),
                ),
              ),
            ),

          // Inline form
          if (_isAddingNew) ...[
            KeyedSubtree(
              key: _formAnchorKey,
              child: _buildInlineForm(),
            ),
            const SizedBox(height: 24),
          ],

          // Search
          TextField(
            controller: _searchController,
            cursorColor: VertexColors.gold600,
            style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 14,
                fontWeight: FontWeight.w600),
            onChanged: (v) => setState(() => _query = v.trim()),
            decoration: _inputDecoration(
                'Search by reference, issue, or candidate...', Icons.search),
          ),
          const SizedBox(height: 10),

          // Filters
          Row(
            children: [
              Expanded(
                child: _filterDropdown(
                  value: _selectedCategory,
                  options: const [
                    'All categories',
                    'Candidate eligibility / screening',
                    'Campaign / CRM issue',
                    'Operational',
                    'Compliance',
                    'Financial',
                    'Other',
                  ],
                  onChanged: (v) =>
                      setState(() => _selectedCategory = v ?? _selectedCategory),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _filterDropdown(
                  value: _selectedLevel,
                  options: const [
                    'All levels',
                    'Level 1',
                    'Level 2',
                    'Level 3',
                  ],
                  onChanged: (v) =>
                      setState(() => _selectedLevel = v ?? _selectedLevel),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Open section
          _sectionLabel('OPEN (${store.openExceptions.length})'),
          const SizedBox(height: 10),
          if (open.isEmpty)
            _emptyCard('No open exceptions match your filters.')
          else
            ...open.map((e) => _card(e)),
          const SizedBox(height: 24),

          // Closed section
          _sectionLabel('DECIDED / CLOSED'),
          const SizedBox(height: 10),
          if (closed.isEmpty)
            _emptyCard('None yet.')
          else
            ...closed.map((e) => _card(e)),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Inline Form
  // ---------------------------------------------------------------------------
  Widget _buildInlineForm() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: VertexColors.ivory200),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 10,
              offset: const Offset(0, 4)),
        ],
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.warning_amber_outlined,
                    color: VertexColors.midnight800, size: 20),
                const SizedBox(width: 8),
                const Text('New exception',
                    style: TextStyle(
                        color: VertexColors.midnight900,
                        fontSize: 16,
                        fontWeight: FontWeight.w800)),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close,
                      color: VertexColors.gray600, size: 20),
                  onPressed: () {
                    _resetForm();
                    setState(() => _isAddingNew = false);
                  },
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Type & CRM Ref
            Row(
              children: [
                Expanded(
                  child: _dropdownField(
                    'Type',
                    _exceptionType,
                    const [
                      'Candidate eligibility / screening',
                      'Campaign / CRM issue',
                      'Operational',
                      'Compliance',
                      'Financial',
                    ],
                    (v) => setState(() => _exceptionType = v!),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _textField('CRM Ref. (optional)', _crmRef,
                      hint: 'Campaign / Candidate CRM Ref.'),
                ),
              ],
            ),
            const SizedBox(height: 16),

            _textField('Issue statement *', _issueStatement,
                hint: 'What happened? State verified facts only.',
                maxLines: 3,
                required: true),
            const SizedBox(height: 16),

            _textField('Immediate impact *', _immediateImpact,
                hint: 'Describe the immediate impact.',
                maxLines: 2,
                required: true),
            const SizedBox(height: 16),

            _textField('Actions already taken (optional)', _actionsTaken,
                hint: 'Actions already taken...', maxLines: 2),
            const SizedBox(height: 16),

            Row(
              children: [
                Expanded(
                  child: _textField('Root cause (optional)', _rootCause,
                      hint: 'Root cause...', maxLines: 2),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _textField(
                      'Options considered (optional)', _optionsConsidered,
                      hint: 'Options considered...', maxLines: 2),
                ),
              ],
            ),
            const SizedBox(height: 16),

            _textField('Recommendation (optional)', _recommendation,
                hint: 'Recommendation...', maxLines: 2),
            const SizedBox(height: 16),

            Row(
              children: [
                Expanded(
                  child: _textField('Decision required *', _decisionRequired,
                      hint: 'What decision is needed?', required: true),
                ),
                const SizedBox(width: 12),
                Expanded(child: _dateField()),
              ],
            ),
            const SizedBox(height: 24),

            // Corrective Actions
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Corrective Actions',
                    style: TextStyle(
                        color: VertexColors.midnight900,
                        fontSize: 14,
                        fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                    onPressed: _addCorrectiveAction,
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('ADD ACTION'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: VertexColors.midnight800,
                      side: const BorderSide(color: VertexColors.midnight800),
                      shape: const StadiumBorder(),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      textStyle: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.5),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            if (_correctiveActions.isEmpty)
              const Text('No rows yet.',
                  style:
                      TextStyle(color: VertexColors.gray600, fontSize: 13))
            else
              ..._correctiveActions.asMap().entries.map(
                    (entry) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          const Icon(Icons.check_circle_outline,
                              size: 16, color: VertexColors.midnight500),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(entry.value,
                                style: const TextStyle(
                                    fontSize: 13,
                                    color: VertexColors.midnight900)),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close,
                                size: 16, color: VertexColors.gray600),
                            onPressed: () => setState(
                                () => _correctiveActions.removeAt(entry.key)),
                          ),
                        ],
                      ),
                    ),
                  ),

            const SizedBox(height: 24),

            Align(
              alignment: Alignment.centerLeft,
              child: SizedBox(
                height: 52,
                child: ElevatedButton(
                  onPressed: _submitException,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: VertexColors.midnight800,
                    foregroundColor: Colors.white,
                    shape: const StadiumBorder(),
                  ),
                  child: const Text('RAISE EXCEPTION',
                      style: TextStyle(
                          fontWeight: FontWeight.w800, letterSpacing: 1.1)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Field helpers
  // ---------------------------------------------------------------------------
  Widget _textField(
    String label,
    TextEditingController controller, {
    String? hint,
    int maxLines = 1,
    bool required = false,
  }) =>
      TextFormField(
        controller: controller,
        maxLines: maxLines,
        cursorColor: VertexColors.gold600,
        style: const TextStyle(
            color: VertexColors.gold600,
            fontSize: 14,
            fontWeight: FontWeight.w600),
        validator: required
            ? (v) => v == null || v.trim().isEmpty ? 'Required' : null
            : null,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          labelStyle:
              const TextStyle(color: VertexColors.gray600, fontSize: 12),
          hintStyle:
              const TextStyle(color: VertexColors.gray400, fontSize: 13),
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
        ),
      );

  Widget _dropdownField(String label, String value, List<String> options,
          ValueChanged<String?> onChanged) =>
      DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        style: const TextStyle(
            color: VertexColors.gold600,
            fontSize: 14,
            fontWeight: FontWeight.w600),
        dropdownColor: Colors.white,
        iconEnabledColor: VertexColors.gold600,
        decoration: InputDecoration(
          labelText: label,
          labelStyle:
              const TextStyle(color: VertexColors.gray600, fontSize: 12),
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
        ),
        items: options
            .map((o) => DropdownMenuItem(
                  value: o,
                  child: Text(o,
                      style: const TextStyle(
                          color: VertexColors.gold600, fontSize: 14)),
                ))
            .toList(),
        onChanged: onChanged,
      );

  Widget _dateField() {
    final text = _targetDate != null
        ? '${_targetDate!.day.toString().padLeft(2, '0')}/'
            '${_targetDate!.month.toString().padLeft(2, '0')}/'
            '${_targetDate!.year}'
        : '';
    return TextFormField(
      readOnly: true,
      controller: TextEditingController(text: text),
      cursorColor: VertexColors.gold600,
      style: const TextStyle(
          color: VertexColors.gold600,
          fontSize: 14,
          fontWeight: FontWeight.w600),
      decoration: InputDecoration(
        labelText: 'Target Date',
        hintText: 'dd/mm/yyyy',
        hintStyle:
            const TextStyle(color: VertexColors.gray400, fontSize: 13),
        labelStyle:
            const TextStyle(color: VertexColors.gray600, fontSize: 12),
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        suffixIcon: const Icon(Icons.calendar_today_outlined,
            color: VertexColors.gold600, size: 20),
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
      ),
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: _targetDate ?? DateTime.now(),
          firstDate: DateTime.now(),
          lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
          builder: (context, child) => Theme(
            data: Theme.of(context).copyWith(
              datePickerTheme: DatePickerThemeData(
                headerBackgroundColor: VertexColors.midnight800,
                headerForegroundColor: Colors.white,
                backgroundColor: Colors.white,
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
        if (picked != null) setState(() => _targetDate = picked);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // List helpers
  // ---------------------------------------------------------------------------
  Widget _sectionLabel(String text) => Text(
        text,
        style: const TextStyle(
            color: VertexColors.midnight700,
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.5),
      );

  Widget _emptyCard(String message) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Center(
          child: Text(message,
              style: const TextStyle(
                  color: VertexColors.gray600, fontSize: 13)),
        ),
      );

  Widget _card(RecruiterException e) {
    final isOpen = e.status == ExceptionStatus.open;
    final statusColor =
        isOpen ? VertexColors.error : VertexColors.midnight500;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isOpen
              ? VertexColors.error.withValues(alpha: 0.25)
              : VertexColors.ivory200,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isOpen
                ? Icons.warning_amber_outlined
                : Icons.check_circle_outline,
            color: statusColor,
            size: 22,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(e.reference,
                        style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 12,
                            color: VertexColors.midnight900)),
                    Text(isOpen ? 'OPEN' : 'CLOSED',
                        style: TextStyle(
                            color: statusColor,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.8)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(e.issueStatement,
                    style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: VertexColors.midnight900)),
                const SizedBox(height: 4),
                Text(
                    '${e.type}${e.crmRef.isNotEmpty ? '  ·  ${e.crmRef}' : ''}',
                    style: const TextStyle(
                        fontSize: 12, color: VertexColors.gray600)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  InputDecoration _inputDecoration(String hint, IconData icon) =>
      InputDecoration(
        hintText: hint,
        hintStyle:
            const TextStyle(color: VertexColors.gray400, fontSize: 13),
        prefixIcon: Icon(icon, color: VertexColors.gold600, size: 20),
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
      );

  Widget _filterDropdown({
    required String value,
    required List<String> options,
    required ValueChanged<String?> onChanged,
  }) =>
      DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        style: const TextStyle(
            color: VertexColors.gold600,
            fontSize: 13,
            fontWeight: FontWeight.w600),
        dropdownColor: Colors.white,
        iconEnabledColor: VertexColors.gold600,
        decoration: InputDecoration(
          filled: true,
          fillColor: Colors.white,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
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
        ),
        items: options
            .map((o) => DropdownMenuItem(
                  value: o,
                  child: Text(o,
                      style: const TextStyle(
                          color: VertexColors.gold600, fontSize: 13)),
                ))
            .toList(),
        onChanged: onChanged,
      );
}