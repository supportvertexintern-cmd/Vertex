import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/management_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'director_drawer.dart';

const Map<String, String> _typeLabels = {
  'travel_agency': 'Travel Agency',
  'visa_consultancy': 'Visa Consultancy',
  'manpower_supplier': 'Manpower Supplier',
  'other': 'Other',
};

class ManagementPartnerDetailScreen extends StatefulWidget {
  const ManagementPartnerDetailScreen({super.key, required this.partnerId});

  final String partnerId;

  @override
  State<ManagementPartnerDetailScreen> createState() =>
      _ManagementPartnerDetailScreenState();
}

class _ManagementPartnerDetailScreenState
    extends State<ManagementPartnerDetailScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _countryController;
  late final TextEditingController _contactNameController;
  late final TextEditingController _contactEmailController;
  late final TextEditingController _contactPhoneController;
  late final TextEditingController _notesController;

  bool _editing = false;

  @override
  void initState() {
    super.initState();
    final partner = context.read<ManagementStore>().partnerById(widget.partnerId);
    _nameController = TextEditingController(text: partner?.name ?? '');
    _countryController =
        TextEditingController(text: partner?.countryOfOperation ?? '');
    _contactNameController =
        TextEditingController(text: partner?.contactName ?? '');
    _contactEmailController =
        TextEditingController(text: partner?.contactEmail ?? '');
    _contactPhoneController =
        TextEditingController(text: partner?.contactPhone ?? '');
    _notesController = TextEditingController(text: partner?.notes ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _countryController.dispose();
    _contactNameController.dispose();
    _contactEmailController.dispose();
    _contactPhoneController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _saveDetails(ManagementStore store, ManagementPartner partner) {
    if (!_formKey.currentState!.validate()) return;
    store.updatePartnerDetails(
      partner.id,
      name: _nameController.text.trim(),
      countryOfOperation: _countryController.text.trim(),
      contactName: _contactNameController.text.trim(),
      contactEmail: _contactEmailController.text.trim(),
      contactPhone: _contactPhoneController.text.trim(),
      notes: _notesController.text.trim().isEmpty
          ? null
          : _notesController.text.trim(),
    );
    setState(() => _editing = false);
    _snack('Partner details updated.');
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<ManagementStore>();
    final partner = store.partnerById(widget.partnerId);

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/partners'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'PARTNER CRM',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Partner Detail',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: partner == null
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Partner not found.',
                    style: TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  SizedBox(height: 10),
                  Text(
                    'This partner may have been removed.',
                    style: TextStyle(color: VertexColors.gray600, fontSize: 13),
                  ),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 100),
              children: [
                _header(partner),
                const SizedBox(height: 14),

                _sectionCard(
                  title: 'LOGIN & ACCESS',
                  child: partner.userId == null
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'No partner login provisioned yet.',
                              style: TextStyle(
                                color: VertexColors.gray600,
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 10),
                            FilledButton.icon(
                              onPressed: () {
                                store.provisionLogin(partner.id);
                                _snack(
                                    'Partner login provisioned. Credentials sent to ${partner.contactEmail}.');
                              },
                              icon: const Icon(Icons.person_add_alt,
                                  size: 16),
                              label: const Text('CREATE PARTNER LOGIN',
                                  style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w800)),
                              style: FilledButton.styleFrom(
                                backgroundColor:
                                    VertexColors.midnight800,
                                shape: const StadiumBorder(),
                              ),
                            ),
                          ],
                        )
                      : Row(
                          children: [
                            Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                color: VertexColors.midnight500
                                    .withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Icon(Icons.key,
                                  color: VertexColors.midnight500, size: 18),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      const Text(
                                        'AREA: ',
                                        style: TextStyle(
                                            fontSize: 9,
                                            fontWeight: FontWeight.w800,
                                            color: VertexColors.gray600,
                                            letterSpacing: 1.0),
                                      ),
                                      Container(
                                        padding:
                                            const EdgeInsets.symmetric(
                                                horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFE8F5E9),
                                          borderRadius:
                                              BorderRadius.circular(4),
                                        ),
                                        child: const Text(
                                          'PARTNER',
                                          style: TextStyle(
                                            fontSize: 9,
                                            fontWeight: FontWeight.w800,
                                            color: VertexColors.midnight500,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    'Username: ${partner.userId}',
                                    style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                        color: VertexColors.midnight900),
                                  ),
                                ],
                              ),
                            ),
                            if (partner.userId != null)
                              SizedBox(
                                width: 140,
                                height: 40,
                                child: OutlinedButton(
                                onPressed: () => _snack(
                                    'Password reset requested for ${partner.contactEmail}.'),
                                style: OutlinedButton.styleFrom(
                                  side: const BorderSide(
                                      color: VertexColors.gray400),
                                  shape: const StadiumBorder(),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 12, vertical: 8),
                                ),
                                child: const Text('RESET PASSWORD',
                                    style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w800,
                                        color: VertexColors.midnight800)),
                              ),
                            ),
                          ],
                        ),
                ),
                const SizedBox(height: 14),

                _sectionCard(
                  title: 'PARTNER DETAILS',
                  child: _editing
                      ? Form(
                          key: _formKey,
                          child: Column(
                            children: [
                              _textField(
                                  'Agency Name', _nameController, true),
                              _textField('Country of Operation',
                                  _countryController, true),
                              _textField(
                                  'Contact Name', _contactNameController, true),
                              _textField('Contact Email',
                                  _contactEmailController, true),
                              _textField('Contact Phone',
                                  _contactPhoneController, true),
                              _textField('Notes', _notesController,
                                  false,
                                  maxLines: 3),
                              Align(
                                alignment: Alignment.centerRight,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    TextButton(
                                      onPressed: () {
                                        final p = store
                                            .partnerById(widget.partnerId);
                                        if (p != null) {
                                          _nameController.text = p.name;
                                          _countryController.text =
                                              p.countryOfOperation;
                                          _contactNameController.text =
                                              p.contactName;
                                          _contactEmailController.text =
                                              p.contactEmail;
                                          _contactPhoneController.text =
                                              p.contactPhone;
                                          _notesController.text = p.notes ?? '';
                                        }
                                        setState(() => _editing = false);
                                      },
                                      child: const Text('CANCEL',
                                          style: TextStyle(
                                              color: VertexColors.gray600)),
                                    ),
                                    const SizedBox(width: 8),
                                    ElevatedButton(
                                      onPressed: () =>
                                          _saveDetails(store, partner),
                                      style: ElevatedButton.styleFrom(
                                          backgroundColor:
                                              VertexColors.midnight800),
                                      child: const Text('SAVE',
                                          style: TextStyle(
                                              color: Colors.white)),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _detailRow('Agency name', partner.name),
                            _detailRow('Country of operation',
                                partner.countryOfOperation),
                            if (partner.businessRegNumber != null)
                              _detailRow('Business reg. no.',
                                  partner.businessRegNumber!),
                            _detailRow('Contact', partner.contactName),
                            _detailRow('Email', partner.contactEmail),
                            _detailRow('Phone', partner.contactPhone),
                            if (partner.notes != null &&
                                partner.notes!.isNotEmpty)
                              _detailRow('Notes', partner.notes!),
                            const SizedBox(height: 6),
                            Align(
                              alignment: Alignment.centerRight,
                              child: OutlinedButton.icon(
                                onPressed: () =>
                                    setState(() => _editing = true),
                                icon: const Icon(Icons.edit_outlined,
                                    size: 15),
                                label: const Text('EDIT DETAILS',
                                    style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w800)),
                                style: OutlinedButton.styleFrom(
                                  side: const BorderSide(
                                      color: VertexColors.gray400),
                                  shape: const StadiumBorder(),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 14, vertical: 8),
                                ),
                              ),
                            ),
                          ],
                        ),
                ),
                const SizedBox(height: 14),

                _sectionCard(
                  title: 'ACCOUNT STATUS & MOU',
                  child: Column(
                    children: [
                      _dropdownRow(
                        label: 'Partner Status',
                        value: partner.status,
                        options: const ['pending', 'active', 'suspended'],
                        onChanged: (v) {
                          store.updatePartnerStatus(partner.id, v ?? partner.status);
                          _snack('Status updated.');
                        },
                      ),
                      const SizedBox(height: 12),
                      _dropdownRow(
                        label: 'MOU Status',
                        value: partner.mouStatus,
                        options: const ['none', 'draft', 'sent', 'signed'],
                        onChanged: (v) {
                          store.updateMouStatus(partner.id, v ?? partner.mouStatus);
                          _snack('MOU status updated.');
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),

                _sectionCard(
                  title:
                      'SOURCED CANDIDATES (${store.candidatesFor(partner.id).length})',
                  child: store.candidatesFor(partner.id).isEmpty
                      ? const Text(
                          'No candidates sourced from this partner.',
                          style: TextStyle(
                              color: VertexColors.gray600, fontSize: 12),
                        )
                      : Column(
                          children: [
                            for (final candidate
                                in store.candidatesFor(partner.id))
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 34,
                                      height: 34,
                                      decoration: BoxDecoration(
                                        color: VertexColors.gold600
                                            .withValues(alpha: 0.12),
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Center(
                                        child: Text(
                                          '',
                                          style: TextStyle(fontSize: 12),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            candidate.name,
                                            style: const TextStyle(
                                              fontSize: 13,
                                              fontWeight: FontWeight.w700,
                                              color: VertexColors.midnight900,
                                            ),
                                          ),
                                          Text(
                                            'Sourced ${candidate.createdAt.day}/${candidate.createdAt.month}/${candidate.createdAt.year} · by ${candidate.recruiterName}',
                                            style: const TextStyle(
                                                fontSize: 10,
                                                color: VertexColors.gray600),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 7, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: VertexColors.ivory100,
                                        borderRadius:
                                            BorderRadius.circular(5),
                                      ),
                                      child: Text(
                                        candidate.lifecycleStatus
                                            .toUpperCase(),
                                        style: const TextStyle(
                                          fontSize: 9,
                                          fontWeight: FontWeight.w800,
                                          color: VertexColors.midnight800,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                ),
              ],
            ),
    );
  }

  Widget _header(ManagementPartner partner) {
    final typeLabel = _typeLabels[partner.partnerType] ?? partner.partnerType;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: VertexColors.gold600.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(13),
              ),
              child: const Icon(Icons.handshake_outlined,
                  color: VertexColors.gold600, size: 26),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    partner.name,
                    style: const TextStyle(
                      color: VertexColors.midnight900,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '$typeLabel · ${partner.countryOfOperation}',
                    style: const TextStyle(
                        color: VertexColors.gray600, fontSize: 13),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _sectionCard({
    required String title,
    required Widget child,
  }) =>
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 10,
                color: VertexColors.gray600,
                letterSpacing: 1.1,
              ),
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      );

  Widget _detailRow(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 132,
              child: Text(
                label,
                style: const TextStyle(
                    color: VertexColors.gray600, fontSize: 12),
              ),
            ),
            Expanded(
              child: Text(
                value,
                style: const TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      );

  Widget _dropdownRow({
    required String label,
    required String value,
    required List<String> options,
    required ValueChanged<String?> onChanged,
  }) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: VertexColors.gray600, fontSize: 12),
          ),
          const SizedBox(height: 6),
          DropdownButtonFormField<String>(
            initialValue: value,
            isExpanded: true,
            style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 12,
                fontWeight: FontWeight.w600),
            dropdownColor: Colors.white,
            iconEnabledColor: VertexColors.gold600,
            decoration: InputDecoration(
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(9),
                  borderSide:
                      const BorderSide(color: VertexColors.ivory200)),
              enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(9),
                  borderSide:
                      const BorderSide(color: VertexColors.ivory200)),
            ),
            items: options
                .map((o) => DropdownMenuItem(
                      value: o,
                      child: Text(o.toUpperCase(),
                          style: const TextStyle(fontSize: 11)),
                    ))
                .toList(),
            onChanged: onChanged,
          ),
        ],
      );

  Widget _textField(String label, TextEditingController controller,
          bool required,
          {int maxLines = 1}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
          controller: controller,
          maxLines: maxLines,
          style: const TextStyle(
              color: VertexColors.gold600,
              fontSize: 13,
              fontWeight: FontWeight.w600),
          validator: required
              ? (v) => v == null || v.trim().isEmpty ? 'Required' : null
              : null,
          decoration: InputDecoration(
            labelText: label,
            labelStyle:
                const TextStyle(color: VertexColors.gray600, fontSize: 12),
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
                    const BorderSide(color: VertexColors.gold600, width: 1.3)),
          ),
        ),
      );
}