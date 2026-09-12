import '../models/report.dart';
import '../services/api_service.dart';

class ReportRepository {
  const ReportRepository(this._api);
  final ApiService _api;

  Future<List<Report>> fetchDue() async {
    final data = await _api.get('/api/reports/due');
    return (data['reports'] as List)
        .map((e) => Report.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> submit(String id, String notes) =>
      _api.post('/api/reports/$id/submit', {'notes': notes});
}
