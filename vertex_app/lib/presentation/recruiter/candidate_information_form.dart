import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/candidate_store.dart';
import '../shared/recruiter_drawer.dart';
import '../shared/vertex_app_bar_leading.dart';

// =============================================================================
// Data models & static lists
// =============================================================================

class _DocumentItem {
  _DocumentItem({
    required this.id,
    required this.label,
    this.required = false,
  }) : hint = null;

  final String id;
  final String label;
  final String? hint;
  final bool required;

  bool available = false;
  String? fileName;
  String? fileSize;

  bool get hasFile => fileName != null;
}

class _Country {
  const _Country({
    required this.name,
    required this.iso,
    required this.dialCode,
    required this.flag,
  });

  final String name;
  final String iso;
  final String dialCode;
  final String flag;
}

const List<_Country> _countries = [
  _Country(name: 'Ethiopia', iso: 'ET', dialCode: '+251', flag: '🇪🇹'),
  _Country(name: 'Nigeria', iso: 'NG', dialCode: '+234', flag: '🇳🇬'),
  _Country(name: 'Ghana', iso: 'GH', dialCode: '+233', flag: '🇬🇭'),
  _Country(name: 'Kenya', iso: 'KE', dialCode: '+254', flag: '🇰🇪'),
  _Country(name: 'United Arab Emirates', iso: 'AE', dialCode: '+971', flag: '🇦🇪'),
  _Country(name: 'United States', iso: 'US', dialCode: '+1', flag: '🇺🇸'),
  _Country(name: 'United Kingdom', iso: 'GB', dialCode: '+44', flag: '🇬🇧'),
  _Country(name: 'Germany', iso: 'DE', dialCode: '+49', flag: '🇩🇪'),
  _Country(name: 'France', iso: 'FR', dialCode: '+33', flag: '🇫🇷'),
  _Country(name: 'Italy', iso: 'IT', dialCode: '+39', flag: '🇮🇹'),
  _Country(name: 'Poland', iso: 'PL', dialCode: '+48', flag: '🇵🇱'),
  _Country(name: 'Netherlands', iso: 'NL', dialCode: '+31', flag: '🇳🇱'),
  _Country(name: 'Canada', iso: 'CA', dialCode: '+1', flag: '🇨🇦'),
  _Country(name: 'South Africa', iso: 'ZA', dialCode: '+27', flag: '🇿🇦'),
  _Country(name: 'Egypt', iso: 'EG', dialCode: '+20', flag: '🇪🇬'),
  _Country(name: 'India', iso: 'IN', dialCode: '+91', flag: '🇮🇳'),
  _Country(name: 'China', iso: 'CN', dialCode: '+86', flag: '🇨🇳'),
  _Country(name: 'Turkey', iso: 'TR', dialCode: '+90', flag: '🇹🇷'),
  _Country(name: 'Saudi Arabia', iso: 'SA', dialCode: '+966', flag: '🇸🇦'),
  _Country(name: 'Qatar', iso: 'QA', dialCode: '+974', flag: '🇶🇦'),
];

const List<String> _occupations = [
  'Accountant', 'Architect', 'Baker', 'Barber', 'Carpenter', 'Cashier',
  'Chef / Cook', 'Cleaner', 'Construction Worker', 'Customer Service',
  'Dentist', 'Doctor', 'Driver', 'Electrician', 'Engineer – Civil',
  'Engineer – Electrical', 'Engineer – Mechanical', 'Farmer',
  'Factory Worker', 'Firefighter', 'Florist', 'Gardener', 'Hairdresser',
  'Housekeeper', 'IT Professional', 'Journalist', 'Laboratory Technician',
  'Lawyer', 'Machinist', 'Mason', 'Mechanic', 'Nurse', 'Painter',
  'Pharmacist', 'Plumber', 'Police Officer', 'Receptionist', 'Salesperson',
  'Security Guard', 'Software Developer', 'Soldier', 'Student', 'Tailor',
  'Teacher', 'Truck Driver', 'Unemployed', 'Waiter / Waitress', 'Welder',
  'Other',
];

const List<String> _educationLevels = [
  'No formal education',
  'Primary school',
  'Secondary school',
  'Vocational / Technical certificate',
  'Diploma',
  "Bachelor's degree",
  "Master's degree",
  'Doctorate / PhD',
  'Other',
];

// =============================================================================
// Form
// =============================================================================

class CandidateInformationForm extends StatefulWidget {
  const CandidateInformationForm({super.key});

