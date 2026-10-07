import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/management_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'director_drawer.dart';

class ManagementCampaignsScreen extends StatefulWidget {
  const ManagementCampaignsScreen({super.key});

  @override
  State<ManagementCampaignsScreen> createState() =>
      _ManagementCampaignsScreenState();
}

class _ManagementCampaignsScreenState
    extends State<ManagementCampaignsScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  String _statusFilter = 'All statuses';

  bool _showCreateForm = false;
  final _createFormKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _notesController = TextEditingController();
  DateTime? _startDate;
  DateTime? _endDate;

  final Map<String, String> _targetMetric = {};
  final Map<String, String> _targetScope = {};
  final Map<String, TextEditingController> _targetValueControllers = {};

  late final TextEditingController _startController = TextEditingController();
  late final TextEditingController _endController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    _nameController.dispose();
    _notesController.dispose();
    _startController.dispose();
    _endController.dispose();
    for (final controller in _targetValueControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  TextEditingController _valueController(String campaignId) =>
      _targetValueControllers.putIfAbsent(
        campaignId,
        () => TextEditingController(),
      );

  void _createCampaign(ManagementStore store) {
    if (!_createFormKey.currentState!.validate()) return;
    if (_startDate == null || _endDate == null) {
      _snack('Select a start and end date.');
      return;
    }
    store.createCampaign(
      name: _nameController.text.trim(),
      startDate: _startDate!,
      endDate: _endDate!,
      notes: _notesController.text.trim().isEmpty
          ? null
          : _notesController.text.trim(),
    );
    setState(() {
      _showCreateForm = false;
      _nameController.clear();
      _notesController.clear();
      _startController.clear();
      _endController.clear();
      _startDate = null;
      _endDate = null;
    });
    _snack('Campaign created.');
  }

  void _addTarget(ManagementStore store, String campaignId) {
    final controller = _valueController(campaignId);
    final value = num.tryParse(controller.text.trim());
    if (value == null) {
      _snack('Enter a numeric target value.');
      return;
    }
    store.addTarget(
      campaignId,
      metric: _targetMetric[campaignId] ?? 'verified_candidates',
      targetValue: value,
      scope: _targetScope[campaignId] ?? 'Campaign-wide',
    );
    controller.clear();
    _snack('Target added.');
  }

  Future<void> _confirmDeleteCampaign(
      ManagementStore store, ManagementCampaign campaign) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Campaign?'),
        content: Text(
            'This will permanently delete "${campaign.name}" and all of its targets.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('CANCEL',
                style: TextStyle(color: VertexColors.gray600)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
                backgroundColor: VertexColors.error),
            child: const Text('DELETE',
                style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    store.deleteCampaign(campaign.id);
    _snack('Campaign deleted.');
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<ManagementStore>();
    final campaigns = store.campaigns.where((c) {
      if (_statusFilter != 'All statuses' &&
          c.status != _statusFilter.toLowerCase()) {
        return false;
      }
      return _query.isEmpty || c.name.toLowerCase().contains(_query);
    });

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/campaigns'),
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
              'Campaigns',
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
                  'Campaigns.',
                  style: TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              SizedBox(
                width: 140,
                child: ElevatedButton.icon(
                  onPressed: () =>
                      setState(() => _showCreateForm = !_showCreateForm),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text(
                    'NEW CAMPAIGN',
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
            'Define recruitment criteria, requirements, targets, and timelines, and cascade them to countries or regions.',
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
            decoration: _decoration('Search by campaign name...', Icons.search),
          ),
          const SizedBox(height: 10),
          _filterDropdown(
            value: _statusFilter,
            options: const ['All statuses', 'Draft', 'Active', 'Closed'],
            onChanged: (v) =>
                setState(() => _statusFilter = v ?? _statusFilter),
          ),
          const SizedBox(height: 18),

          if (campaigns.isEmpty)
            _emptyState('No campaigns match your filters.')
          else
            for (final campaign in campaigns)
              _buildCampaignCard(context, store, campaign),
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
              'New Campaign',
              style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                  color: VertexColors.midnight900),
            ),
            const SizedBox(height: 12),
            _textField('Campaign Name', _nameController, required: true),
            _dateField('Start Date', _startDate),
            _dateField('End Date', _endDate),
            _textField('Criteria / notes (optional)', _notesController,
                maxLines: 3),
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
                      onPressed: () => _createCampaign(store),
                      style: ElevatedButton.styleFrom(
                          backgroundColor: VertexColors.midnight800),
                      child: const Text('CREATE',
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

  Widget _buildCampaignCard(BuildContext context, ManagementStore store,
      ManagementCampaign campaign) {
    final statusColor = switch (campaign.status) {
      'active' => VertexColors.midnight500,
      'draft' => VertexColors.gold600,
      _ => VertexColors.gray600,
    };
    final statusBg = campaign.status == 'active'
        ? const Color(0xFFE8F5E9)
        : (campaign.status == 'draft'
            ? const Color(0xFFFFF8E1)
            : VertexColors.ivory100);
    final dateText =
        '${campaign.startDate.day}/${campaign.startDate.month}/${campaign.startDate.year}'
        ' - ${campaign.endDate.day}/${campaign.endDate.month}/${campaign.endDate.year}';

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
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
                  color: VertexColors.midnight800.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.campaign_outlined,
                    color: VertexColors.midnight800, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      campaign.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                        color: VertexColors.midnight900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      campaign.notes == null || campaign.notes!.isEmpty
                          ? '$dateText · by ${campaign.creatorName}'
                          : '${campaign.notes} · by ${campaign.creatorName}',
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
                  color: statusBg,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  campaign.status.toUpperCase(),
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    color: statusColor,
                  ),
                ),
              ),
            ],
          ),
          const Divider(height: 26, color: VertexColors.ivory200),

          const Text(
            'TARGETS',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 10,
              color: VertexColors.gray600,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 8),
          if (campaign.targets.isEmpty)
            const Text(
              'No targets set.',
              style: TextStyle(fontSize: 12, color: VertexColors.gray600),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final target in campaign.targets)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: VertexColors.ivory100,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: VertexColors.ivory200),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          target.metric == 'verified_candidates'
                              ? 'Verified:'
                              : 'Conversion:',
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: VertexColors.midnight900,
                          ),
                        ),
                        Text(
                          '${target.targetValue}${target.metric == 'conversion_rate' ? '%' : ''}',
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: VertexColors.gold600,
                          ),
                        ),
                        Flexible(
                          child: Text(
                            ' ${target.scopeLabel}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 10,
                              color: VertexColors.gray600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 2),
                        GestureDetector(
                          onTap: () =>
                              store.removeTarget(campaign.id, target.id),
                          child: const Icon(Icons.close,
                              size: 12, color: VertexColors.gray400),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          const SizedBox(height: 12),

          Row(
            children: [
              Expanded(
                child: _miniDropdown(
                  hint: 'Metric',
                  value: _targetMetric[campaign.id] ?? 'verified_candidates',
                  options: const [
                    'verified_candidates',
                    'conversion_rate',
                  ],
                  onChanged: (v) => setState(
                      () => _targetMetric[campaign.id] = v ?? 'verified_candidates'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _miniDropdown(
                  hint: 'Scope',
                  value: _targetScope[campaign.id] ?? 'Campaign-wide',
                  options: const [
                    'Campaign-wide',
                    'Kenya',
                    'Nigeria',
                    'Uganda',
                    'East Africa',
                  ],
                  onChanged: (v) => setState(
                      () => _targetScope[campaign.id] = v ?? 'Campaign-wide'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _valueController(campaign.id),
                  keyboardType: TextInputType.number,
                  style: const TextStyle(
                      fontSize: 12, color: VertexColors.gold600),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'Target value',
                    hintStyle: const TextStyle(
                        color: VertexColors.gray400, fontSize: 11),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 10),
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 36,
                height: 36,
                child: IconButton(
                  onPressed: () => _addTarget(store, campaign.id),
                  icon: const Icon(Icons.add_circle,
                      color: VertexColors.midnight800, size: 22),
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints(minWidth: 32, minHeight: 32),
                ),
              ),
            ],
          ),

          const Divider(height: 24, color: VertexColors.ivory200),

          Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Text(
                      'STATUS',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        color: VertexColors.gray600,
                        letterSpacing: 1.0,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _miniDropdown(
                        hint: 'Status',
                        value: campaign.status,
                        options: const ['draft', 'active', 'closed'],
                        onChanged: (v) {
                          if (v == null) return;
                          store.updateCampaignStatus(campaign.id, v);
                          _snack('Campaign marked as ${v.toUpperCase()}.');
                        },
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(
                width: 36,
                height: 36,
                child: IconButton(
                  tooltip: 'Delete Campaign',
                  onPressed: () => _confirmDeleteCampaign(store, campaign),
                  icon: const Icon(Icons.delete_outline,
                      color: VertexColors.error, size: 20),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _miniDropdown({
    required String hint,
    required String value,
    required List<String> options,
    required ValueChanged<String?> onChanged,
  }) =>
      DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        style: const TextStyle(
          fontSize: 11,
          color: VertexColors.gold600,
          fontWeight: FontWeight.w600,
        ),
        dropdownColor: Colors.white,
        iconEnabledColor: VertexColors.gold600,
        iconSize: 18,
        decoration: InputDecoration(
          isDense: true,
          hintText: hint,
          hintStyle:
              const TextStyle(color: VertexColors.gray400, fontSize: 10),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: VertexColors.ivory200),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: VertexColors.ivory200),
          ),
        ),
        items: options
            .map((o) => DropdownMenuItem(
                  value: o,
                  child: Text(
                    o,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11),
                  ),
                ))
            .toList(),
        onChanged: onChanged,
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
                value: o, child: Text(o, style: const TextStyle(fontSize: 13))))
            .toList(),
        onChanged: onChanged,
      );

  Widget _textField(String label, TextEditingController controller,
          {bool required = false, int maxLines = 1}) =>
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

  Widget _dateField(String label, DateTime? current) {
    final isStart = label == 'Start Date';
    final controller = isStart ? _startController : _endController;
    return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: FormField<DateTime>(
          validator: (value) => current == null ? 'Required' : null,
          builder: (field) => TextFormField(
            readOnly: true,
            controller: controller,
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: current ?? DateTime.now(),
                firstDate: DateTime(2024),
                lastDate: DateTime(2032),
              );
              if (picked == null) return;
              final formatted = '${picked.day.toString().padLeft(2, '0')}/'
                  '${picked.month.toString().padLeft(2, '0')}/'
                  '${picked.year}';
              setState(() {
                if (isStart) {
                  _startDate = picked;
                  _startController.text = formatted;
                } else {
                  _endDate = picked;
                  _endController.text = formatted;
                }
              });
              field.validate();
            },
            style: const TextStyle(
                color: VertexColors.gold600,
                fontSize: 13,
                fontWeight: FontWeight.w600),
            decoration: InputDecoration(
              labelText: label,
              labelStyle:
                  const TextStyle(color: VertexColors.gray600, fontSize: 12),
              errorText: field.errorText,
              hintText: 'dd/mm/yyyy',
              hintStyle:
                  const TextStyle(color: VertexColors.gray400, fontSize: 12),
              filled: true,
              fillColor: Colors.white,
              suffixIcon: const Icon(Icons.calendar_today_outlined,
                  color: VertexColors.gold600, size: 18),
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
        ));
  }

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