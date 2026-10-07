import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/management_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'director_drawer.dart';

class EmployerClientsScreen extends StatefulWidget {
  const EmployerClientsScreen({super.key});

  @override
  State<EmployerClientsScreen> createState() => _EmployerClientsScreenState();
}

class _EmployerClientsScreenState extends State<EmployerClientsScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  String _statusFilter = 'All statuses';

  bool _showCreateForm = false;
  final _createFormKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _countryController = TextEditingController();
  final _industryController = TextEditingController();
  final _contactNameController = TextEditingController();
  final _contactEmailController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    _nameController.dispose();
    _countryController.dispose();
    _industryController.dispose();
    _contactNameController.dispose();
    _contactEmailController.dispose();
    super.dispose();
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _createClient(ManagementStore store) {
    if (!_createFormKey.currentState!.validate()) return;
    store.addEmployerClient(
      name: _nameController.text.trim(),
      country: _countryController.text.trim(),
      industry: _industryController.text.trim().isEmpty
          ? null
          : _industryController.text.trim(),
      contactName: _contactNameController.text.trim(),
      contactEmail: _contactEmailController.text.trim(),
    );
    setState(() {
      _showCreateForm = false;
      _nameController.clear();
      _countryController.clear();
      _industryController.clear();
      _contactNameController.clear();
      _contactEmailController.clear();
    });
    _snack('Employer client added.');
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<ManagementStore>();
    final clients = store.employerClients.where((c) {
      if (_statusFilter != 'All statuses' &&
          c.status != _statusFilter.toLowerCase()) {
        return false;
      }
      return _query.isEmpty || c.name.toLowerCase().contains(_query);
    });

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/employer-clients'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'CONTROL',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Employer Clients',
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
                  'Employer Clients.',
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
                    'NEW CLIENT',
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
            'Employers with active postings and placement agreements.',
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
            onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
            cursorColor: VertexColors.gold600,
            style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 14,
                fontWeight: FontWeight.w600),
            decoration: _decoration('Search by company name...', Icons.search),
          ),
          const SizedBox(height: 10),
          _filterDropdown(
            value: _statusFilter,
            options: const ['All statuses', 'Active', 'Inactive'],
            onChanged: (v) =>
                setState(() => _statusFilter = v ?? _statusFilter),
          ),
          const SizedBox(height: 18),

          if (clients.isEmpty)
            _emptyState('No employer clients match your filters.')
          else
            for (final client in clients) _buildClientCard(context, store, client),
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
              'New Employer Client',
              style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                  color: VertexColors.midnight900),
            ),
            const SizedBox(height: 12),
            _textField('Company Name', _nameController, required: true),
            _textField('Country', _countryController, required: true),
            _textField('Industry (optional)', _industryController),
            _textField('Contact Name', _contactNameController, required: true),
            _textField('Contact Email', _contactEmailController,
                required: true, keyboard: TextInputType.emailAddress),
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
                      onPressed: () => _createClient(store),
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

  Widget _buildClientCard(
      BuildContext context, ManagementStore store, EmployerClient client) {
    final active = client.status == 'active';
    return Container(
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
                child:
                    const Icon(Icons.business_outlined, color: VertexColors.gold600,
                        size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      client.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                        color: VertexColors.midnight900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [client.industry, client.country]
                          .whereType<String>()
                          .where((s) => s.isNotEmpty)
                          .join(' · '),
                      style: const TextStyle(
                          color: VertexColors.gray600, fontSize: 11),
                    ),
                  ],
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: active
                      ? const Color(0xFFE8F5E9)
                      : VertexColors.ivory100,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  client.status.toUpperCase(),
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    color: active ? VertexColors.midnight500 : VertexColors.gray600,
                  ),
                ),
              ),
            ],
          ),
          const Divider(height: 24, color: VertexColors.ivory200),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'CONTACTS',
                      style: TextStyle(
                          fontSize: 9,
                          color: VertexColors.gray600,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.7),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${client.contactName} · ${client.contactEmail}',
                      style: const TextStyle(
                          color: VertexColors.midnight900, fontSize: 11),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'OPEN JOBS',
                      style: TextStyle(
                          fontSize: 9,
                          color: VertexColors.gray600,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.7),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${client.jobsCount}',
                      style: const TextStyle(
                          color: VertexColors.gold600,
                          fontSize: 18,
                          fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: () {
                  store.setClientStatus(client.id,
                      client.status == 'active' ? 'inactive' : 'active');
                  _snack(client.status == 'active'
                      ? '${client.name} marked as INACTIVE.'
                      : '${client.name} marked as ACTIVE.');
                },
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: active
                        ? const Color(0xFFE8F5E9)
                        : const Color(0xFFFFF8E1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        active ? Icons.pause_circle : Icons.play_circle,
                        size: 16,
                        color: active
                            ? VertexColors.midnight500
                            : VertexColors.gold600,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        active ? 'MARK INACTIVE' : 'RE-ACTIVATE',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: active
                              ? VertexColors.midnight500
                              : VertexColors.gold600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

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
                value: o, child: Text(o, style: const TextStyle(fontSize: 13))))
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