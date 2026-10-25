import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/auth_manager.dart';
import '../../core/auth/fee_policy_store.dart';
import '../../core/constants/roles.dart';
import '../../data/models/fee_policy.dart';
import '../../data/services/api_service.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'director_drawer.dart';

class FeePolicyScreen extends StatefulWidget {
  const FeePolicyScreen({super.key});

  @override
  State<FeePolicyScreen> createState() => _FeePolicyScreenState();
}

/// The fee policy from FastAPI (backend plan step 1.4): every staff role
/// that opens it sees the real policies; director and admin can change them,
/// which FastAPI enforces whatever this screen shows.
class _FeePolicyScreenState extends State<FeePolicyScreen> {
  static const _managers = {VertexRole.director, VertexRole.admin};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<FeePolicyStore>().load();
    });
  }

  bool get _canEdit => _managers.contains(context.read<AuthManager>().role);

  Future<void> _save(FeePolicyStore store, FeePolicy policy, String done,
      {bool? enabled, double? documentationAmount, double? permitAmount, double? visaAmount, bool amountsChanged = false}) async {
    try {
      await store.save(policy,
          enabled: enabled,
          documentationAmount: documentationAmount,
          permitAmount: permitAmount,
          visaAmount: visaAmount,
          amountsChanged: amountsChanged);
      _snack(done);
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  String _formatThousands(String s) {
    var result = s;
    for (var i = result.length - 3; i > 0; i -= 3) {
      result = '${result.substring(0, i)},${result.substring(i)}';
    }
    return result;
  }

  Future<void> _editPolicy(FeePolicyStore store, FeePolicy policy) async {
    // Empty = not set; the server takes null, not 0.
    String text(double? amount) => amount == null ? '' : amount.toStringAsFixed(0);
    final doc = TextEditingController(text: text(policy.documentationAmount));
    final permit = TextEditingController(text: text(policy.permitAmount));
    final visa = TextEditingController(text: text(policy.visaAmount));

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Fee Policy — ${policy.countryName ?? 'Global'} (${policy.currency})'),
        content: StatefulBuilder(
          builder: (ctx, setDialogState) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _amountField('Documentation', doc, policy.currency),
              const SizedBox(height: 10),
              _amountField('Permit', permit, policy.currency),
              const SizedBox(height: 10),
              _amountField('Visa', visa, policy.currency),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child:
                const Text('CANCEL', style: TextStyle(color: VertexColors.gray600)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: VertexColors.midnight800),
            child: const Text('SAVE', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (saved != true) return;
    double? parse(TextEditingController c) {
      final raw = c.text.replaceAll(RegExp(r'[ ,]'), '');
      return raw.isEmpty ? null : double.tryParse(raw);
    }

    final amounts = [parse(doc), parse(permit), parse(visa)];
    if (amounts.any((a) => a != null && a <= 0)) {
      _snack('Amounts must be above zero, or left empty.');
      return;
    }
    await _save(store, policy, 'Fee policy updated.',
        documentationAmount: amounts[0], permitAmount: amounts[1], visaAmount: amounts[2], amountsChanged: true);
  }

  Widget _amountField(String label, TextEditingController controller,
          String currency) =>
      TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp(r'[0-9. ,]')),
        ],
        style: const TextStyle(
            color: VertexColors.gold600,
            fontSize: 13,
            fontWeight: FontWeight.w600),
        decoration: InputDecoration(
          labelText: '$label (${currency == 'UGX' ? 'UGX' : currency})',
          labelStyle: const TextStyle(color: VertexColors.gray600, fontSize: 12),
          prefixText: '$currency ',
          prefixStyle: const TextStyle(
              color: VertexColors.gray600,
              fontSize: 12,
              fontWeight: FontWeight.w600),
          suffixIcon: const Icon(Icons.edit_outlined,
              color: VertexColors.gold600, size: 16),
          filled: true,
          fillColor: VertexColors.ivory50,
          isDense: true,
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: VertexColors.ivory200)),
          enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: VertexColors.ivory200)),
          focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide:
                  const BorderSide(color: VertexColors.gold600, width: 1.3)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final store = context.watch<FeePolicyStore>();
    final enabledCount = store.policies.where((p) => p.enabled).length;

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/fee-policy'),
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
              'Fee Policy',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: _body(store, enabledCount),
    );
  }

  Widget _body(FeePolicyStore store, int enabledCount) {
    if (!store.hasLoaded && store.loadError == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (!store.hasLoaded) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(store.loadError!, textAlign: TextAlign.center, style: const TextStyle(color: VertexColors.gray600)),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: store.isLoading ? null : store.load, child: const Text('TRY AGAIN')),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: store.load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 100),
        children: [
          const Text(
            'Fee Policy.',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 28,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          const Text(
            'Set documentation, work permit, and visa fees charged to candidates, per country of destination.',
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFFE8F5E9),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              store.policies.isEmpty
                  ? 'No fee policies yet. Milestone payments stay off until one is enabled.'
                  : '$enabledCount of ${store.policies.length} policies enabled.',
              style: const TextStyle(
                color: VertexColors.midnight500,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: 18),

          for (final policy in store.policies)
            _buildPolicyCard(context, store, policy),
        ],
      ),
    );
  }

  Widget _buildPolicyCard(BuildContext context, FeePolicyStore store,
      FeePolicy policy) {
    final busy = store.savingId != null;
    final countryName = policy.countryName ?? 'Global';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: policy.enabled
              ? VertexColors.ivory200
              : VertexColors.ivory200.withValues(alpha: 0.4),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Text(
                      countryName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                        color: VertexColors.midnight900,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      policy.currency,
                      style: const TextStyle(
                        color: VertexColors.gray600,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    policy.enabled ? 'ENABLED' : 'DISABLED',
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      color: policy.enabled
                          ? VertexColors.midnight500
                          : VertexColors.gray600,
                      letterSpacing: 0.7,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Switch(
                    value: policy.enabled,
                    onChanged: !_canEdit || busy
                        ? null
                        : (value) => _save(store, policy,
                            value ? '$countryName policy enabled.' : '$countryName policy disabled.',
                            enabled: value),
                    activeThumbColor: VertexColors.midnight500,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Last updated ${policy.updatedAt.day}/${policy.updatedAt.month}/${policy.updatedAt.year}',
            style: const TextStyle(color: VertexColors.gray400, fontSize: 10),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _amountChip(
                'DOCUMENTATION',
                policy.documentationAmount,
                policy.currency,
                enabled: policy.enabled,
              ),
              _amountChip(
                'PERMIT',
                policy.permitAmount,
                policy.currency,
                enabled: policy.enabled,
              ),
              _amountChip(
                'VISA',
                policy.visaAmount,
                policy.currency,
                enabled: policy.enabled,
              ),
            ],
          ),
          if (_canEdit) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              onPressed: busy ? null : () => _editPolicy(store, policy),
              icon: const Icon(Icons.edit_outlined, size: 15),
              label: const Text('EDIT FEES',
                  style: TextStyle(
                      fontSize: 10, fontWeight: FontWeight.w800)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: VertexColors.gray400),
                shape: const StadiumBorder(),
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              ),
            ),
          ),
          ],
        ],
      ),
    );
  }

  Widget _amountChip(String label, double? amount, String currency,
      {required bool enabled}) {
    final hasAmount = amount != null;
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 4),
        margin: const EdgeInsets.only(right: 4),
        decoration: BoxDecoration(
          color: enabled ? VertexColors.ivory100 : VertexColors.ivory50,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 8,
                color: VertexColors.gray600,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.7,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              hasAmount
                  ? '$currency ${_formatThousands(amount.toStringAsFixed(0))}'
                  : 'Not set',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: hasAmount
                    ? VertexColors.midnight900
                    : VertexColors.gray400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}