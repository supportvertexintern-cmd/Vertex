import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/case_store.dart';
import '../shared/recruiter_drawer.dart';
import '../shared/vertex_app_bar_leading.dart';

class CaseInformationForm extends StatefulWidget {
  const CaseInformationForm({super.key});

  @override
  State<CaseInformationForm> createState() => _CaseInformationFormState();
}

class _CaseInformationFormState extends State<CaseInformationForm> {
  final _formKey = GlobalKey<FormState>();
  final _candidateName = TextEditingController();
  final _employer = TextEditingController();
  final _notes = TextEditingController();

  String? _nationality;
  String? _destination;
  String? _jobTitle;
  String? _contractDuration;
  String? _salaryRange;

  bool _medicalCleared = false;
  bool _visaSubmitted = false;
  bool _contractSigned = false;
  bool _declarationAccepted = false;
  bool _attemptedSubmit = false;
  bool _submitting = false;

  static const _nationalities = [
    'Ethiopia', 'Nigeria', 'Ghana', 'Kenya', 'Uganda',
    'Tanzania', 'Rwanda', 'Cameroon', 'Senegal', 'Other',
  ];

  static const _destinations = [
    'Poland', 'Germany', 'Italy', 'Netherlands',
    'Czech Republic', 'Romania', 'Hungary', 'Other',
  ];

  static const _jobTitles = [
    'Production Worker', 'Construction Worker', 'Warehouse Operative',
    'Cleaner / Housekeeper', 'Chef / Cook', 'Welder', 'Electrician',
    'Mechanic', 'Driver', 'Security Guard', 'Nurse', 'Caregiver', 'Other',
  ];

  static const _contractDurations = [
    '3 months', '6 months', '12 months', '24 months', 'Indefinite',
  ];

  static const _salaryRanges = [
    'Below €1,000 / month', '€1,000 – €1,500 / month',
    '€1,500 – €2,000 / month', '€2,000 – €2,500 / month',
    'Above €2,500 / month',
  ];

  @override
  void dispose() {
    _candidateName.dispose();
    _employer.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _attemptedSubmit = true);

    final formValid = _formKey.currentState!.validate();
    if (!formValid || !_declarationAccepted) {
      setState(() {});
      return;
    }

    setState(() => _submitting = true);
    await Future<void>.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;

    context.read<CaseStore>().add(
          CaseRecord(
            id: DateTime.now().millisecondsSinceEpoch.toString(),
            candidateName: _candidateName.text.trim(),
            nationality: _nationality ?? '',
            destination: _destination ?? '',
            jobTitle: _jobTitle ?? '',
            employer: _employer.text.trim(),
            status: CaseStatus.active,
            createdAt: DateTime.now(),
          ),
        );

