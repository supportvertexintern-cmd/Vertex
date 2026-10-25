import 'package:flutter/foundation.dart';

import '../../data/models/fee_policy.dart';
import '../../data/repositories/fee_policy_repository.dart';
import '../../data/services/api_service.dart';

/// The Fee Policy screen's state, loaded from FastAPI: the first screen off
/// mock data (backend plan step 1.4). Saves go to the server first and the
/// list shows what it stored, never an optimistic guess.
class FeePolicyStore extends ChangeNotifier {
  FeePolicyStore(this._repository);
  final FeePolicyRepository _repository;

  List<FeePolicy> policies = const [];
  bool isLoading = false;
  bool hasLoaded = false;

  /// Why the last load failed, to show with a retry; null when it didn't.
  String? loadError;

  /// The policy being saved, so its controls can wait.
  String? savingId;

  Future<void> load() async {
    isLoading = true;
    loadError = null;
    notifyListeners();
    try {
      policies = await _repository.list();
      hasLoaded = true;
    } on ApiException catch (e) {
      loadError = e.message;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  /// Saves the policy with [enabled] and the amounts changed; throws
  /// [ApiException] with a message to show if the server refuses.
  Future<void> save(
    FeePolicy policy, {
    bool? enabled,
    double? documentationAmount,
    double? permitAmount,
    double? visaAmount,
    bool amountsChanged = false,
  }) async {
    savingId = policy.id;
    notifyListeners();
    try {
      final stored = await _repository.save(FeePolicy(
        id: policy.id,
        countryId: policy.countryId,
        countryName: policy.countryName,
        enabled: enabled ?? policy.enabled,
        documentationAmount: amountsChanged ? documentationAmount : policy.documentationAmount,
        permitAmount: amountsChanged ? permitAmount : policy.permitAmount,
        visaAmount: amountsChanged ? visaAmount : policy.visaAmount,
        currency: policy.currency,
        updatedAt: policy.updatedAt,
      ));
      // Newest first, as the server orders them.
      policies = [stored, ...policies.where((p) => p.id != stored.id)];
    } finally {
      savingId = null;
      notifyListeners();
    }
  }
}
