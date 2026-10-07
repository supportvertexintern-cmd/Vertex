import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/management_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'director_drawer.dart';

const Map<String, String> _partnerTypeLabels = {
  'travel_agency': 'Travel Agency',
  'visa_consultancy': 'Visa Consultancy',
  'manpower_supplier': 'Manpower Supplier',
  'other': 'Other',
};

class ManagementPartnersScreen extends StatefulWidget {
  const ManagementPartnersScreen({super.key});

  @override
  State<ManagementPartnersScreen> createState() =>
      _ManagementPartnersScreenState();
}

class _ManagementPartnersScreenState extends State<ManagementPartnersScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  String _statusFilter = 'All statuses';
  String _typeFilter = 'All types';

  bool _showCreateForm = false;
  final _createFormKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _countryController = TextEditingController();
  final _regNumberController = TextEditingController();
  final _contactNameController = TextEditingController();
  final _contactEmailController = TextEditingController();
  final _contactPhoneController = TextEditingController();
  String _partnerType = 'travel_agency';

  @override
  void dispose() {
    _searchController.dispose();
    _nameController.dispose();
    _countryController.dispose();
    _regNumberController.dispose();
    _contactNameController.dispose();
    _contactEmailController.dispose();
    _contactPhoneController.dispose();
    super.dispose();
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _createPartner(ManagementStore store) {
    if (!_createFormKey.currentState!.validate()) return;
    store.addPartner(
      name: _nameController.text.trim(),
      partnerType: _partnerType,
      countryOfOperation: _countryController.text.trim(),
      businessRegNumber: _regNumberController.text.trim().isEmpty
          ? null
          : _regNumberController.text.trim(),
      contactName: _contactNameController.text.trim(),
      contactEmail: _contactEmailController.text.trim(),
      contactPhone: _contactPhoneController.text.trim(),
    );
    setState(() {
      _showCreateForm = false;
      _nameController.clear();
      _countryController.clear();
      _regNumberController.clear();
      _contactNameController.clear();
      _contactEmailController.clear();
      _contactPhoneController.clear();
      _partnerType = 'travel_agency';
    });
    _snack('Partner added.');
  }

  void _resetPassword(ManagementPartner partner) {
    _snack('Password reset email sent to ${partner.contactEmail}.');
  }

  Future<void> _confirmDelete(
      ManagementStore store, ManagementPartner partner) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Partner?'),
        content: Text(
            'This will remove "${partner.name}" from the partner network. This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child:
                const Text('CANCEL', style: TextStyle(color: VertexColors.gray600)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style:
                ElevatedButton.styleFrom(backgroundColor: VertexColors.error),
            child: const Text('DELETE', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    store.deletePartner(partner.id);
    _snack('Partner deleted.');
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<ManagementStore>();

    final partners = store.partners.where((p) {
      if (_statusFilter != 'All statuses' &&
          p.status != _statusFilter.toLowerCase()) {
        return false;
      }
      if (_typeFilter != 'All types' && p.partnerType != _typeFilter) {
        return false;
      }
      if (_query.isNotEmpty &&
          !p.name.toLowerCase().contains(_query) &&
          !p.countryOfOperation.toLowerCase().contains(_query)) {
        return false;
      }
      return true;
    });

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
              'Partners',
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
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const Expanded(
                child: Text(
                  'Partners.',
                  style: TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              SizedBox(
                width: 140,
                height: 40,
                child: ElevatedButton.icon(
                  onPressed: () =>
                      setState(() => _showCreateForm = !_showCreateForm),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text(
                    'ADD PARTNER',
                    style:
                        TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: VertexColors.midnight800,
                    foregroundColor: Colors.white,
                    shape: const StadiumBorder(),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 10),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          const Text(
            'Travel agencies, visa consultancies, and manpower suppliers that source candidate leads (SRS FR-5.1).',
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 18),

          if (_showCreateForm) ...[
            _buildCreateForm(store),
            const SizedBox(height: 20),
          ],

          TextField(
            controller: _searchController,
            onChanged: (v) =>
                setState(() => _query = v.trim().toLowerCase()),
            cursorColor: VertexColors.gold600,
            style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 14,
                fontWeight: FontWeight.w600),
            decoration: _decoration(
                'Search by agency, contact, or country...', Icons.search),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _filterDropdown(
                  value: _statusFilter,
                  options: const [
                    'All statuses',
                    'Pending',
                    'Active',
                    'Suspended',
                  ],
                  onChanged: (v) =>
                      setState(() => _statusFilter = v ?? _statusFilter),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _filterDropdown(
                  value: _typeFilter,
                  options: const [
                    'All types',
                    'travel_agency',
                    'visa_consultancy',
                    'manpower_supplier',
                    'other',
                  ],
                  onChanged: (v) =>
                      setState(() => _typeFilter = v ?? _typeFilter),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),

          if (partners.isEmpty)
            _emptyState('No partners match your filters.')
          else
            for (final partner in partners)
              _buildPartnerCard(context, store, partner),
        ],
      ),
    );
  }

  Widget _buildCreateForm(ManagementStore store) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: Form(
        key: _createFormKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Add Partner',
              style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                  color: VertexColors.midnight900),
            ),
            const SizedBox(height: 12),
            _textField('Agency Name', _nameController, required: true),
            DropdownButtonFormField<String>(
              initialValue: _partnerType,
              isExpanded: true,
              style: const TextStyle(
                  color: VertexColors.gold600,
                  fontSize: 13,
                  fontWeight: FontWeight.w600),
              dropdownColor: Colors.white,
              iconEnabledColor: VertexColors.gold600,
              decoration: InputDecoration(
                labelText: 'Partner Type',
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
                    borderSide: const BorderSide(
                        color: VertexColors.gold600, width: 1.3)),
              ),
              items: [
                for (final entry in _partnerTypeLabels.entries)
                  DropdownMenuItem(
                    value: entry.key,
                    child: Text(entry.value,
                        style: const TextStyle(fontSize: 13)),
                  ),
              ],
              onChanged: (v) =>
                  setState(() => _partnerType = v ?? 'travel_agency'),
            ),
            const SizedBox(height: 12),
            _textField('Country of Operation', _countryController,
                required: true),
            _textField('Business Reg. No. (optional)', _regNumberController),
            _textField('Contact Name', _contactNameController, required: true),
            _textField('Contact Email', _contactEmailController,
                required: true, keyboard: TextInputType.emailAddress),
            _textField('Contact Phone', _contactPhoneController,
                required: true, keyboard: TextInputType.phone),
            Align(
              alignment: Alignment.centerRight,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextButton(
                    onPressed: () => setState(() => _showCreateForm = false),
                    child: const Text('CANCEL',
                        style: TextStyle(color: VertexColors.gray600)),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 80,
                    child: ElevatedButton(
                      onPressed: () => _createPartner(store),
                      style: ElevatedButton.styleFrom(
                          backgroundColor: VertexColors.midnight800),
                      child: const Text('ADD',
                          style: TextStyle(color: Colors.white)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPartnerCard(BuildContext context, ManagementStore store,
      ManagementPartner partner) {
    final typeLabel = _partnerTypeLabels[partner.partnerType] ?? partner.partnerType;
    final statusColor = switch (partner.status) {
      'active' => VertexColors.midnight500,
      'pending' => VertexColors.gold600,
      _ => VertexColors.error,
    };
    final statusBg = switch (partner.status) {
      'active' => const Color(0xFFE8F5E9),
      'pending' => const Color(0xFFFFF8E1),
      _ => const Color(0xFFFFEBEE),
    };

    return InkWell(
      onTap: () => context.push('/management/partners/${partner.id}'),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: VertexColors.gold600.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.handshake_outlined,
                      color: VertexColors.gold600, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        partner.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                          color: VertexColors.midnight900,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '$typeLabel · ${partner.countryOfOperation}',
                        style: const TextStyle(
                            color: VertexColors.gray600, fontSize: 11),
                      ),
                      Text(
                        '${partner.contactName} · ${partner.contactEmail}',
                        style: const TextStyle(
                            color: VertexColors.gray600, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right,
                    color: VertexColors.gold600, size: 20),
              ],
            ),
            const Divider(height: 22, color: VertexColors.ivory200),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _stat(
                  'Status',
                  partner.status.toUpperCase(),
                  color: statusColor,
                  bg: statusBg,
                ),
                _stat(
                  'MOU',
                  partner.mouStatus.toUpperCase(),
                  color: partner.mouStatus == 'signed'
                      ? VertexColors.midnight500
                      : VertexColors.gray600,
                  bg: partner.mouStatus == 'signed'
                      ? const Color(0xFFE8F5E9)
                      : VertexColors.ivory100,
                ),
                _stat(
                  'Candidates',
                  '${partner.candidatesSourcedCount}',
                  color: VertexColors.midnight900,
                  bg: VertexColors.ivory100,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (partner.userId != null)
                    IconButton(
                      tooltip: 'Reset Password',
                      onPressed: () => _resetPassword(partner),
                      icon: const Icon(Icons.key,
                          size: 18, color: VertexColors.gray600),
                    ),
                  IconButton(
                    tooltip: 'Delete Partner',
                    onPressed: () => _confirmDelete(store, partner),
                    icon: const Icon(Icons.delete_outline,
                        size: 18, color: VertexColors.error),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stat(String label, String value, {required Color color, required Color bg}) =>
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 9,
                color: VertexColors.gray600,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.7,
              ),
            ),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 10,
                  color: color,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      );

  InputDecoration _decoration(String hint, IconData icon) => InputDecoration(
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
                child: Text(
                  o == 'travel_agency'
                      ? 'Travel Agency'
                      : o == 'visa_consultancy'
                          ? 'Visa Consultancy'
                          : o == 'manpower_supplier'
                              ? 'Manpower Supplier'
                              : o == 'other'
                                  ? 'Other'
                                  : o,
                  style: const TextStyle(fontSize: 13),
                )))
            .toList(),
        onChanged: onChanged,
      );

  Widget _textField(String label, TextEditingController controller,
          {bool required = false, TextInputType? keyboard}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
          controller: controller,
          keyboardType: keyboard,
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

  Widget _emptyState(String msg) => Container(
        padding: const EdgeInsets.all(36),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: VertexColors.ivory200),
        ),
        child: Center(
          child: Text(msg,
              style:
                  const TextStyle(color: VertexColors.gray600, fontSize: 13)),
        ),
      );
}