  @override
  State<CandidateInformationForm> createState() =>
      _CandidateInformationFormState();
}

class _CandidateInformationFormState extends State<CandidateInformationForm> {
  final formKey = GlobalKey<FormState>();
  final fullName = TextEditingController();
  final travelDate = TextEditingController();
  final dateOfBirth = TextEditingController();
  final passportNumber = TextEditingController();
  final passportExpiry = TextEditingController();
  final phone = TextEditingController();
  final email = TextEditingController();
  final address = TextEditingController();
  final notes = TextEditingController();

  String? opportunity;
  String? gender;
  String? nationality;
  String? currentLocation;
  String? contactChannel;
  String? occupation;
  String? educationLevel;

  _Country selectedCountry = _countries.first;

  bool priorEuVisa = false;
  bool schengenVisa = false;
  bool priorRefusal = false;
  bool embassyAvailable = false;
  bool readyWithinThirtyDays = false;
  bool paymentAcknowledged = false;
  bool declarationAccepted = false;
  bool submitting = false;
  bool _attemptedSubmit = false;

  final List<_DocumentItem> documents = [
    _DocumentItem(id: 'passport', label: 'Passport', required: true),
    _DocumentItem(id: 'photo', label: 'Passport-size photo', required: true),
    _DocumentItem(id: 'cv', label: 'CV / résumé'),
    _DocumentItem(id: 'education', label: 'Education records'),
    _DocumentItem(id: 'police', label: 'Police clearance'),
  ];

