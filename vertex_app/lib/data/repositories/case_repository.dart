import '../../core/auth/case_store.dart';
import '../services/api_service.dart';

/// The signed-in user's cases, from FastAPI (GET /api/v1/cases in
/// vertex_be/app/api/v1/case_reads.py; FastAPI scopes them to the role).
/// Active and rejected alike, so the lists can show both.
class CaseRepository {
  const CaseRepository(this._api);
  final ApiService _api;

  Future<({List<CaseRecord> records, int total})> list({int page = 1, int pageSize = 50}) async {
    final body = await _api.page('/cases', page: page, pageSize: pageSize, query: {'status': 'all'});
    final rows = (body['data'] as List? ?? const []).whereType<Map<String, dynamic>>();
    return (records: rows.map(CaseRecord.fromJson).toList(), total: (body['total'] as num?)?.toInt() ?? 0);
  }
}
