import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../app/theme/colors.dart';
import '../../core/auth/exception_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import '../director/director_drawer.dart';

class ManagementExceptionsScreen extends StatefulWidget {
  const ManagementExceptionsScreen({super.key});

  @override
  State<ManagementExceptionsScreen> createState() =>
      _ManagementExceptionsScreenState();
}

class _ManagementExceptionsScreenState extends State<ManagementExceptionsScreen> {
  final _searchController = TextEditingController();
  String _selectedCategory = 'All categories';
  bool _isAddingNew = false;

  // Form Controllers
  final _formKey = GlobalKey<FormState>();
  final _crmRef = TextEditingController();
  final _issueStatement = TextEditingController();
  final _immediateImpact = TextEditingController();
  final _decisionRequired = TextEditingController();
  final _actionDialogController = TextEditingController();

  String _exceptionType = 'Candidate eligibility / screening';
  DateTime? _targetDate;
  List<String> _correctiveActions = [];

  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _crmRef.dispose();
    _issueStatement.dispose();
    _immediateImpact.dispose();
    _decisionRequired.dispose();
    _actionDialogController.dispose();
    super.dispose();
  }

  Future<void> _submitException() async {
    if (!_formKey.currentState!.validate()) return;
    final now = DateTime.now();
    context.read<ExceptionStore>().add(
          RecruiterException(
            id: now.millisecondsSinceEpoch.toString(),
            reference:
                'EXC-${now.millisecondsSinceEpoch.toString().substring(7)}',
            type: _exceptionType,
            crmRef: _crmRef.text.trim(),
            issueStatement: _issueStatement.text.trim(),
            immediateImpact: _immediateImpact.text.trim(),
            actionsTaken: '',
            rootCause: '',
            optionsConsidered: '',
            recommendation: '',
            decisionRequired: _decisionRequired.text.trim(),
            targetDate: _targetDate,
            correctiveActions:
                _correctiveActions.map((a) => CorrectiveAction(description: a)).toList(),
            createdAt: now,
          ),
        );
    setState(() {
      _isAddingNew = false;
      _issueStatement.clear();
      _immediateImpact.clear();
      _decisionRequired.clear();
      _targetDate = null;
      _correctiveActions = [];
    });
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Exception raised successfully.')));
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<ExceptionStore>();
    final open = store.openExceptions;
    final closed = store.closedExceptions;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/exceptions'),
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
                letterSpacing: 1.2,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Exceptions',
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
            'Exceptions.',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 28,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Raise an issue immediately, independent of the regular reporting cycle — it escalates up the same Regional Recruiter → Country Supervisor → In-House Supervisor → Management line.',
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 18),

          if (!_isAddingNew)
            SizedBox(
              height: 48,
              child: ElevatedButton.icon(
                onPressed: () => setState(() => _isAddingNew = true),
                icon: const Icon(Icons.add, size: 20),
                label: const Text(
                  'RAISE EXCEPTION',
                  style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.0),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: VertexColors.midnight800,
                  foregroundColor: Colors.white,
                  shape: const StadiumBorder(),
                ),
              ),
            ),

          if (_isAddingNew) ...[
            _buildInlineForm(),
            const SizedBox(height: 24),
          ],

          TextField(
            controller: _searchController,
            onChanged: (v) => setState(() {}),
            decoration: _decoration('Search by reference, issue...', Icons.search),
          ),
          const SizedBox(height: 10),
          _dropdown(
            'All categories',
            [
              'All categories',
              'Candidate eligibility / screening',
              'Operational',
              'Compliance',
              'Financial',
              'Other'
            ],
            (v) => setState(() => _selectedCategory = v!),
          ),
          const SizedBox(height: 24),

          Text(
            'OPEN (${open.length})',
            style: const TextStyle(
              fontSize: 11,
              letterSpacing: 1.5,
              color: VertexColors.midnight700,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          if (open.isEmpty)
            _emptyState('No open exceptions match your filters.')
          else
            ...open.map((e) => _exceptionCard(e, true)),

          const SizedBox(height: 24),
          const Text(
            'DECIDED / CLOSED',
            style: TextStyle(
              fontSize: 11,
              letterSpacing: 1.5,
              color: VertexColors.midnight700,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          if (closed.isEmpty)
            _emptyState('None yet.')
          else
            ...closed.map((e) => _exceptionCard(e, false)),
        ],
      ),
    );
  }

  Widget _buildInlineForm() => Container(
        padding: const EdgeInsets.all(20),
        margin: const EdgeInsets.only(bottom: 24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.warning_amber_outlined,
                      color: VertexColors.midnight800, size: 20),
                  SizedBox(width: 8),
                  Text(
                    'New exception',
                    style: TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: _dropdownField(
                      'Type',
                      _exceptionType,
                      ['Candidate eligibility / screening', 'Operational', 'Compliance'],
                      (v) => setState(() => _exceptionType = v!),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                      child: _textField('CRM Ref. (optional)', _crmRef, hint: 'CRM Ref.')),
                ],
              ),
              const SizedBox(height: 16),
              _textField('Issue statement *', _issueStatement,
                  hint: 'What happened?', maxLines: 3, required: true),
              const SizedBox(height: 16),
              _textField('Immediate impact *', _immediateImpact,
                  hint: 'Describe the impact.', maxLines: 2, required: true),
              const SizedBox(height: 16),
              _textField('Decision required *', _decisionRequired,
                  hint: 'What decision is needed?', required: true),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(child: _dateField()),
                ],
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 52,
                child: ElevatedButton(
                  onPressed: _submitException,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: VertexColors.midnight800,
                    foregroundColor: Colors.white,
                    shape: const StadiumBorder(),
                  ),
                  child: const Text(
                    'RAISE EXCEPTION',
                    style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.1),
                  ),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _exceptionCard(RecruiterException e, bool isOpen) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              isOpen ? Icons.warning_amber_outlined : Icons.check_circle_outline,
              color: isOpen ? VertexColors.error : VertexColors.midnight500,
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
                      Text(
                        e.reference,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 13,
                          color: VertexColors.midnight900,
                        ),
                      ),
                      Text(
                        e.status.name.toUpperCase(),
                        style: TextStyle(
                          color: isOpen ? VertexColors.error : VertexColors.gray600,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    e.issueStatement,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: VertexColors.midnight900,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

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
      );

  Widget _textField(String label, TextEditingController controller,
          {String? hint, int maxLines = 1, bool required = false}) =>
      TextFormField(
        controller: controller,
        maxLines: maxLines,
        style: const TextStyle(
          color: VertexColors.gold600,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
        validator: required
            ? (v) => v == null || v.trim().isEmpty ? 'Required' : null
            : null,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          hintStyle: const TextStyle(color: Colors.black87),
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200),
          ),
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
          fontWeight: FontWeight.w600,
        ),
        decoration: InputDecoration(
          labelText: label,
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200),
          ),
        ),
        items: options
            .map((o) => DropdownMenuItem(
                  value: o,
                  child: Text(o, style: const TextStyle(fontSize: 13)),
                ))
            .toList(),
        onChanged: onChanged,
      );

  Widget _dateField() => TextFormField(
        readOnly: true,
        controller: TextEditingController(
            text: _targetDate != null
                ? '${_targetDate!.day}/${_targetDate!.month}/${_targetDate!.year}'
                : ''),
        style: const TextStyle(
          color: VertexColors.gold600,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
        decoration: InputDecoration(
          labelText: 'Target Date',
          hintText: 'mm/dd/yyyy',
          hintStyle: const TextStyle(color: Colors.black87),
          filled: true,
          fillColor: Colors.white,
          suffixIcon: const Icon(Icons.calendar_today_outlined,
              color: VertexColors.gold600, size: 20),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200),
          ),
        ),
        onTap: () async {
          final picked = await showDatePicker(
            context: context,
            initialDate: DateTime.now(),
            firstDate: DateTime.now(),
            lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
          );
          if (picked != null) setState(() => _targetDate = picked);
        },
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
            borderSide: const BorderSide(color: VertexColors.ivory200),
          ),
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