  @override
  void dispose() {
    for (final c in [
      fullName, travelDate, dateOfBirth, passportNumber, passportExpiry,
      phone, email, address, notes,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------
  static final _emailRegex = RegExp(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$",
  );

  String? _validateEmail(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return 'Required';
    if (!_emailRegex.hasMatch(v)) return 'Enter a valid email address';
    return null;
  }

  String? _validatePhone(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return 'Required';
    final digits = v.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 6) return 'Number is too short';
    if (digits.length > 15) return 'Number is too long';
    if (!RegExp(r'^[0-9 ()\-]+$').hasMatch(v)) {
      return 'Only digits, spaces and ( ) - allowed';
    }
    return null;
  }

  DateTime? _parseDate(String value) {
    try {
      final parts = value.split('/');
      if (parts.length != 3) return null;
      return DateTime(
        int.parse(parts[2]),
        int.parse(parts[1]),
        int.parse(parts[0]),
      );
    } catch (_) {
      return null;
    }
  }

  bool get _documentsComplete =>
      documents.every((doc) => !doc.available || doc.hasFile);

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------
  Future<void> submit() async {
    setState(() => _attemptedSubmit = true);

    final formValid = formKey.currentState!.validate();
    final acknowledgementsValid = paymentAcknowledged && declarationAccepted;
    final documentsValid = _documentsComplete;

    if (!formValid || !acknowledgementsValid || !documentsValid) {
      if (!documentsValid && mounted) {
        _showSnackBar('Every checked document must have a file attached.');
      }
      setState(() {});
      return;
    }

    final travel = _parseDate(travelDate.text);
    final dob = _parseDate(dateOfBirth.text);
    final expiry = _parseDate(passportExpiry.text);

    if (travel != null && dob != null && dob.isAfter(travel)) {
      _showSnackBar('Date of birth cannot be after the travel date.');
      return;
    }
    if (travel != null && expiry != null && expiry.isBefore(travel)) {
      _showSnackBar('Passport expiry must be after the travel date.');
      return;
    }

    setState(() => submitting = true);
    await Future<void>.delayed(const Duration(milliseconds: 700));
    if (!mounted) return;

    context.read<CandidateStore>().add(
          CandidateRecord(
            id: DateTime.now().millisecondsSinceEpoch.toString(),
            fullName: fullName.text.trim(),
            nationality: nationality ?? '',
            opportunity: opportunity ?? '',
            gender: gender ?? '',
            phone: '${selectedCountry.dialCode} ${phone.text.trim()}',
            email: email.text.trim(),
            registeredAt: DateTime.now(),
          ),
        );

    setState(() => submitting = false);
    if (!mounted) return;
    context.go('/recruiter');

  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: VertexColors.error,
          content: Text(message),
        ),
      );
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const RecruiterDrawer(activeRoute: '/recruiter'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        title: const Text(
          'New intake record',
          style: TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
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
        key: formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 34),
          children: [
            const Text(
              'Candidate Information Form',
              style: TextStyle(
                color: VertexColors.midnight900,
                fontSize: 22,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'New candidate lead — filled in on their behalf.',
              style: TextStyle(
                color: VertexColors.gray600,
                fontSize: 13,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 22),

            // ---- 01 Programme selection -----------------------------------
            _sectionHeader('01', 'Programme selection',
                'Choose the opportunity and travel readiness details.'),
            _dropdown(
              'Opportunity *',
              opportunity,
              [
                'Poland · Production & Construction',
                'Germany · Engineering',
                'Italy · Hospitality',
              ],
              (v) => setState(() => opportunity = v),
              required: true,
            ),
            _dateField(
              'Earliest possible travel date *',
              travelDate,
              helpText: 'When can the candidate realistically travel?',
              firstDate: DateTime.now(),
              lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
              dateValidator: (date) {
                if (date.isBefore(DateTime.now())) {
                  return 'Travel date cannot be in the past';
                }
                return null;
              },
              required: true,
            ),
            _switchTile(
              'Previously applied for an EU visa?',
              priorEuVisa,
              (v) => setState(() => priorEuVisa = v),
            ),
            const SizedBox(height: 22),

            // ---- 02 Personal information ----------------------------------
            _sectionHeader('02', 'Personal information',
                'Capture the lead exactly as shown on official documents.'),
            _field('Full name as per passport *', fullName, required: true),
            _dateField(
              'Date of birth *',
              dateOfBirth,
              helpText: 'Select the date of birth',
              firstDate: DateTime(1900),
              lastDate: DateTime.now(),
              dateValidator: (date) {
                final age =
                    DateTime.now().difference(date).inDays / 365.25;
                if (age < 18) return 'Candidate must be at least 18 years old';
                if (age > 100) return 'Please enter a valid date of birth';
                return null;
              },
              required: true,
            ),
            _dropdown(
              'Gender *',
              gender,
              ['Male', 'Female'],
              (v) => setState(() => gender = v),
              required: true,
            ),
            _dropdown(
              'Nationality *',
              nationality,
              [
                'Ethiopia', 'Nigeria', 'Ghana', 'Kenya',
                'United Arab Emirates', 'Other',
              ],
              (v) => setState(() => nationality = v),
              required: true,
            ),
            _field('Passport number *', passportNumber, required: true),
            _dateField(
              'Passport expiry date *',
              passportExpiry,
              helpText: 'Select passport expiry date',
              firstDate: DateTime.now(),
              lastDate: DateTime.now().add(const Duration(days: 365 * 15)),
              dateValidator: (date) {
                if (date.isBefore(DateTime.now())) {
                  return 'Passport has already expired';
                }
                return null;
              },
              required: true,
            ),
            // Searchable occupation dropdown
            _searchableDropdown(
              'Current occupation',
              occupation,
              _occupations,
              (v) => setState(() => occupation = v),
              hint: 'Search or select occupation',
            ),
            // Education dropdown
            _dropdown(
              'Highest education / qualification',
              educationLevel,
              _educationLevels,
              (v) => setState(() => educationLevel = v),
            ),
            // Phone with country code picker + flag
            _phoneField(),
            _field(
              'Email address *',
              email,
              keyboard: TextInputType.emailAddress,
              required: true,
              customValidator: _validateEmail,
            ),
            _field('Complete home address', address, maxLines: 2),
            const SizedBox(height: 22),

            // ---- 03 Document checklist ------------------------------------
            _sectionHeader('03', 'Document checklist',
                'Tick each document the lead can provide, then attach the file.'),
            ...documents.map(_documentTile),
            const SizedBox(height: 22),

            // ---- 04 Payment plan ------------------------------------------
            _sectionHeader('04', 'Payment plan acknowledgement',
                'The service fee is managed in three milestones.'),
            _paymentRow('Stage 1 · 25%', 'Documentation and engagement'),
            _paymentRow('Stage 2 · 25%', 'Work permit issued'),
            _paymentRow('Stage 3 · 50%', 'Visa granted'),
            _checkTile(
              'The payment plan has been explained and acknowledged.',
              paymentAcknowledged,
              (v) => setState(() => paymentAcknowledged = v),
              error: !paymentAcknowledged && _attemptedSubmit,
            ),
            const SizedBox(height: 22),

            // ---- 05 Visa & travel readiness -------------------------------
            _sectionHeader('05', 'Visa and travel readiness',
                'Record the operational information your supervisor needs.'),
            _dropdown(
              'Current location country *',
              currentLocation,
              [
                'Ethiopia', 'Nigeria', 'Ghana', 'Kenya',
                'United Arab Emirates', 'Other',
              ],
              (v) => setState(() => currentLocation = v),
              required: true,
            ),
            _switchTile(
              'Currently holds a Schengen / EU visa?',
              schengenVisa,
              (v) => setState(() => schengenVisa = v),
            ),
            _switchTile(
              'Has had a prior visa refusal?',
              priorRefusal,
              (v) => setState(() => priorRefusal = v),
            ),
            _switchTile(
              'Available for an embassy appointment?',
              embassyAvailable,
              (v) => setState(() => embassyAvailable = v),
            ),
            _switchTile(
              'Willing to start within 30 days of visa issue?',
              readyWithinThirtyDays,
              (v) => setState(() => readyWithinThirtyDays = v),
            ),
            _dropdown(
              'Preferred contact channel *',
              contactChannel,
              ['Email', 'WhatsApp', 'Phone'],
              (v) => setState(() => contactChannel = v),
              required: true,
            ),
            _field('Additional notes', notes, maxLines: 3),
            const SizedBox(height: 18),
            _checkTile(
              'I confirm that the information provided is complete and accurate.',
              declarationAccepted,
              (v) => setState(() => declarationAccepted = v),
              error: !declarationAccepted && _attemptedSubmit,
            ),
            if (!paymentAcknowledged ||
                !declarationAccepted ||
                !_documentsComplete) ...[
              const SizedBox(height: 8),
              const Text(
                'Payment acknowledgement, declaration and all attached documents '
                'are required before submission.',
                style: TextStyle(color: VertexColors.error, fontSize: 12),
              ),
            ],
            const SizedBox(height: 22),
            SizedBox(
              height: 52,
              child: ElevatedButton(
                onPressed: submitting ? null : submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: VertexColors.midnight800,
                  foregroundColor: Colors.white,
                  shape: const StadiumBorder(),
                ),
                child: submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'REGISTER INTAKE RECORD',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.1,
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // =========================================================================
  // Date Field with themed picker
  // =========================================================================
  Widget _dateField(
    String label,
    TextEditingController controller, {
    String? hint,
    String? helpText,
    bool required = false,
    DateTime? firstDate,
    DateTime? lastDate,
    String? Function(DateTime)? dateValidator,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 13),
        child: TextFormField(
          controller: controller,
          readOnly: true,
          cursorColor: VertexColors.gold600,
          style: const TextStyle(
            color: VertexColors.gold600,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
          validator: (value) {
            if (required && (value == null || value.trim().isEmpty)) {
              return 'Required';
            }
            if (value != null && value.isNotEmpty && dateValidator != null) {
              final d = _parseDate(value);
              if (d == null) return 'Invalid date';
              return dateValidator(d);
            }
            return null;
          },
          decoration: _decoration(label, hint ?? 'DD / MM / YYYY').copyWith(
            suffixIcon: const Icon(
              Icons.calendar_month_outlined,
              color: VertexColors.gold600,
              size: 20,
            ),
          ),
          onTap: () => _openDatePicker(
            controller: controller,
            helpText: helpText ?? label.replaceAll(' *', ''),
            firstDate: firstDate ?? DateTime(1900),
            lastDate: lastDate ?? DateTime(2100),
          ),
        ),
      );

  Future<void> _openDatePicker({
    required TextEditingController controller,
    required String helpText,
    required DateTime firstDate,
    required DateTime lastDate,
  }) async {
    final now = DateTime.now();
    final initial = controller.text.isNotEmpty
        ? (_parseDate(controller.text) ?? now)
        : now;

    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: firstDate,
      lastDate: lastDate,
      initialEntryMode: DatePickerEntryMode.calendar,
      helpText: helpText.toUpperCase(),
      cancelText: 'CANCEL',
      confirmText: 'SELECT',
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            datePickerTheme: DatePickerThemeData(
              backgroundColor: Colors.white,
              surfaceTintColor: Colors.transparent,
              // Header
              headerBackgroundColor: VertexColors.midnight800,
              headerForegroundColor: Colors.white,
              headerHeadlineStyle: const TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.5,
              ),
              headerHelpStyle: const TextStyle(
                fontSize: 11,
                color: Colors.white70,
                letterSpacing: 1.2,
                fontWeight: FontWeight.w700,
              ),
              // Weekday labels
              weekdayStyle: const TextStyle(
                color: VertexColors.midnight700,
                fontWeight: FontWeight.w800,
                fontSize: 12,
              ),
              // Day cells
              dayStyle: const TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
              dayForegroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.disabled)) {
                  return VertexColors.gray400;
                }
                if (states.contains(WidgetState.selected)) {
                  return Colors.white;
                }
                return VertexColors.midnight900;
              }),
              dayBackgroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.selected)) {
                  return VertexColors.gold600;
                }
                return Colors.transparent;
              }),
              dayOverlayColor: WidgetStateProperty.all(
                VertexColors.gold500.withValues(alpha: 0.18),
              ),
              // Today
              todayForegroundColor: WidgetStateProperty.all(
                VertexColors.gold600,
              ),
              todayBorder: const BorderSide(
                color: VertexColors.gold600,
                width: 1.4,
              ),
              // Year picker
              yearForegroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.selected)) {
                  return Colors.white;
                }
                return VertexColors.midnight900;
              }),
              yearBackgroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.selected)) {
                  return VertexColors.gold600;
                }
                return Colors.transparent;
              }),
              yearOverlayColor: WidgetStateProperty.all(
                VertexColors.gold500.withValues(alpha: 0.18),
              ),
              // Divider
              dividerColor: VertexColors.ivory200,
              // Dialog shape
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(22),
              ),
              elevation: 12,
            ),
            textButtonTheme: TextButtonThemeData(
              style: TextButton.styleFrom(
                foregroundColor: VertexColors.gold600,
                textStyle: const TextStyle(
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.0,
                ),
              ),
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      final formatted =
          '${picked.day.toString().padLeft(2, '0')}/${picked.month.toString().padLeft(2, '0')}/${picked.year}';
      controller.text = formatted;
      formKey.currentState?.validate();
    }
  }

  // =========================================================================
  // Searchable dropdown (for occupation)
  // =========================================================================
  Widget _searchableDropdown(
    String label,
    String? value,
    List<String> options,
    ValueChanged<String?> onChanged, {
    String? hint,
    bool required = false,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 13),
        child: FormField<String>(
          initialValue: value,
          validator: (v) =>
              required && (v == null || v.isEmpty) ? 'Required' : null,
          builder: (fieldState) {
            return InkWell(
              onTap: () async {
                final result = await _showSearchableSheet(
                  title: label.replaceAll(' *', ''),
                  options: options,
                  currentValue: value,
                  hint: hint ?? 'Search…',
                );
                if (result != null) {
                  onChanged(result);
                  fieldState.didChange(result);
                }
              },
              borderRadius: BorderRadius.circular(11),
              child: InputDecorator(
                // FIX: We pass `null` for the hint here so the InputDecorator
                // doesn't draw its own hint. We draw the hint manually below.
                decoration: _decoration(label, null).copyWith(
                  errorText: fieldState.errorText,
                ),
                isEmpty: value == null || value.isEmpty,
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        value ?? hint ?? 'Search or select',
                        style: TextStyle(
                          color: value == null
                              ? VertexColors.gray400
                              : VertexColors.gold600,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const Icon(
                      Icons.search,
                      color: VertexColors.gold600,
                      size: 20,
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      );

  Future<String?> _showSearchableSheet({
    required String title,
    required List<String> options,
    required String hint,
    String? currentValue,
  }) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return _SearchablePickerSheet(
          title: title,
          options: options,
          hint: hint,
          currentValue: currentValue,
        );
      },
    );
  }

  // =========================================================================
  // Phone field with flag + dial code picker
  // =========================================================================
  Widget _phoneField() => Padding(
        padding: const EdgeInsets.only(bottom: 13),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Country code button
            InkWell(
              onTap: _pickCountry,
              borderRadius: BorderRadius.circular(11),
              child: Container(
                height: 52,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(11),
                  border: Border.all(color: VertexColors.ivory200),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      selectedCountry.flag,
                      style: const TextStyle(fontSize: 20),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      selectedCountry.dialCode,
                      style: const TextStyle(
                        color: VertexColors.gold600,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(width: 2),
                    const Icon(
                      Icons.arrow_drop_down,
                      color: VertexColors.gold600,
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 8),
            // Phone number field
            Expanded(
              child: TextFormField(
                controller: phone,
                keyboardType: TextInputType.phone,
                cursorColor: VertexColors.gold600,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(
                    RegExp(r'[0-9+\- ()]'),
                  ),
                ],
                style: const TextStyle(
                  color: VertexColors.gold600,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
                validator: _validatePhone,
                decoration: _decoration(
                  'Phone number with country code *',
                  '911 234 567',
                ),
              ),
            ),
          ],
        ),
      );

  Future<void> _pickCountry() async {
    final result = await showModalBottomSheet<_Country>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _CountryPickerSheet(
        current: selectedCountry,
        countries: _countries,
      ),
    );
    if (result != null) setState(() => selectedCountry = result);
  }

  // =========================================================================
  // Document checklist tile
  // =========================================================================
  Widget _documentTile(_DocumentItem item) {
    final missingFile = item.available && !item.hasFile && _attemptedSubmit;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: missingFile ? VertexColors.error : VertexColors.ivory200,
          width: missingFile ? 1.2 : 1,
        ),
      ),
      child: Column(
        children: [
          CheckboxListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 8),
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(
              item.label,
              style: const TextStyle(
                color: VertexColors.gray800,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            value: item.available,
            activeColor: VertexColors.midnight500,
            onChanged: (checked) =>
                setState(() => item.available = checked ?? false),
          ),
          if (item.available) ...[
            const Divider(height: 1, color: VertexColors.ivory200),
            Padding(
              padding: const EdgeInsets.all(12),
              child: item.hasFile
                  ? _filePreview(item)
                  : _uploadPrompt(item, error: missingFile),
            ),
          ],
        ],
      ),
    );
  }

  Widget _uploadPrompt(_DocumentItem item, {bool error = false}) => InkWell(
        onTap: () => _showSourceSheet(item),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
          decoration: BoxDecoration(
            color: VertexColors.ivory50,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: error ? VertexColors.error : VertexColors.ivory200,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: VertexColors.ivory200),
                ),
                child: const Icon(
                  Icons.cloud_upload_outlined,
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
                      'Upload ${item.label.toLowerCase()}',
                      style: const TextStyle(
                        color: VertexColors.midnight900,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      error
                          ? 'A file is required for this document.'
                          : (item.hint ?? 'PDF, JPG or PNG · max 10 MB'),
                      style: TextStyle(
                        color: error
                            ? VertexColors.error
                            : VertexColors.gray600,
                        fontSize: 11,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right,
                color: VertexColors.gray400,
                size: 20,
              ),
            ],
          ),
        ),
      );

  Widget _filePreview(_DocumentItem item) => Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 10),
        decoration: BoxDecoration(
          color: VertexColors.ivory50,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: VertexColors.ivory200),
              ),
              child: Icon(
                _iconForFile(item.fileName!),
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
                    item.fileName!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      const Icon(
                        Icons.check_circle,
                        color: VertexColors.midnight500,
                        size: 13,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Attached${item.fileSize != null ? ' · ${item.fileSize}' : ''}',
                        style: const TextStyle(
                          color: VertexColors.gray600,
                          fontSize: 11,
                        ),
                      ),
                      const SizedBox(width: 10),
                      GestureDetector(
                        onTap: () => _showSourceSheet(item),
                        child: const Text(
                          'Replace',
                          style: TextStyle(
                            color: VertexColors.gold600,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            decoration: TextDecoration.underline,
                            decorationColor: VertexColors.gold600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Remove file',
              visualDensity: VisualDensity.compact,
              onPressed: () => setState(() {
                item.fileName = null;
                item.fileSize = null;
              }),
              icon: const Icon(
                Icons.close,
                size: 18,
                color: VertexColors.gray600,
              ),
            ),
          ],
        ),
      );

  Future<void> _showSourceSheet(_DocumentItem item) async {
    final source = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: VertexColors.ivory200,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Attach ${item.label.toLowerCase()}',
              style: const TextStyle(
                color: VertexColors.midnight900,
                fontSize: 15,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            _sheetOption(sheetContext,
                icon: Icons.photo_camera_outlined,
                label: 'Take a photo',
                value: 'camera'),
            _sheetOption(sheetContext,
                icon: Icons.photo_library_outlined,
                label: 'Choose from gallery',
                value: 'gallery'),
            _sheetOption(sheetContext,
                icon: Icons.folder_open_outlined,
                label: 'Browse files',
                value: 'files'),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );

    if (source == null || !mounted) return;

    await Future<void>.delayed(const Duration(milliseconds: 350));
    if (!mounted) return;

    final isImage = source == 'camera' || source == 'gallery';
    final extension = isImage ? 'jpg' : 'pdf';
    final stamp = DateTime.now().millisecondsSinceEpoch.toString().substring(7);

    setState(() {
      item.fileName = '${item.id}_$stamp.$extension';
      item.fileSize = isImage ? '1.8 MB' : '420 KB';
    });
  }

  Widget _sheetOption(
    BuildContext sheetContext, {
    required IconData icon,
    required String label,
    required String value,
  }) =>
      ListTile(
        leading: Icon(icon, color: VertexColors.gold600),
        title: Text(
          label,
          style: const TextStyle(
            color: VertexColors.midnight900,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        onTap: () => Navigator.of(sheetContext).pop(value),
      );

  IconData _iconForFile(String name) {
    final ext = name.split('.').last.toLowerCase();
    switch (ext) {
      case 'pdf':
        return Icons.picture_as_pdf_outlined;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'heic':
        return Icons.image_outlined;
      case 'doc':
      case 'docx':
        return Icons.description_outlined;
      default:
        return Icons.insert_drive_file_outlined;
    }
  }

  // =========================================================================
  // Shared widgets
  // =========================================================================
  Widget _sectionHeader(String number, String title, String subtitle) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              number,
              style: const TextStyle(
                color: VertexColors.gold500,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: VertexColors.gray600,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _field(
    String label,
    TextEditingController controller, {
    String? hint,
    bool required = false,
    TextInputType? keyboard,
    int maxLines = 1,
    String? Function(String?)? customValidator,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 13),
        child: TextFormField(
          controller: controller,
          keyboardType: keyboard,
          maxLines: maxLines,
          autovalidateMode: _attemptedSubmit
              ? AutovalidateMode.onUserInteraction
              : AutovalidateMode.disabled,
          cursorColor: VertexColors.gold600,
          style: const TextStyle(
            color: VertexColors.gold600,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
          validator: customValidator ??
              (required
                  ? (value) => value == null || value.trim().isEmpty
                      ? 'Required'
                      : null
                  : null),
          decoration: _decoration(label, hint),
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
            color: VertexColors.gold600,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
          dropdownColor: Colors.white,
          iconEnabledColor: VertexColors.gold600,
          decoration: _decoration(label, 'Select an option'),
          items: options
              .map(
                (option) => DropdownMenuItem<String>(
                  value: option,
                  child: Text(
                    option,
                    style: const TextStyle(
                      color: VertexColors.gold600,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              )
              .toList(),
          autovalidateMode: _attemptedSubmit
              ? AutovalidateMode.onUserInteraction
              : AutovalidateMode.disabled,
          validator: required
              ? (selected) => selected == null ? 'Required' : null
              : null,
          onChanged: onChanged,
        ),
      );

  InputDecoration _decoration(String label, String? hint) => InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: VertexColors.gray600, fontSize: 12),
        floatingLabelStyle: const TextStyle(
          color: VertexColors.midnight700,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
        hintStyle: const TextStyle(color: VertexColors.gray400, fontSize: 12),
        errorStyle: const TextStyle(color: VertexColors.error, fontSize: 11),
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
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
          borderSide: const BorderSide(color: VertexColors.gold600, width: 1.4),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(11),
          borderSide: const BorderSide(color: VertexColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(11),
          borderSide: const BorderSide(color: VertexColors.error, width: 1.4),
        ),
      );

  Widget _switchTile(String label, bool value, ValueChanged<bool> onChanged) =>
      SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        title: Text(
          label,
          style: const TextStyle(color: VertexColors.gray800, fontSize: 13),
        ),
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
        onChanged: (checked) => onChanged(checked ?? false),
      );

  Widget _paymentRow(String title, String detail) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.payments_outlined,
              color: VertexColors.gold500,
              size: 20,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    detail,
                    style: const TextStyle(
                      color: VertexColors.gray600,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
}

// =============================================================================
// NEW: Searchable picker sheet (extracted to prevent '_dependents.isEmpty' crash)
// =============================================================================
class _SearchablePickerSheet extends StatefulWidget {
  const _SearchablePickerSheet({
    required this.title,
    required this.options,
    required this.hint,
    this.currentValue,
  });

  final String title;
  final List<String> options;
  final String hint;
  final String? currentValue;

  @override
  State<_SearchablePickerSheet> createState() => _SearchablePickerSheetState();
}

class _SearchablePickerSheetState extends State<_SearchablePickerSheet> {
  final searchController = TextEditingController();
  String query = '';

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final q = query.trim().toLowerCase();
    final filtered = q.isEmpty
        ? widget.options
        : widget.options.where((o) => o.toLowerCase().contains(q)).toList();

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.8,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: VertexColors.ivory200,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 14),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                widget.title,
                style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: searchController,
                autofocus: true,
                cursorColor: VertexColors.gold600,
                style: const TextStyle(
                  color: VertexColors.gold600,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
                onChanged: (v) => setState(() => query = v),
                decoration: InputDecoration(
                  hintText: widget.hint,
                  hintStyle: const TextStyle(
                    color: VertexColors.gray400,
                    fontSize: 13,
                  ),
                  prefixIcon: const Icon(
                    Icons.search,
                    color: VertexColors.gold600,
                    size: 20,
                  ),
                  suffixIcon: searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(
                            Icons.close,
                            size: 18,
                            color: VertexColors.gray600,
                          ),
                          onPressed: () {
                            searchController.clear();
                            setState(() => query = '');
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: VertexColors.ivory50,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: VertexColors.ivory200),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: VertexColors.ivory200),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(
                      color: VertexColors.gold600,
                      width: 1.4,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Flexible(
              child: filtered.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(28),
                      child: Text(
                        'No matches found',
                        style: TextStyle(
                          color: VertexColors.gray600,
                          fontSize: 13,
                        ),
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 6,
                      ),
                      itemCount: filtered.length,
                      itemBuilder: (_, i) {
                        final option = filtered[i];
                        final selected = option == widget.currentValue;
                        return ListTile(
                          dense: true,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                          title: Text(
                            option,
                            style: TextStyle(
                              color: selected
                                  ? VertexColors.gold600
                                  : VertexColors.midnight900,
                              fontSize: 14,
                              fontWeight: selected
                                  ? FontWeight.w800
                                  : FontWeight.w500,
                            ),
                          ),
                          trailing: selected
                              ? const Icon(
                                  Icons.check_circle,
                                  color: VertexColors.gold600,
                                  size: 18,
                                )
                              : null,
                          onTap: () => Navigator.of(context).pop(option),
                        );
                      },
                    ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// Country picker sheet (searchable, with flags)
// =============================================================================
class _CountryPickerSheet extends StatefulWidget {
  const _CountryPickerSheet({
    required this.current,
    required this.countries,
  });

  final _Country current;
  final List<_Country> countries;

  @override
  State<_CountryPickerSheet> createState() => _CountryPickerSheetState();
}

class _CountryPickerSheetState extends State<_CountryPickerSheet> {
  final searchController = TextEditingController();
  String query = '';

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final q = query.trim().toLowerCase();
    final filtered = q.isEmpty
        ? widget.countries
        : widget.countries
            .where((c) =>
                c.name.toLowerCase().contains(q) ||
                c.dialCode.contains(q) ||
                c.iso.toLowerCase().contains(q))
            .toList();

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.8,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: VertexColors.ivory200,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 14),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'Select country code',
                style: TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: searchController,
                autofocus: true,
                cursorColor: VertexColors.gold600,
                style: const TextStyle(
                  color: VertexColors.gold600,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
                onChanged: (v) => setState(() => query = v),
                decoration: InputDecoration(
                  hintText: 'Search country or code…',
                  hintStyle: const TextStyle(
                    color: VertexColors.gray400,
                    fontSize: 13,
                  ),
                  prefixIcon: const Icon(
                    Icons.search,
                    color: VertexColors.gold600,
                    size: 20,
                  ),
                  filled: true,
                  fillColor: VertexColors.ivory50,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: VertexColors.ivory200),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: VertexColors.ivory200),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(
                      color: VertexColors.gold600,
                      width: 1.4,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Flexible(
              child: filtered.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(28),
                      child: Text(
                        'No matches found',
                        style: TextStyle(
                          color: VertexColors.gray600,
                          fontSize: 13,
                        ),
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 6,
                      ),
                      itemCount: filtered.length,
                      itemBuilder: (_, i) {
                        final c = filtered[i];
                        final selected = c.iso == widget.current.iso;
                        return ListTile(
                          dense: true,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                          leading: Text(
                            c.flag,
                            style: const TextStyle(fontSize: 22),
                          ),
                          title: Text(
                            c.name,
                            style: TextStyle(
                              color: selected
                                  ? VertexColors.gold600
                                  : VertexColors.midnight900,
                              fontSize: 14,
                              fontWeight: selected
                                  ? FontWeight.w800
                                  : FontWeight.w500,
                            ),
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                c.dialCode,
                                style: TextStyle(
                                  color: selected
                                      ? VertexColors.gold600
                                      : VertexColors.gray600,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              if (selected) ...[
                                const SizedBox(width: 6),
                                const Icon(
                                  Icons.check_circle,
                                  color: VertexColors.gold600,
                                  size: 18,
                                ),
                              ],
                            ],
                          ),
                          onTap: () => Navigator.of(context).pop(c),
                        );
                      },
                    ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}