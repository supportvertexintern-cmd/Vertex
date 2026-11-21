import '../../core/auth/candidate_store.dart';
import '../services/api_service.dart';

/// The signed-in user's candidates, from FastAPI (GET /api/v1/candidates in
/// vertex_be/app/api/v1/pipeline_reads.py). FastAPI decides whose: a
/// recruiter's own, a supervisor's country, and so on; the app never filters
/// by role itself.
class CandidateRepository {
  const CandidateRepository(this._api);
  final ApiService _api;

  /// The newest first: [page] of up to [pageSize], and how many there are.
  Future<({List<CandidateRecord> records, int total})> list({int page = 1, int pageSize = 50, String? query}) async {
    final body = await _api.page('/candidates', page: page, pageSize: pageSize, query: {if (query != null && query.isNotEmpty) 'q': query});
    final rows = (body['data'] as List? ?? const []).whereType<Map<String, dynamic>>();
    return (records: rows.map(CandidateRecord.fromJson).toList(), total: (body['total'] as num?)?.toInt() ?? 0);
  }
}
