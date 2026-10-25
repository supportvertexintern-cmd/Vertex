/// A milestone-payment fee policy as FastAPI serves it
/// (`GET /api/v1/fee-policy`, vertex_be/app/api/v1/fee_policy.py). A null
/// country is the global default.
class FeePolicy {
  const FeePolicy({
    required this.id,
    required this.enabled,
    required this.currency,
    required this.updatedAt,
    this.countryId,
    this.countryName,
    this.documentationAmount,
    this.permitAmount,
    this.visaAmount,
  });

  factory FeePolicy.fromJson(Map<String, dynamic> json) => FeePolicy(
        id: json['id'] as String,
        countryId: json['country_id'] as String?,
        countryName: (json['country'] as Map<String, dynamic>?)?['name'] as String?,
        enabled: json['enabled'] as bool,
        documentationAmount: (json['documentation_amount'] as num?)?.toDouble(),
        permitAmount: (json['permit_amount'] as num?)?.toDouble(),
        visaAmount: (json['visa_amount'] as num?)?.toDouble(),
        currency: json['currency'] as String,
        updatedAt: DateTime.parse(json['updated_at'] as String).toLocal(),
      );

  final String id;
  final String? countryId;
  final String? countryName;
  final bool enabled;
  final double? documentationAmount;
  final double? permitAmount;
  final double? visaAmount;
  final String currency;
  final DateTime updatedAt;

  /// The body `POST /api/v1/fee-policy` takes: the whole policy, saved for
  /// its country (or as the global default).
  Map<String, dynamic> toSaveJson() => {
        'country_id': countryId,
        'enabled': enabled,
        'documentation_amount': documentationAmount,
        'permit_amount': permitAmount,
        'visa_amount': visaAmount,
        'currency': currency,
      };
}
