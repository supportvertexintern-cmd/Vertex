import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../core/auth/management_store.dart';
import '../shared/vertex_app_bar_leading.dart';
import 'director_drawer.dart';

class FeePolicyScreen extends StatefulWidget {
  const FeePolicyScreen({super.key});

  @override
  State<FeePolicyScreen> createState() => _FeePolicyScreenState();
}

class _FeePolicyScreenState extends State<FeePolicyScreen> {
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

  Future<void> _editPolicy(ManagementStore store, FeePolicy policy) async {
    final doc = TextEditingController(
        text: (policy.documentationAmount ?? 0).toStringAsFixed(0));
    final permit = TextEditingController(
        text: (policy.permitAmount ?? 0).toStringAsFixed(0));
    final visa = TextEditingController(
        text: (policy.visaAmount ?? 0).toStringAsFixed(0));

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Fee Policy — ${policy.countryName} (${policy.currency})'),
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

    if (saved == true) {
      store.updateFeeAmounts(
        policy.id,
        documentationAmount: double.tryParse(doc.text.trim()),
        permitAmount: double.tryParse(permit.text.trim()),
        visaAmount: double.tryParse(visa.text.trim()),
      );
      _snack('Fee policy updated.');
    }
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
    final store = context.watch<ManagementStore>();
    final enabledCount =
        store.feePolicies.where((p) => p.enabled).length;

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
      body: ListView(
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
              '$enabledCount of ${store.feePolicies.length} country policies enabled.',
              style: const TextStyle(
                color: VertexColors.midnight500,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: 18),

          for (final policy in store.feePolicies)
            _buildPolicyCard(context, store, policy),
        ],
      ),
    );
  }

  Widget _buildPolicyCard(BuildContext context, ManagementStore store,
      FeePolicy policy) {
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
                    onChanged: (_) {
                      store.toggleFeePolicyEnabled(policy.id);
                      _snack(policy.enabled
                          ? '$countryName policy disabled.'
                          : '$countryName policy enabled.');
                    },
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
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              onPressed: () => _editPolicy(store, policy),
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