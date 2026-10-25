import '../models/fee_policy.dart';
import '../services/api_service.dart';

/// The fee policy on FastAPI, which owns it (backend plan step 1). Reading
/// is open to every staff role that sees cases; saving to director and
/// admin. FastAPI enforces both.
class FeePolicyRepository {
  const FeePolicyRepository(this._api);
  final ApiService _api;

  /// Every policy, the most recently changed first.
  Future<List<FeePolicy>> list() async {
    final data = await _api.get('/fee-policy') as List<dynamic>;
    return data.map((e) => FeePolicy.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Saves the whole policy for its country; returns it as stored.
  Future<FeePolicy> save(FeePolicy policy) async {
    final data = await _api.post('/fee-policy', policy.toSaveJson()) as Map<String, dynamic>;
    return FeePolicy.fromJson(data);
  }
}