    setState(() => _submitting = false);
    if (!mounted) return;
    context.go('/recruiter/cases');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const RecruiterDrawer(activeRoute: '/recruiter/cases'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        title: const Text(
          'New case',
          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
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
                letterSpacing: 1.0,
              ),
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
              'Case Registration Form',
              style: TextStyle(
                color: VertexColors.midnight900,
                fontSize: 22,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Open a new placement case for a candidate.',
              style: TextStyle(color: VertexColors.gray600, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 22),

            // ── 01 Candidate ──────────────────────────────────────────────
            _sectionHeader('01', 'Candidate details', 'Who is this case for?'),
            _field('Full name *', _candidateName, required: true),
            _dropdown('Nationality *', _nationality, _nationalities,
                (v) => setState(() => _nationality = v), required: true),
            const SizedBox(height: 22),

            // ── 02 Placement ──────────────────────────────────────────────
            _sectionHeader('02', 'Placement details', 'Where and what is the role?'),
            _dropdown('Destination country *', _destination, _destinations,
                (v) => setState(() => _destination = v), required: true),
            _dropdown('Job title *', _jobTitle, _jobTitles,
                (v) => setState(() => _jobTitle = v), required: true),
            _field('Employer / company name *', _employer, required: true),
            _dropdown('Contract duration', _contractDuration, _contractDurations,
                (v) => setState(() => _contractDuration = v)),
            _dropdown('Salary range', _salaryRange, _salaryRanges,
                (v) => setState(() => _salaryRange = v)),
            const SizedBox(height: 22),

            // ── 03 Readiness ──────────────────────────────────────────────
            _sectionHeader('03', 'Case readiness', 'Confirm what has been completed.'),
            _switchTile('Medical clearance obtained', _medicalCleared,
                (v) => setState(() => _medicalCleared = v)),
            _switchTile('Visa application submitted', _visaSubmitted,
                (v) => setState(() => _visaSubmitted = v)),
            _switchTile('Employment contract signed', _contractSigned,
                (v) => setState(() => _contractSigned = v)),
            const SizedBox(height: 22),

            // ── 04 Notes & declaration ────────────────────────────────────
            _sectionHeader('04', 'Notes & declaration', ''),
            _field('Additional notes', _notes, maxLines: 3),
            const SizedBox(height: 8),
            _checkTile(
              'I confirm the case details are accurate and complete.',
              _declarationAccepted,
              (v) => setState(() => _declarationAccepted = v),
              error: !_declarationAccepted && _attemptedSubmit,
            ),
            if (!_declarationAccepted && _attemptedSubmit) ...[
              const SizedBox(height: 4),
              const Text(
                'Declaration is required before submission.',
                style: TextStyle(color: VertexColors.error, fontSize: 12),
              ),
            ],
            const SizedBox(height: 22),

            SizedBox(
              height: 52,
              child: ElevatedButton(
                onPressed: _submitting ? null : _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: VertexColors.midnight800,
                  foregroundColor: Colors.white,
                  shape: const StadiumBorder(),
                ),
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text(
                        'OPEN CASE',
                        style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.1),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  Widget _sectionHeader(String number, String title, String subtitle) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(number,
                style: const TextStyle(
                    color: VertexColors.gold500, fontSize: 12, fontWeight: FontWeight.w800)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          color: VertexColors.midnight900,
                          fontSize: 17,
                          fontWeight: FontWeight.w800)),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(subtitle,
                        style: const TextStyle(
                            color: VertexColors.gray600, fontSize: 12, height: 1.4)),
                  ],
                ],
              ),
            ),
          ],
        ),
      );

  Widget _field(
    String label,
    TextEditingController controller, {
    bool required = false,
    int maxLines = 1,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 13),
        child: TextFormField(
          controller: controller,
          maxLines: maxLines,
          autovalidateMode: _attemptedSubmit
              ? AutovalidateMode.onUserInteraction
              : AutovalidateMode.disabled,
          cursorColor: VertexColors.gold600,
          style: const TextStyle(
              color: VertexColors.gold600, fontSize: 14, fontWeight: FontWeight.w600),
          validator: required
              ? (v) => v == null || v.trim().isEmpty ? 'Required' : null
              : null,
          decoration: _decoration(label),
        ),
      );

  Widget _dropdown(
    String label,
    String? value,
    List<String> options,
    ValueChanged<String?> onChanged, {
    bool required = false,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 13),
        child: DropdownButtonFormField<String>(
          value: value,
          isExpanded: true,
          style: const TextStyle(
              color: VertexColors.gold600, fontSize: 14, fontWeight: FontWeight.w600),
          dropdownColor: Colors.white,
          iconEnabledColor: VertexColors.gold600,
          decoration: _decoration(label),
          autovalidateMode: _attemptedSubmit
              ? AutovalidateMode.onUserInteraction
              : AutovalidateMode.disabled,
          validator: required ? (v) => v == null ? 'Required' : null : null,
          items: options
              .map((o) => DropdownMenuItem(
                    value: o,
                    child: Text(o,
                        style: const TextStyle(
                            color: VertexColors.gold600,
                            fontSize: 14,
                            fontWeight: FontWeight.w600)),
                  ))
              .toList(),
          onChanged: onChanged,
        ),
      );

  Widget _switchTile(String label, bool value, ValueChanged<bool> onChanged) =>
      SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        title: Text(label,
            style: const TextStyle(color: VertexColors.gray800, fontSize: 13)),
        value: value,
        activeThumbColor: VertexColors.midnight500,
        onChanged: onChanged,
      );

  Widget _checkTile(
    String label,
    bool value,
    ValueChanged<bool> onChanged, {
    bool error = false,
  }) =>
      CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        title: Text(
          label,
          style: TextStyle(
            color: error ? VertexColors.error : VertexColors.gray800,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
        value: value,
        activeColor: VertexColors.midnight500,
        onChanged: (v) => onChanged(v ?? false),
      );

  InputDecoration _decoration(String label) => InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: VertexColors.gray600, fontSize: 12),
        floatingLabelStyle: const TextStyle(
            color: VertexColors.midnight700, fontSize: 12, fontWeight: FontWeight.w600),
        errorStyle: const TextStyle(color: VertexColors.error, fontSize: 11),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.ivory200)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.gold600, width: 1.4)),
        errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.error)),
        focusedErrorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(color: VertexColors.error, width: 1.4)),
      );
}
